#!/usr/bin/env node
// Authoring, supported package finalization and exported-file rendering. Never approves review.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createComponents, estimatedLines, STYLE } from './deck_components.mjs';
import { getTheme } from './themes.mjs';
import { resolveNavigation } from './navigation.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function fileHash(file) { return sha256(await fs.readFile(file)); }
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    if (key === 'help') args.help = true;
    else { if (argv[i+1] === undefined || argv[i+1].startsWith('--')) throw new Error(`Missing --${key} value`); args[key] = argv[++i]; }
  }
  const allowed = new Set(['help','workdir','runtime-node-modules','python','font','out','preview','scale','render-pptx','finalize-pptx','presentations-skill','build-receipt']);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`Unknown --${key}`);
  if (args['render-pptx'] && args['finalize-pptx']) throw new Error('Use one operation: --render-pptx or --finalize-pptx');
  if (args['presentations-skill'] && !args['finalize-pptx']) throw new Error('--presentations-skill is for --finalize-pptx');
  if (args['build-receipt'] && !args['finalize-pptx'] && !args['render-pptx']) throw new Error('--build-receipt requires an exported PPTX operation');
  return args;
}
export function resolveWorkdir(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('--workdir is required');
  return path.resolve(value);
}
export async function loadRuntime(moduleDir) {
  if (!path.isAbsolute(moduleDir || '')) throw new Error('Pass absolute --runtime-node-modules or RUNTIME_NODE_MODULES from load_workspace_dependencies');
  const require = createRequire(path.join(moduleDir, 'package.json'));
  const entry = require.resolve('@oai/artifact-tool');
  const api = await import(pathToFileURL(entry).href);
  const packageInfo = await json(path.resolve(path.dirname(entry),'../package.json'));
  return { ...api, sharp: require('sharp'), runtimeVersion:packageInfo.version };
}
export function makeResolver(papers) {
  const conditions = new Map();
  for (const paper of papers.papers) for (const experiment of paper.experiments || []) {
    for (const [key, value] of Object.entries(experiment.values || {})) {
      const id = `${experiment.experiment_id}.${key}`;
      if (conditions.has(id)) throw new Error(`Duplicate condition reference: ${id}`);
      conditions.set(id, value);
    }
  }
  function condition(id) {
    if (!conditions.has(id)) throw new Error(`Unresolved condition reference: ${id}`);
    const value = conditions.get(id);
    if (value === null || !['string','number','boolean'].includes(typeof value)) throw new Error(`Condition ${id} must be a display-ready scalar with its units`);
    return String(value);
  }
  function resolve(value) {
    if (typeof value === 'string') return value.replace(/\{\{([^{}]+)\}\}/g, (_, id) => condition(id.trim()));
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object') {
      if ('condition_ref' in value) {
        if (Object.keys(value).length !== 1 || typeof value.condition_ref !== 'string') throw new Error('A condition_ref object must contain only its string condition_ref');
        return condition(value.condition_ref);
      }
      return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, resolve(val)]));
    }
    return value;
  }
  return resolve;
}
export function evidenceIndex(papers) {
  const result = new Map();
  for (const paper of papers.papers) for (const ev of paper.evidence) result.set(ev.evidence_id, { paper, ...ev });
  return result;
}
export function checkDeckStructure(plan, papers) {
  const slides = plan.slides, primary = new Set(papers.papers.filter(p => (p.source_role || 'primary') === 'primary').map(p => p.paper_id));
  const thematicAgenda = plan.navigation?.mode === 'by-theme';
  const evidencePrimary = new Map(papers.papers.flatMap(paper => (paper.evidence || []).map(item =>
    [item.evidence_id, (paper.source_role || 'primary') === 'primary' ? paper.paper_id : paper.related_to])));
  if (!Array.isArray(slides) || !slides.length || !primary.size) throw new Error('Deck structure requires slides and at least one primary paper');
  const overrides = plan.structure_overrides || {};
  if (typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('structure_overrides must contain explicit written reasons');
  for (const [key, value] of Object.entries(overrides)) if (!['agenda','closing'].includes(key) || typeof value !== 'string' || !value.trim()) throw new Error('structure_overrides accepts only agenda/closing with nonempty reasons');
  const types = slides.map(s => s.render?.type), endings = types.flatMap((t,i)=>t==='closing'?[i]:[]), agendas = types.flatMap((t,i)=>t==='agenda'?[i]:[]);
  if (!overrides.closing && endings.length !== 1) throw new Error('Deck requires exactly one fixed closing slide within the confirmed total');
  for (const index of endings) {
    if (index !== slides.length - 1) throw new Error('The fixed closing must be the last slide');
    if (Object.keys(slides[index].render).some(key=>key!=='type')) throw new Error('closing accepts only render.type; body or other content must go on a preceding slide');
    if (slides[index].claims?.length || slides[index].evidence_ids?.length) throw new Error('Scientific claims/evidence must be on a content slide before the fixed closing');
  }
  if (!overrides.agenda) {
    if (primary.size === 1 && agendas.length) throw new Error('A single primary paper does not use an agenda');
    if (primary.size > 1 && agendas.length !== 1) throw new Error('Multiple primary papers require exactly one agenda');
    const cover = types.indexOf('cover');
    if (agendas.length && agendas[0] !== (cover < 0 ? 0 : cover + 1)) throw new Error('The agenda belongs immediately after the cover, or first when no cover is used');
  }
  const agendaItems = {};
  for (const index of agendas) {
    const slide = slides[index], items = slide.render.items, covered = new Set();
    let previousTarget = index;
    if (!Array.isArray(items) || !items.length) throw new Error('agenda requires items with labels, paper_ids and target_slide_id');
    agendaItems[slide.slide_id] = items.map(item => {
      if (!item || typeof item.label !== 'string' || !item.label.trim() || !Array.isArray(item.paper_ids) || !item.paper_ids.length)
        throw new Error('Every agenda item needs a short label and primary paper_ids');
      if (Object.keys(item).some(key=>!['label','paper_ids','target_slide_id'].includes(key))) throw new Error('agenda items accept only label, paper_ids and target_slide_id; page numbers are computed from the final plan');
      const target = slides.findIndex(s=>s.slide_id===item.target_slide_id);
      if (target <= index || ['cover','closing','agenda'].includes(types[target])) throw new Error('agenda targets must be subsequent actual content slides');
      if (target <= previousTarget) throw new Error('agenda targets must follow strictly increasing page order; combine repeated targets into one item');
      previousTarget = target;
      for (const pid of item.paper_ids) {
        if (!primary.has(pid) || !slide.paper_ids?.includes(pid) || (!thematicAgenda && !slides[target].paper_ids?.includes(pid))) throw new Error('agenda item paper_ids must be actual primary papers declared on the agenda and its target');
        covered.add(pid);
      }
      return { ...item, start_page:target+1 };
    });
    if (thematicAgenda) agendaItems[slide.slide_id].forEach((item, itemIndex, resolvedItems) => {
      const from = item.start_page - 1, to = resolvedItems[itemIndex + 1]?.start_page - 1;
      const interval = slides.slice(from,Number.isFinite(to) ? to : slides.length)
        .filter(candidate => !['cover','agenda','closing'].includes(candidate.render?.type));
      for (const pid of item.paper_ids) {
        const supported = interval.some(candidate => candidate.paper_ids?.includes(pid) &&
          [...(candidate.evidence_ids || []), ...(candidate.claims || []).flatMap(claim => claim.sources || [])]
            .some(eid => evidencePrimary.get(eid) === pid));
        if (!supported) throw new Error(`agenda theme interval starting at ${item.target_slide_id} lacks declared evidence for ${pid}; later intervals or paper_ids alone cannot satisfy coverage`);
      }
    });
    if ([...primary].some(pid=>!covered.has(pid))) throw new Error('agenda items must cover all primary papers');
  }
  const contentSources = new Set(slides.filter((_,i)=>!['cover','agenda','closing'].includes(types[i]))
    .flatMap(s=>[...(s.evidence_ids||[]),...(s.claims||[]).flatMap(c=>c.sources||[])]));
  for (const paper of papers.papers.filter(p=>primary.has(p.paper_id))) {
    if (!(paper.evidence||[]).some(e=>contentSources.has(e.evidence_id))) throw new Error(`${paper.paper_id}: primary paper needs its own evidence on an actual content slide; agenda declarations cannot substitute for content`);
  }
  return { primary_paper_ids:[...primary], agenda_items:agendaItems, closing_index:endings[0]??null };
}
function citationsFor(slide, papers, evidence) {
  const ids = [...new Set([...(slide.evidence_ids || []), ...(slide.claims || []).flatMap(claim => claim.sources || [])])];
  const sourceNotes = (slide.paper_ids || []).map(id => {
    const p = papers.papers.find(paper => paper.paper_id === id);
    const title = p.citation || [p.title, p.authors?.join?.(', ') || p.authors, p.journal, p.year, p.doi && `DOI: ${p.doi}`].filter(Boolean).join('. ');
    return `${id}: ${title || p.source_filename || id}`;
  });
  for (const id of ids) {
    const e = evidence.get(id);
    if (!e) throw new Error(`Unknown evidence: ${id}`);
    sourceNotes.push(`${id}: PDF第${e.pdf_page ?? '未确定'}页${e.printed_page ? `，印刷页${e.printed_page}` : ''}，${e.locator}。${e.source_excerpt || ''}`);
  }
  for (const claim of slide.claims || []) {
    const kinds = { paper: '论文陈述', analysis: '阅读分析', hypothesis: '待检验假设' };
    sourceNotes.push(`${kinds[claim.provenance]}：${claim.text} [${claim.sources.join(', ')}]`);
  }
  // Keep on-slide sources short. Exact figure/paragraph locations remain in notes.
  const byPaper = new Map();
  for (const id of ids) { const ev = evidence.get(id); const pid = ev.paper.paper_id; if (!byPaper.has(pid)) byPaper.set(pid, new Set()); if (ev.pdf_page) byPaper.get(pid).add(ev.pdf_page); }
  const footer = [...byPaper].map(([pid, pages]) => `${pid}，PDF第${[...pages].sort((a,b)=>a-b).join('、')}页`).join('；');
  return { notes: sourceNotes.join('\n\n'), footer: footer ? `来源：${footer}。详见本页备注。` : '' };
}
function asLines(value) { if (value === undefined || value === '') return []; return Array.isArray(value) ? value : [value]; }
function assertString(value, field) { if (typeof value !== 'string') throw new Error(`${field} must be text (numbers require a display string or condition_ref)`); }

export async function authorDeck({ runtime, workdir, plan, papers, fontFamily, themeId }) {
  const structure = checkDeckStructure(plan, papers);
  const navigation = resolveNavigation(plan, papers);
  const theme = getTheme(themeId);
  const { Presentation, sharp } = runtime;
  const presentation = Presentation.create({ slideSize: { width: STYLE.width, height: STYLE.height } });
  const components = createComponents(fontFamily,theme.theme_id), resolve = makeResolver(papers), evidence = evidenceIndex(papers);
  const assets = [], nativeTableSlides = [], methodSlides = [], customModules = [], layoutDiagnostics = [];
  let currentEvidenceRefs = new Set();
  async function addFigure(slide, id, box) {
    if (!currentEvidenceRefs.has(id)) throw new Error(`${id}: addFigure must use evidence declared on the current slide`);
    const ev = evidence.get(id);
    if (!ev?.asset_path) throw new Error(`${id}: rendered figure requires evidence.asset_path`);
    const source = path.resolve(workdir, ev.asset_path), bytes = await fs.readFile(source);
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height || !['png','jpeg','webp'].includes(meta.format)) throw new Error(`${id}: use a readable PNG, JPEG or WebP evidence image`);
    const [x,y,w,h] = box, scale = Math.min(w / meta.width, h / meta.height), width = meta.width * scale, height = meta.height * scale;
    const position = { left:x+(w-width)/2, top:y+(h-height)/2, width, height };
    const image = slide.images.add({ blob: new Uint8Array(bytes), contentType: `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}`, alt: `${id}: ${ev.locator}`, fit: 'contain', position });
    assets.push({ evidence_id:id, path:source, sha256:sha256(bytes), source_pixels:[meta.width,meta.height], position });
    return image;
  }
  for (let index = 0; index < plan.slides.length; index++) {
    const spec = resolve(plan.slides[index]), r = spec.render;
    currentEvidenceRefs = new Set([...(spec.evidence_ids || []), ...(spec.claims || []).flatMap(claim => claim.sources || [])]);
    if (!r?.type) throw new Error(`${spec.slide_id}: render.type is required. Select a built-in type or custom; the builder does not infer scientific copy from claims.`);
    const supported = {
      cover:['type','subtitle','body'],text:['type','subtitle','body','takeaway'],summary:['type','subtitle','body','takeaway'],
      explanation:['type','sections','takeaway'],
      'single-figure':['type','body','figures','takeaway'],'two-figures':['type','figures','takeaway'],
      table:['type','subtitle','table','body','takeaway'],methods:['type','input','steps','stop','output'],closing:['type'],agenda:['type','items'],
    };
    if (supported[r.type]) for (const key of Object.keys(r)) if (!supported[r.type].includes(key)) throw new Error(`${spec.slide_id}: ${r.type} does not support render.${key}; use a documented field or custom layout. Content is never silently omitted.`);
    assertString(spec.title, `${spec.slide_id}.title`);
    const body = asLines(r.body); body.forEach(value=>assertString(value,'render.body'));
    const slide = presentation.slides.add(); slide.background.fill = components.colors.white;
    const sources = citationsFor(spec, papers, evidence);
    slide.speakerNotes.textFrame.setText(sources.notes);
    const isContent = !['cover','closing','agenda'].includes(r.type), heading = navigation.headings?.[spec.slide_id];
    const pageTitleCreated = isContent && Boolean(heading);
    if (isContent) components.header(slide, heading?.header || spec.title, index + 1);
    if (pageTitleCreated) components.pageTitle(slide, spec.title);
    const bottom = r.takeaway ? 581 : 641;
    const contentArea = { x:62, y:pageTitleCreated ? 160 : 110, left:62, top:pageTitleCreated ? 160 : 110, width:1154, bottom,
      height:bottom-(pageTitleCreated ? 160 : 110) };
    if (r.type === 'cover') components.cover(slide, spec.title, { ...r, body });
    else if (r.type === 'closing') components.closing(slide);
    else if (r.type === 'agenda') components.agenda(slide,resolve(structure.agenda_items[spec.slide_id]));
    else if (r.type === 'text' || r.type === 'summary') {
      let top = pageTitleCreated ? 160 : 121;
      if (r.subtitle) { components.label(slide, r.subtitle, 64, top, 1150, 27); top += 64; }
      // Keep a subtitle attached to its paragraphs. Sparse copy needs a different
      // composition, not unlimited paragraph spacing or invented content.
      const geometry=components.paragraphs(slide, body, [64,top,1150,bottom-top], r.type === 'summary' ? 28 : 27, 28,r.subtitle?'top':'balanced');
      if(geometry.sparse)layoutDiagnostics.push({slide:index+1,slide_id:spec.slide_id,code:'sparse-text',
        estimated_natural_height:geometry.naturalHeight,available_height:bottom-top,
        action:'Review composition: use substantive explanation sections, a source figure, an editable relationship diagram, or redistribute content. Do not stretch text to fill space.'});
    } else if(r.type==='explanation') {
      components.explanation(slide,r.sections,[contentArea.x,contentArea.y,contentArea.width,contentArea.height]);
    } else if (r.type === 'single-figure' || r.type === 'two-figures') {
      const count = r.type === 'single-figure' ? 1 : 2;
      if (r.figures?.length !== count) throw new Error(`${spec.slide_id}: ${r.type} requires exactly ${count} figure(s)`);
      if (r.type === 'two-figures' && body.length) throw new Error('two-figures: use each figure caption for prose or a custom layout; body would be omitted');
      if (r.subtitle) throw new Error(`${r.type}: use per-figure label instead of subtitle`);
      const boxWidth = count === 1 && !body.length ? 1154 : 550;
      for (let j = 0; j < count; j++) {
        const figure = r.figures[j], x = 62 + j * 604;
        const top = figure.label ? contentArea.top + 51 : contentArea.top;
        const capHeight = figure.caption ? Math.max(32,estimatedLines(figure.caption,boxWidth-8,23)*23*1.35+2) : 0;
        if(capHeight>110)throw new Error(`${spec.slide_id}: figure caption needs too much height; shorten it or use a custom layout`);
        await addFigure(slide, figure.evidence_id, [x,top,boxWidth,bottom-top-capHeight-12]);
        const actualImage=assets.at(-1).position;
        if (figure.label) components.label(slide,figure.label,x+3,actualImage.top-51,boxWidth-6);
        if (figure.caption) components.text(slide, figure.caption, x+4,actualImage.top+actualImage.height+12,boxWidth-8,capHeight,23,{label:'figure caption'});
        if(actualImage.height < (bottom-top-capHeight-12)*0.5)layoutDiagnostics.push({slide:index+1,slide_id:spec.slide_id,
          code:'shallow-figure',evidence_id:figure.evidence_id,
          action:'Review the actual figure size and surrounding space; consider stacked figures, a wider figure-led composition, or a different page allocation. Preserve image aspect ratio and labels.'});
      }
      if (count === 1 && body.length) { const bodyTop = pageTitleCreated ? 160 : 121; components.paragraphs(slide,body,[671,bodyTop,535,bottom-bodyTop],24,24,'balanced'); }
    } else if (r.type === 'table') {
      if (!r.table) throw new Error(`${spec.slide_id}: missing render.table`);
      let top = pageTitleCreated ? 160 : 113;
      if (r.subtitle) { components.label(slide,r.subtitle,64,top,1150); top += 56; }
      const bodySpace = body.length ? 120 : 0;
      components.nativeTable(slide,[r.table.headers,...r.table.rows],[62,top,1154,bottom-top-bodySpace],r.table.column_widths);
      nativeTableSlides.push(index+1);
      if(body.length) components.paragraphs(slide,body,[64,bottom-bodySpace+25,1150,bodySpace-25],23,15);
    } else if (r.type === 'methods') {
      if (body.length || r.subtitle || r.takeaway) throw new Error('methods: use input, steps, stop and output; body/subtitle/takeaway are not supported');
      components.methods(slide,r.steps,{...r,pageTitleCreated}); methodSlides.push(index+1);
    } else if (r.type === 'custom') {
      if (!r.custom_module) throw new Error('custom: provide an authored custom_module relative to the task directory');
      const moduleFile = path.resolve(workdir,r.custom_module);
      customModules.push({path:moduleFile,sha256:await fileHash(moduleFile)});
      const custom = await import(pathToFileURL(moduleFile).href);
      if (typeof custom.default !== 'function') throw new Error('custom_module must export default async function');
      await custom.default({ slide, components, presentation, slideSpec:spec, resolve, addFigure,
        contentArea, pageTitleCreated, navigationHeading:heading || null });
    } else throw new Error(`Unsupported render type: ${r.type}`);
    if (!['cover','closing','agenda'].includes(r.type)) { if (r.type !== 'methods' && r.takeaway) components.takeaway(slide,r.takeaway); components.footer(slide,sources.footer); }
  }
  return { presentation, assets, nativeTableSlides, methodSlides, customModules, theme, navigation, layoutDiagnostics };
}

function privatePath(workdir, candidate, defaultPath) {
  const resolved = path.resolve(workdir,candidate || defaultPath), relative = path.relative(path.join(workdir,'_work'),resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Drafts and receipts must stay inside workdir/_work; only workflow finalize writes a deliverable');
  return resolved;
}
async function noOverwrite(file) { try { await fs.access(file); throw new Error(`Refusing to overwrite ${file}; use a new path`); } catch(error) { if (error.code !== 'ENOENT') throw error; } }
export function representativePreviewNumbers(slides) {
  const seen = new Set(), numbers = [];
  slides.forEach((slide,index) => {
    const render = slide.render;
    if (!render?.type) throw new Error('Representative previews require each slide\'s actual render.type');
    const key = render.type === 'custom' ? `custom:${index}` : render.type === 'single-figure'
      ? `single-figure:${asLines(render.body).length ? 'with-body' : 'full-width'}` : render.type;
    if (!seen.has(key)) { seen.add(key); numbers.push(index+1); }
  });
  return numbers;
}
export function previewNumbers(value, count, slides, diagnostics=[]) {
  if (!value || value === 'none') return [];
  if (value === 'all') return Array.from({length:count},(_,i)=>i+1);
  if (value === 'representative') {
    if (!Array.isArray(slides) || slides.length !== count) throw new Error('Representative previews require a matching deck plan (use --build-receipt for exported drafts), or select explicit slide numbers');
    const riskPages=diagnostics.map(item=>item.slide);
    if(riskPages.some(n=>!Number.isInteger(n)||n<1||n>count))throw new Error('Layout diagnostics contain an invalid slide number');
    return [...new Set([...representativePreviewNumbers(slides),...riskPages])].sort((a,b)=>a-b);
  }
  const numbers = value.split(',').map(Number);
  if (!numbers.length || numbers.some(n=>!Number.isInteger(n)||n<1||n>count)) throw new Error(`--preview must be none, all, representative or comma-separated slide numbers 1–${count}`);
  return [...new Set(numbers)];
}
export async function renderSlides(presentation, directory, numbers, scale=1.25) {
  await fs.mkdir(directory,{recursive:true});
  const files=[];
  for (const n of numbers) {
    const slide = presentation.slides.items[n-1], prefix = path.join(directory,`slide-${String(n).padStart(2,'0')}`);
    const png = await presentation.export({slide,format:'png',scale});
    await fs.writeFile(`${prefix}.png`,new Uint8Array(await png.arrayBuffer()));
    await fs.writeFile(`${prefix}.layout.json`,await (await slide.export({format:'layout'})).text());
    files.push({slide:n,png:`${prefix}.png`,png_sha256:await fileHash(`${prefix}.png`)});
  }
  return files;
}
async function buildContext(workdir, source, receiptFile, python) {
  const receiptPath = path.resolve(workdir,receiptFile || `${source}.build.json`), receipt = await json(receiptPath);
  if (receipt.operation !== 'build-draft' || receipt.pptx_sha256 !== await fileHash(source)) throw new Error('Build receipt does not match the actual candidate PPTX');
  const planFile=path.join(workdir,'_work/deck-plan.json'), paperFile=path.join(workdir,'_work/papers.json');
  if (receipt.deck_plan_sha256 !== await fileHash(planFile) || receipt.papers_sha256 !== await fileHash(paperFile)) throw new Error('Build receipt is stale: plan or paper evidence changed; rebuild before finalization');
  const [plan,papers,run]=await Promise.all([json(planFile),json(paperFile),json(path.join(workdir,'_work/run.json'))]);
  if (receipt.slide_count !== plan.slides.length || receipt.slide_count !== run.target_slide_count || receipt.requirements?.explicitTotalSlideCount !== run.target_slide_count) throw new Error('Build requirements do not preserve the user-confirmed total slide count');
  if (!receipt.fontPolicy || typeof receipt.fontPolicy !== 'object') throw new Error('Build receipt must declare its actual fontPolicy');
  const theme=confirmedTheme(workdir,python);
  if (receipt.theme_id!==theme.theme_id || receipt.palette_sha256!==theme.palette_sha256) throw new Error('Build receipt is stale: confirmed theme changed; rebuild before finalization');
  return { receipt, receiptPath, plan, papers, slides:makeResolver(papers)(plan.slides) };
}
function confirmedTheme(workdir,python) {
  if (!path.isAbsolute(python || '')) throw new Error('Pass absolute --python or RUNTIME_PYTHON from load_workspace_dependencies');
  const selected=spawnSync(python,[path.join(SCRIPT_DIR,'workflow.py'),'get-theme','--workdir',workdir],{encoding:'utf8'});
  if(selected.error||selected.status!==0)throw new Error(`get-theme failed: ${(selected.stderr||selected.stdout||selected.error?.message||'unknown failure').trim()}`);
  const selection=JSON.parse(selected.stdout);
  if(selection.palette_sha256!==getTheme(selection.theme_id).palette_sha256)throw new Error('Confirmed theme palette does not match the current registry; recheck the saved selection before authoring');
  return selection;
}
export function finalizationOptions({workdir,source,output,skillDir,python,receipt,receiptPath}) {
  if (!path.isAbsolute(skillDir || '')) throw new Error('Pass --presentations-skill ABS for the current installed Presentations skill');
  if (!path.isAbsolute(python || '')) throw new Error('Pass absolute --python or RUNTIME_PYTHON from load_workspace_dependencies');
  const tableOwners=receipt.requirements.requiredNativeTableOwnerSlides || [];
  return { ...receipt.requirements, workspaceDir:workdir, candidatePath:source, finalPath:output,
    pythonExecutable:python,
    integrityValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_package_integrity.py'),
    layoutValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_layout_geometry.py'),
    layoutArgs:['--expected-slide-size-emu',`${STYLE.width*9525},${STYLE.height*9525}`,'--validate-bullet-geometry','--validate-heading-fit',...tableOwners.flatMap(n=>['--require-native-table-slide',String(n)])],
    fontPolicy:receipt.fontPolicy, verifyArtifactToolImport:true, receiptPath };
}
async function finalizeCandidate({workdir,source,output,skillDir,python,moduleDir,context}) {
  const validationDir=path.join(workdir,'_work/finalization',`${path.basename(output)}-${Date.now()}`);
  const options=finalizationOptions({workdir,source,output,skillDir,python,receipt:context.receipt,receiptPath:path.join(validationDir,'validation.json')});
  const helper=path.join(skillDir,'container_tools/artifact_tool_utils.mjs');
  await fs.access(helper); await noOverwrite(output);
  await fs.mkdir(path.dirname(output),{recursive:true}); await fs.mkdir(validationDir,{recursive:true});
  // The supported finalizer spawns its own Artifact Tool import. Configure that
  // child process from the same discovered runtime without mutating caller env.
  const script=`import fs from 'node:fs'; import {pathToFileURL} from 'node:url';
    const {finalizePresentation}=await import(pathToFileURL(process.argv[1]).href);
    try { await finalizePresentation(JSON.parse(fs.readFileSync(0,'utf8'))); }
    catch(error) { console.error(error.stack || error.message); process.exitCode=1; }`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,helper],{
    input:JSON.stringify(options),encoding:'utf8',maxBuffer:4*1024*1024,timeout:300000,
    env:{...process.env,RUNTIME_NODE_MODULES:moduleDir,RUNTIME_NODE:process.execPath,RUNTIME_PYTHON:python,PYTHONDONTWRITEBYTECODE:'1'},
  });
  if (result.error || result.status !== 0) throw new Error(`Presentations finalization failed: ${(result.stderr || result.stdout || result.error?.message || 'unknown failure').trim()}`);
  const validation=await json(options.receiptPath);
  if (validation.finalSha256 !== await fileHash(output) || validation.firstPartyImport?.passed !== true) throw new Error('Finalization receipt does not verify the checked PPTX and its actual import');
  return {validation_receipt:options.receiptPath,validation_receipt_sha256:await fileHash(options.receiptPath),
    build_receipt:context.receiptPath,build_receipt_sha256:await fileHash(context.receiptPath),presentations_skill:skillDir};
}
export async function renderExportedPptx({runtime,workdir,source,directory,preview='all',scale=1.25,slides,layoutDiagnostics=[],finalization}) {
  const started=Date.now(),hash=await fileHash(source);
  const p=await runtime.PresentationFile.importPptx(await runtime.FileBlob.load(source)),count=p.slides.items.length;
  const numbers=previewNumbers(preview,count,slides,layoutDiagnostics),complete=numbers.length===count;
  await noOverwrite(directory);
  const files=await renderSlides(p,directory,numbers,scale);
  if (hash !== await fileHash(source)) throw new Error('PPTX changed while its exported slides were rendering');
  const receipt={schema_version:1,operation:'render-exported-pptx',pptx:source,pptx_sha256:hash,slide_count:count,
    render_count:files.length,rendered_slide_numbers:numbers,complete,render_scope:complete?'all':'selected',
    selection:preview,slides:files,...(finalization?{finalization}:{}),duration_seconds:(Date.now()-started)/1000,
    review_status:'pending-human-or-agent-visual-review'};
  await fs.writeFile(path.join(directory,'render-receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({pptx:source,rendered:files.length,complete,directory,receipt:path.join(directory,'render-receipt.json'),
    ...(finalization?{validation_receipt:finalization.validation_receipt}:{})}));
  return receipt;
}
export async function main(argv=process.argv.slice(2)) {
  const args=parseArgs(argv);
  if (args.help) { console.log('Build: --workdir DIR --font FAMILY [--out _work/build/revision.pptx] [--preview none|representative|1,3|all]\nFinalize and render actual file: --workdir DIR --finalize-pptx PATH --presentations-skill ABS [--out _work/checked/revision.pptx] [--build-receipt PATH]\nRender actual file: --workdir DIR --render-pptx PATH [--preview 1,3|all] [--out _work/previews/NEW_DIR]\nFinalization and exported rendering default to all slides; selected previews are intermediate checks only. No command approves review.\nRuntime: RUNTIME_NODE_MODULES and RUNTIME_PYTHON from load_workspace_dependencies, or --runtime-node-modules ABS --python ABS. See references/build-api.md.'); return; }
  const workdir=resolveWorkdir(args.workdir), started=Date.now(), moduleDir=args['runtime-node-modules']||process.env.RUNTIME_NODE_MODULES;
  const runtime=await loadRuntime(moduleDir);
  const scale=Number(args.scale||1.25); if(!Number.isFinite(scale)||scale<0.5||scale>3)throw new Error('--scale must be between 0.5 and 3');
  if(args['render-pptx']) {
    const source=path.resolve(workdir,args['render-pptx']), hash=await fileHash(source);
    const dir=privatePath(workdir,args.out,`_work/previews/exported-${hash.slice(0,12)}-${Date.now()}`);
    const context=args.preview==='representative'?await buildContext(workdir,source,args['build-receipt'],args.python||process.env.RUNTIME_PYTHON):undefined;
    return renderExportedPptx({runtime,workdir,source,directory:dir,preview:args.preview||'all',scale,slides:context?.slides,layoutDiagnostics:context?.receipt.layout_diagnostics});
  }
  if(args['finalize-pptx']) {
    const source=privatePath(workdir,args['finalize-pptx']),python=args.python||process.env.RUNTIME_PYTHON;
    const context=await buildContext(workdir,source,args['build-receipt'],python);
    // Validate selection before creating a checked file; final rendering defaults to all.
    previewNumbers(args.preview||'all',context.receipt.slide_count,context.slides,context.receipt.layout_diagnostics);
    const output=privatePath(workdir,args.out,`_work/checked/checked-${Date.now()}.pptx`);
    const finalization=await finalizeCandidate({workdir,source,output,skillDir:args['presentations-skill'],python,moduleDir,context});
    const dir=privatePath(workdir,null,`_work/previews/checked-${(await fileHash(output)).slice(0,12)}-${Date.now()}`);
    return renderExportedPptx({runtime,workdir,source:output,directory:dir,preview:args.preview||'all',scale,slides:context.slides,layoutDiagnostics:context.receipt.layout_diagnostics,finalization});
  }
  const python=args.python||process.env.RUNTIME_PYTHON;
  if(!path.isAbsolute(python||''))throw new Error('Pass absolute --python or RUNTIME_PYTHON from load_workspace_dependencies');
  if(!args.font?.trim())throw new Error('--font is required: use a verified installed family matching the reference or document the fallback');
  const themeSelection=confirmedTheme(workdir,python),theme=getTheme(themeSelection.theme_id);
  const checked=spawnSync(python,[path.join(SCRIPT_DIR,'workflow.py'),'check-plan','--workdir',workdir],{encoding:'utf8'});
  if(checked.error||checked.status!==0)throw new Error(`check-plan failed: ${(checked.stderr||checked.stdout||checked.error?.message||'unknown failure').trim()}`);
  const planFile=path.join(workdir,'_work/deck-plan.json'),paperFile=path.join(workdir,'_work/papers.json'),run=await json(path.join(workdir,'_work/run.json'));
  const [plan,papers]=await Promise.all([json(planFile),json(paperFile)]);
  if(plan.slides.length!==run.target_slide_count)throw new Error('Plan does not match the user-confirmed total slide count');
  previewNumbers(args.preview,plan.slides.length,makeResolver(papers)(plan.slides));
  const candidate=privatePath(workdir,args.out,`_work/build/candidate-${Date.now()}.pptx`); await noOverwrite(candidate); await fs.mkdir(path.dirname(candidate),{recursive:true});
  const authorStarted=Date.now(), authored=await authorDeck({runtime,workdir,plan,papers,fontFamily:args.font,themeId:themeSelection.theme_id});
  await (await runtime.PresentationFile.exportPptx(authored.presentation)).save(candidate);
  const authorSeconds=(Date.now()-authorStarted)/1000;
  const reviewNumbers=previewNumbers(args.preview,plan.slides.length,makeResolver(papers)(plan.slides),authored.layoutDiagnostics);
  const files=await renderSlides(authored.presentation,`${candidate}.previews`,reviewNumbers,scale);
  const receipt={schema_version:1,operation:'build-draft',theme_id:theme.theme_id,theme_label:theme.label,palette_sha256:theme.palette_sha256,legacy_theme_default:themeSelection.legacy_default,runtime_version:runtime.runtimeVersion,pptx:candidate,pptx_sha256:await fileHash(candidate),papers_sha256:await fileHash(paperFile),deck_plan_sha256:await fileHash(planFile),builder_sha256:await fileHash(fileURLToPath(import.meta.url)),components_sha256:await fileHash(path.join(SCRIPT_DIR,'deck_components.mjs')),custom_modules:authored.customModules,navigation:authored.navigation,navigation_sha256:await fileHash(path.join(SCRIPT_DIR,'navigation.mjs')),slide_count:plan.slides.length,render_count:files.length,previews:files,assets:authored.assets,requirements:{explicitTotalSlideCount:run.target_slide_count,requiredNativeTableOwnerSlides:authored.nativeTableSlides,requiredNativeChartOwnerSlides:[]},fontPolicy:{basis:'design',families:[args.font]},method_slides:authored.methodSlides,timings:{author_export_seconds:authorSeconds,total_seconds:(Date.now()-started)/1000},review_status:'pending-scientific-exported-visual-and-editability-review'};
  receipt.layout_diagnostics=authored.layoutDiagnostics;
  await fs.writeFile(`${candidate}.build.json`,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({candidate,receipt:`${candidate}.build.json`,slide_count:plan.slides.length,draft_preview_count:files.length,composition_review_pages:[...new Set(authored.layoutDiagnostics.map(item=>item.slide))]}));return receipt;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
