import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeResolver, main, loadRuntime, sha256, checkDeckStructure, authorDeck, renderSlides, resolveWorkdir, parseArgs, previewNumbers, finalizationOptions } from '../scripts/build_deck.mjs';
import { assertTextFits, createComponents, paragraphGeometry, explanationGeometry, validateReportMetadata, REPORT_TITLE, CLOSING_TEXT } from '../scripts/deck_components.mjs';
import { getTheme } from '../scripts/themes.mjs';

test('workdir resolves relative paths and requires an explicit value',()=>{
  assert.equal(resolveWorkdir('relative-task'),path.resolve('relative-task'));
  assert.equal(resolveWorkdir('/absolute-task'),'/absolute-task');
  assert.throws(()=>resolveWorkdir(' '),/required/);
  assert.throws(()=>parseArgs(['--render-pptx','a','--finalize-pptx','b']),/one operation/);
});
test('representative previews follow actual render types, both single-figure geometries and every custom slide',()=>{
  const renders=[{type:'cover'},{type:'text'},{type:'text'},{type:'single-figure',body:[]},
    {type:'single-figure',body:''},{type:'single-figure',body:'Explain'},
    {type:'single-figure',body:['Explain']},{type:'table'},{type:'table'},
    {type:'custom',custom_module:'same.mjs'},{type:'custom',custom_module:'same.mjs'},
    {type:'summary'},{type:'closing'}];
  const slides=renders.map(render=>({layout_id:'same-layout-id',render}));
  assert.deepEqual(previewNumbers('representative',slides.length,slides),[1,2,4,6,8,10,11,12,13]);
  const diagnostics=[{slide:3,code:'sparse-text'},{slide:7,code:'shallow-figure'},{slide:3,code:'sparse-text'}];
  assert.deepEqual(previewNumbers('representative',slides.length,slides,diagnostics),[1,2,3,4,6,7,8,10,11,12,13]);
  assert.deepEqual(previewNumbers('none',slides.length,slides,diagnostics),[]);
  assert.deepEqual(previewNumbers('2',slides.length,slides,diagnostics),[2]);
  assert.throws(()=>previewNumbers('representative',slides.length,slides,[{slide:14}]),/invalid slide number/);
  assert.deepEqual(previewNumbers(undefined,13),[]);
  assert.deepEqual(previewNumbers('2,2,1',13),[2,1]);
  assert.equal(previewNumbers('all',13).length,13);
  assert.throws(()=>previewNumbers('representative',13),/matching deck plan/);
  assert.throws(()=>previewNumbers('0,2',13),/1–13/);
});
test('representative previews cover each explanation section count and takeaway geometry while retaining risk pages',()=>{
  const slides=[];
  for(const count of [2,3,4]) for(const takeaway of ['', '关键结论']) {
    const render={type:'explanation',sections:Array.from({length:count},()=>({title:'说明',body:'正文'})),takeaway};
    slides.push({render},{render:{...render}});
  }
  assert.deepEqual(previewNumbers('representative',slides.length,slides),[1,3,5,7,9,11]);
  assert.deepEqual(previewNumbers('representative',slides.length,slides,[{slide:6,code:'composition-risk'},{slide:12,code:'composition-risk'}]),[1,3,5,6,7,9,11,12]);
  const noTakeaway=[{render:{type:'explanation',sections:slides[0].render.sections}},slides[0]];
  assert.deepEqual(previewNumbers('representative',noTakeaway.length,noTakeaway),[1]);
});
test('the densest explanation represents its geometry while risk pages and explicit selections stay intact',()=>{
  const slide=(rows,body)=>({render:{type:'explanation',sections:Array.from({length:rows},()=>({title:'说明',body}))}});
  const slides=[slide(4,'短句'),slide(4,'较长的中英文混排解释 VMD 和 FMD，实际换行仍须检查。'),
    slide(4,'中等长度的句子'),slide(3,'短句'),slide(3,'另一种布局中较长的说明文字')];
  assert.deepEqual(previewNumbers('representative',slides.length,slides),[2,5]);
  const diagnostics=[{slide:1,code:'composition-risk'},{slide:4,code:'composition-risk'}];
  assert.deepEqual(previewNumbers('representative',slides.length,slides,diagnostics),[1,2,4,5]);
  assert.deepEqual(previewNumbers('1,3',slides.length,slides,diagnostics),[1,3]);
  assert.deepEqual(previewNumbers('all',slides.length,slides),[1,2,3,4,5]);
});
test('finalization forwards actual requirements and fonts while retaining mandatory validators and import',()=>{
  const fontPolicy={basis:'user_request',families:['Requested font']};
  const requirements={explicitTotalSlideCount:4,requiredNativeTableOwnerSlides:[2],requiredNativeChartOwnerSlides:[3],
    requiredEmbeddedWorkbookChartOwnerSlides:[3],verifyArtifactToolImport:false,layoutArgs:['--skip'],receiptPath:'/bad'};
  const options=finalizationOptions({workdir:'/task',source:'/task/_work/a.pptx',output:'/task/_work/checked/b.pptx',
    skillDir:'/installed/presentations',python:'/runtime/python',receipt:{requirements,fontPolicy},receiptPath:'/task/_work/checks/receipt.json'});
  assert.equal(options.explicitTotalSlideCount,4);
  assert.deepEqual(options.requiredNativeTableOwnerSlides,[2]);
  assert.deepEqual(options.requiredEmbeddedWorkbookChartOwnerSlides,[3]);
  assert.deepEqual(options.fontPolicy,fontPolicy);
  assert.equal(options.verifyArtifactToolImport,true);
  assert.deepEqual(options.layoutArgs,['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','2']);
  assert.equal(options.receiptPath,'/task/_work/checks/receipt.json');
  assert.throws(()=>finalizationOptions({receipt:{requirements},skillDir:'relative'}),/current installed/);
});

test('four palettes are explicit and unknown ids cannot silently select blue',()=>{
  const expected={blue:'#32497B',teal:'#2F6B76',red:'#AD2C34',purple:'#671D6F'};
  for(const [id,primary] of Object.entries(expected)){
    const theme=getTheme(id),c=createComponents('Source Han Sans CN',id);
    assert.equal(theme.colors.primary,primary);assert.equal(c.colors.blue,primary);
    assert.equal(c.colors.on_primary,theme.colors.on_primary);assert.equal(c.colors.muted_on_primary,theme.colors.muted_on_primary);
    assert.equal(c.paletteSha256,theme.palette_sha256);
  }
  assert.throws(()=>getTheme('orange'),/Unknown theme_id/);
  assert.throws(()=>getTheme(undefined),/explicit supported theme_id/);
});

test('shared experimental conditions resolve identically and fail closed', () => {
  const resolve = makeResolver({papers:[{experiments:[{experiment_id:'P1:ExpA',values:{fs:'20 kHz'}}]}]});
  assert.deepEqual(resolve(['采样率 {{P1:ExpA.fs}}',{condition_ref:'P1:ExpA.fs'}]),['采样率 20 kHz','20 kHz']);
  assert.throws(()=>resolve('{{P1:ExpA.missing}}'),/Unresolved condition/);
  assert.throws(()=>resolve({condition_ref:'P1:ExpA.fs',unit:'Hz'}),/only its string/);
});
test('overfull body text produces an error instead of shrinking or discarding evidence', () => {
  assert.throws(()=>assertTextFits('原文证据'.repeat(100),535,80,24,'body'),/not be shrunk or truncated/);
});
test('short paragraphs are flagged even after balanced placement; spacing is bounded',()=>{
  const lines=['周期冲击提示轴承局部故障。','随机冲击与谐波干扰特征提取。','FMD以相关峭度引导滤波。'];
  const box=[64,160,1150,421],top=paragraphGeometry(lines,box,27,28),balanced=paragraphGeometry(lines,box,27,28,'balanced');
  assert.equal(top.sparse,true);assert.equal(balanced.sparse,true);
  assert.ok(balanced.boxes[0][1]>top.boxes[0][1]);assert.ok(balanced.gap<=48);
  for(let i=0;i<lines.length;i++){
    assert.equal(balanced.boxes[i][3],top.boxes[i][3]);
    assert.ok(balanced.boxes[i][1]>=box[1]);assert.ok(balanced.boxes[i][1]+balanced.boxes[i][3]<=box[1]+box[3]+1);
    if(i)assert.ok(balanced.boxes[i][1]>balanced.boxes[i-1][1]+balanced.boxes[i-1][3]);
  }
  const moderate=paragraphGeometry(Array(4).fill('证据'.repeat(32)),box,27,28,'balanced');
  assert.equal(moderate.sparse,false);
  assert.throws(()=>paragraphGeometry(['证据'.repeat(500)],box,27,28,'balanced'),/too much text/);
});
test('explanation compositions preserve hierarchy, readable type and nonoverlapping bounds',()=>{
  const sections=[{title:'核心结论',body:'振动信号包含目标冲击与多种干扰。'},{title:'适用边界',body:'结论仍需在其他条件下独立验证。'},{title:'验证方向',body:'统一比较条件并保留来源和限定。'}];
  const box=[62,160,1154,421];
  for(const composition of ['prose','focus-left','focus-top','sequence']) {
    const before=structuredClone(sections),items=explanationGeometry(sections,box,composition);
    const boxes=items.flatMap(item=>[item.title,item.body,...(item.number?[item.number]:[])]);
    for(const [x,y,w,h] of boxes) {
      assert.ok(x>=box[0] && y>=box[1]);
      assert.ok(x+w<=box[0]+box[2]+1 && y+h<=box[1]+box[3]+1);
    }
    boxes.forEach((a,i)=>boxes.slice(i+1).forEach(b=>{
      const overlap=Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0])>0.01 && Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1])>0.01;
      assert.equal(overlap,false,`${composition}: text boxes overlap`);
    }));
    items.forEach(item=>{
      assert.equal(item.title[0],item.body[0]);
      assert.ok(item.body[1]>item.title[1]+item.title[3]);
      assert.ok(item.bodySize>=26);
      assert.equal(item.divider,undefined);
    });
    if(composition.startsWith('focus-')) {
      assert.ok(items[0].bodySize>items[1].bodySize);
      assert.equal(items[0].emphasis,true);
      if(composition==='focus-left')assert.ok(items[1].title[0]>items[0].title[0]+items[0].title[2]);
      else assert.ok(items[1].title[1]>items[0].body[1]+items[0].body[3]);
    }
    assert.deepEqual(sections,before);
  }
  const four=[...sections,sections[1]];
  for(const composition of ['prose','sequence'])assert.doesNotThrow(()=>explanationGeometry(four,[62,160,1154,481],composition));
  assert.throws(()=>explanationGeometry(four,box,'focus-top'),/1–2 supporting/);
  assert.throws(()=>explanationGeometry(sections,box,'rows'),/unknown composition/);
  assert.throws(()=>explanationGeometry([sections[0]],box),/2–4/);
  assert.throws(()=>explanationGeometry([{title:'甲',body:'',extra:'不可丢失'},sections[1]],box),/nonempty/);
});
test('explanation overflow identifies the composition and section without changing copy',()=>{
  const sections=[{title:'首组',body:'简短正文'},{title:'需要重排',body:'证据'.repeat(200)},{title:'第三组',body:'简短正文'}];
  const before=structuredClone(sections);
  for(const composition of ['prose','focus-left','focus-top','sequence']) {
    assert.throws(()=>explanationGeometry(sections,[62,160,1154,421],composition),error=>{
      assert.match(error.message,/section 2 \("需要重排"\): text requires \d+\.\d px, available \d+\.\d px;.*never shrink/);
      assert.ok(error.message.includes(composition));return true;
    });
  }
  assert.deepEqual(sections,before);
  const longTitle='很长的标题'.repeat(10);
  assert.throws(()=>explanationGeometry([{title:longTitle,body:'正文'},sections[0]],[62,160,1154,180]),error=>{
    assert.ok(error.message.includes(`section 1 ("${Array.from(longTitle).slice(0,24).join('')}…")`));
    assert.ok(!error.message.includes(longTitle));return true;
  });
});
test('representative previews separately cover explanation compositions',()=>{
  const sections=[{title:'主点',body:'正文'},{title:'支撑',body:'依据'}];
  const slides=['prose','focus-left','focus-top','sequence',undefined].map(composition=>({render:{type:'explanation',sections,...(composition?{composition}:{})}}));
  assert.deepEqual(previewNumbers('representative',slides.length,slides),[1,2,3,4]);
});
test('authoring adds the slide id to explanation failures and preserves the original cause without rendering',async()=>{
  const shape=()=>{const text={};return {get text(){return text;},set text(value){text.value=value;}};};
  const runtime={Presentation:{create:()=>({slides:{add:()=>({background:{},shapes:{add:shape},speakerNotes:{textFrame:{setText(){}}}})}})}};
  const papers={papers:[{paper_id:'P1',evidence:[{evidence_id:'P1:E1',locator:'Fixture'}]}]};
  const plan={slides:[
    {slide_id:'S07',title:'需要修订的说明页',paper_ids:['P1'],evidence_ids:['P1:E1'],claims:[],render:{type:'explanation',sections:[]}},
    {slide_id:'S08',title:'结束',paper_ids:[],evidence_ids:[],claims:[],render:{type:'closing'}},
  ]};
  await assert.rejects(authorDeck({runtime,workdir:'/unused',plan,papers,fontFamily:'Fixture Font',themeId:'blue'}),error=>{
    assert.match(error.message,/^S07: explanation: use 2–4/);
    assert.equal(error.message,`S07: ${error.cause.message}`);
    return true;
  });
});
function structureFixture(multiple=false) {
  const paper=id=>({paper_id:id,evidence:[{evidence_id:`${id}:E1`}]});
  const papers={papers:[paper('P1'),...(multiple?[paper('P2')]:[])]};
  const slide=(id,type,pids=[],refs=[])=>({slide_id:id,title:id,paper_ids:pids,evidence_ids:refs,claims:[],render:{type}});
  const slides=[slide('cover','cover'),slide('P1-body','text',['P1'],['P1:E1'])];
  if(multiple){slides.push(slide('P2-body','text',['P2'],['P2:E1']));slides.splice(1,0,{...slide('agenda','agenda',['P1','P2']),render:{type:'agenda',items:[{label:'论文一',paper_ids:['P1'],target_slide_id:'P1-body'},{label:'论文二',paper_ids:['P2'],target_slide_id:'P2-body'}]}});}
  slides.push(slide('closing','closing'));
  return {plan:{slides},papers};
}
test('single primary plus supplement has no agenda and requires a fixed ending',()=>{
  const {plan,papers}=structureFixture();papers.papers.push({paper_id:'P2',source_role:'supplement',related_to:'P1',evidence:[]});
  assert.deepEqual(checkDeckStructure(plan,papers).primary_paper_ids,['P1']);
  plan.slides.pop();assert.throws(()=>checkDeckStructure(plan,papers),/exactly one fixed closing/);
  plan.structure_overrides={closing:'用户明确要求不加结束页'};assert.doesNotThrow(()=>checkDeckStructure(plan,papers));
  plan.structure_overrides={closing:true};assert.throws(()=>checkDeckStructure(plan,papers),/nonempty reasons/);
});
test('agenda resolves real start pages after insertions and cannot replace evidence coverage',()=>{
  const {plan,papers}=structureFixture(true);
  assert.deepEqual(checkDeckStructure(plan,papers).agenda_items.agenda.map(i=>i.start_page),[3,4]);
  plan.slides.splice(3,0,{slide_id:'extra',paper_ids:['P1'],evidence_ids:['P1:E1'],claims:[],render:{type:'text'}});
  assert.deepEqual(checkDeckStructure(plan,papers).agenda_items.agenda.map(i=>i.start_page),[3,5]);
  plan.slides.find(s=>s.slide_id==='P2-body').evidence_ids=[];
  plan.slides[1].evidence_ids=['P2:E1'];assert.throws(()=>checkDeckStructure(plan,papers),/agenda declarations cannot substitute/);
});
test('agenda rejects self, cover, closing, missing targets and invalid paper ownership',()=>{
  for(const target of ['agenda','cover','closing','missing']){const {plan,papers}=structureFixture(true);plan.slides[1].render.items[0].target_slide_id=target;assert.throws(()=>checkDeckStructure(plan,papers),/subsequent actual content/);}
  for(const modify of [f=>f.plan.slides[1].render.items[0].paper_ids=['P3'],f=>f.plan.slides[1].paper_ids=['P2'],f=>f.plan.slides[2].paper_ids=[]]){const f=structureFixture(true);modify(f);assert.throws(()=>checkDeckStructure(f.plan,f.papers),/actual primary papers declared/);}
  const f=structureFixture(true);f.plan.slides[1].render.items.pop();assert.throws(()=>checkDeckStructure(f.plan,f.papers),/cover all primary/);
  const unordered=structureFixture(true);unordered.plan.slides[1].render.items.reverse();assert.throws(()=>checkDeckStructure(unordered.plan,unordered.papers),/strictly increasing/);
  const fixedPage=structureFixture(true);fixedPage.plan.slides[1].render.items[0].page=3;assert.throws(()=>checkDeckStructure(fixedPage.plan,fixedPage.papers),/page numbers are computed/);
});
test('closing and agenda defaults fail safely without silently dropping content',()=>{
  const f=structureFixture();f.plan.slides.at(-1).render.body='不可丢弃';assert.throws(()=>checkDeckStructure(f.plan,f.papers),/accepts only render.type/);
  delete f.plan.slides.at(-1).render.body;f.plan.slides.reverse();assert.throws(()=>checkDeckStructure(f.plan,f.papers),/last slide/);
  const multi=structureFixture(true);multi.plan.slides.splice(1,1);assert.throws(()=>checkDeckStructure(multi.plan,multi.papers),/exactly one agenda/);
});
function thematicAgendaFixture() {
  const papers={papers:[{paper_id:'P1',evidence:[{evidence_id:'P1:E1'}]},{paper_id:'P2',evidence:[{evidence_id:'P2:E1'}]}]};
  const body=(id,pid,section)=>({slide_id:id,title:id,paper_ids:[pid],evidence_ids:[`${pid}:E1`],claims:[],section_id:section,render:{type:'text'}});
  const plan={navigation:{mode:'by-theme',groups:[{group_id:'comparison',paper_ids:['P1','P2'],sections:[{section_id:'methods',label:'方法比较'},{section_id:'results',label:'证据边界'}]}]},slides:[
    {slide_id:'S1',title:'封面',paper_ids:[],evidence_ids:[],claims:[],render:{type:'cover'}},
    {slide_id:'S2',title:'目录',paper_ids:['P1','P2'],evidence_ids:[],claims:[],render:{type:'agenda',items:[{label:'方法比较',paper_ids:['P1','P2'],target_slide_id:'S3'},{label:'证据边界',paper_ids:['P1','P2'],target_slide_id:'S5'}]}},
    body('S3','P1','methods'),body('S4','P2','methods'),body('S5','P1','results'),body('S6','P2','results'),
    {slide_id:'S7',title:'结束',paper_ids:[],evidence_ids:[],claims:[],render:{type:'closing'}},
  ]};
  return {plan,papers};
}
test('by-theme agenda covers consecutive evidence pages within each item interval',()=>{
  const {plan,papers}=thematicAgendaFixture();
  assert.deepEqual(checkDeckStructure(plan,papers).agenda_items.S2.map(item=>item.start_page),[3,5]);
  papers.papers.push({paper_id:'P3',source_role:'supplement',related_to:'P1',evidence:[{evidence_id:'P3:Supplement'}]});
  plan.slides[2].paper_ids.push('P3');plan.slides[2].evidence_ids=['P3:Supplement'];
  assert.doesNotThrow(()=>checkDeckStructure(plan,papers));
});
test('by-theme agenda cannot borrow evidence from the next interval or empty paper declarations',()=>{
  const later=thematicAgendaFixture();later.plan.slides[3].paper_ids=['P1'];later.plan.slides[3].evidence_ids=['P1:E1'];
  assert.throws(()=>checkDeckStructure(later.plan,later.papers),/interval starting at S3 lacks declared evidence for P2/);
  const ghost=thematicAgendaFixture();ghost.plan.slides[3].evidence_ids=['P1:E1'];
  assert.throws(()=>checkDeckStructure(ghost.plan,ghost.papers),/paper_ids alone cannot satisfy coverage/);
  const legacy=thematicAgendaFixture();delete legacy.plan.navigation;
  assert.throws(()=>checkDeckStructure(legacy.plan,legacy.papers),/declared on the agenda and its target/);
});

const runtimeReady=process.env.RUNTIME_NODE_MODULES&&process.env.RUNTIME_PYTHON&&process.env.BUILDER_TEST_WORKDIR;
test('supported finalization and selective exported rendering preserve receipts without approving review',
  {skip:!runtimeReady||!process.env.BUILDER_PRESENTATIONS_SKILL},async()=>{
  const workdir=path.join(path.resolve(process.env.BUILDER_TEST_WORKDIR),`finalize-${Date.now()}`),privateDir=path.join(workdir,'_work');
  await fs.mkdir(privateDir,{recursive:true});
  const source=path.join(workdir,'fixture.pdf'),python=process.env.RUNTIME_PYTHON,moduleDir=process.env.RUNTIME_NODE_MODULES;
  const py=spawnSync(python,['-c','from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=320,height=160); w.write(sys.argv[1])',source],{encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);
  const papers={papers:[{paper_id:'P1',title:'软件夹具',citation:'Synthetic software fixture',pdf_page_count:1,
    source_sha256:sha256(await fs.readFile(source)),main_evidence_reviewed:true,main_evidence_ids:[],
    evidence:[{evidence_id:'P1:E1',kind:'text',pdf_page:1,locator:'Synthetic fixture',source_excerpt:'A software test only.'}]}]};
  const slide=(id,title,render,refs=[])=>({slide_id:id,title,layout_id:'derived:finalizer-test',layout_reason:'Software regression fixture',paper_ids:['P1'],evidence_ids:refs,claims:[],render});
  const moderateBody=Array(4).fill('证据'.repeat(32));
  const plan={slides:[
    slide('S1','软件夹具',{type:'cover'}),
    slide('S2','原生表格',{type:'table',table:{headers:['项目','描述'],rows:[['用途','软件测试']]}},['P1:E1']),
    slide('S3','首张正文代表页',{type:'text',body:moderateBody},['P1:E1']),
    slide('S4','第二张正文需要补查',{type:'text',body:['这是一条短说明。','这也是一条短说明。']},['P1:E1']),
    slide('S5','无需额外补查的同类正文',{type:'text',body:moderateBody},['P1:E1']),
    slide('S6','结束',{type:'closing'}),
  ]};
  const run={schema_version:3,status:'page_count_confirmed',target_slide_count:6,user_answer:'6 (synthetic test)',theme_id:'blue',theme_user_answer:'蓝色',inputs:[{paper_id:'P1',path:source}]};
  for(const [name,data] of Object.entries({'run.json':run,'papers.json':papers,'deck-plan.json':plan})) await fs.writeFile(path.join(privateDir,name),JSON.stringify(data));
  const common=['--workdir',path.relative(process.cwd(),workdir),'--runtime-node-modules',moduleDir,'--python',python];
  const draft=await main([...common,'--font','Source Han Sans CN','--out','_work/build/fixture.pptx']);
  assert.ok(path.isAbsolute(draft.pptx));assert.equal(draft.render_count,0);
  assert.deepEqual(draft.layout_diagnostics.filter(item=>item.code==='sparse-text').map(item=>item.slide),[4]);
  assert.deepEqual(previewNumbers('representative',plan.slides.length,plan.slides),[1,2,3,6]);
  const selected=await main([...common,'--render-pptx',draft.pptx,'--preview','2','--scale','0.5','--out','_work/previews/selected']);
  assert.equal(selected.complete,false);assert.equal(selected.render_scope,'selected');
  assert.deepEqual(selected.rendered_slide_numbers,[2]);assert.equal(selected.slide_count,6);
  assert.equal(selected.pptx_sha256,draft.pptx_sha256);
  const representative=await main([...common,'--render-pptx',draft.pptx,'--preview','representative','--scale','0.5','--out','_work/previews/representative']);
  assert.deepEqual(representative.rendered_slide_numbers,[1,2,3,4,6]);
  assert.equal(representative.complete,false);assert.equal(representative.render_scope,'selected');
  // Explicit CLI module paths must reach the finalizer's spawned real importer.
  delete process.env.RUNTIME_NODE_MODULES;
  const print=console.log,messages=[];
  console.log=(...values)=>{messages.push(values.join(' '));print(...values);};
  let checked;
  try {
    checked=await main([...common,'--finalize-pptx',draft.pptx,'--presentations-skill',process.env.BUILDER_PRESENTATIONS_SKILL,'--out','_work/checked/fixture.pptx','--preview','representative','--scale','0.5']);
  } finally { process.env.RUNTIME_NODE_MODULES=moduleDir;console.log=print; }
  assert.equal(checked.complete,false);assert.equal(checked.render_scope,'selected');assert.equal(checked.render_count,5);
  assert.deepEqual(checked.rendered_slide_numbers,[1,2,3,4,6]);
  const validation=JSON.parse(await fs.readFile(checked.finalization.validation_receipt,'utf8'));
  assert.equal(validation.finalSha256,checked.pptx_sha256);
  assert.equal(validation.firstPartyImport.passed,true);
  assert.equal(validation.firstPartyImport.runtimeNodeModules,moduleDir);
  assert.equal(validation.fontSelection.passed,true);
  const summary=JSON.parse(messages.at(-1));
  assert.equal(summary.pptx,checked.pptx);assert.equal(summary.validation_receipt,checked.finalization.validation_receipt);
  assert.ok(checked.finalization.validation_receipt.startsWith(path.join(privateDir,'finalization')));
  assert.equal(checked.review_status,'pending-human-or-agent-visual-review');
  const complete=await main([...common,'--render-pptx',checked.pptx,'--scale','0.5','--out','_work/previews/checked-all']);
  assert.equal(complete.complete,true);assert.equal(complete.render_scope,'all');
  assert.deepEqual(complete.rendered_slide_numbers,[1,2,3,4,5,6]);
  await assert.rejects(fs.access(path.join(privateDir,'review.json')));
  await assert.rejects(main([...common,'--render-pptx',draft.pptx,'--preview','1','--out','_work/previews/selected']),/Refusing to overwrite/);
  const extraRequirements={...draft,requirements:{...draft.requirements,requiredNativeTableOwnerSlides:[1,2]}};
  await fs.writeFile(path.join(privateDir,'extra-requirements.json'),JSON.stringify(extraRequirements));
  await assert.rejects(main([...common,'--finalize-pptx',draft.pptx,'--build-receipt','_work/extra-requirements.json','--presentations-skill',process.env.BUILDER_PRESENTATIONS_SKILL,'--out','_work/checked/missing-table.pptx']),/Presentations finalization failed/);
  await assert.rejects(fs.access(path.join(privateDir,'checked/missing-table.pptx')));
  await fs.writeFile(path.join(privateDir,'run.json'),JSON.stringify({...run,theme_id:'red',theme_user_answer:'红色'}));
  await assert.rejects(main([...common,'--finalize-pptx',draft.pptx,'--presentations-skill',process.env.BUILDER_PRESENTATIONS_SKILL]),/confirmed theme changed/);
  await assert.rejects(main([...common,'--render-pptx',draft.pptx,'--preview','representative']),/confirmed theme changed/);
  await fs.writeFile(path.join(privateDir,'run.json'),JSON.stringify(run));
  await fs.writeFile(path.join(privateDir,'deck-plan.json'),JSON.stringify({...plan,changed:true}));
  await assert.rejects(main([...common,'--finalize-pptx',draft.pptx,'--presentations-skill',process.env.BUILDER_PRESENTATIONS_SKILL]),/stale/);
  console.log(`Small finalized fixture and receipts: ${checked.pptx}`);
});
test('navigation headers and specific page titles remain editable with fitted content areas', {skip:!runtimeReady}, async()=>{
  const workdir=path.join(path.resolve(process.env.BUILDER_TEST_WORKDIR),`navigation-${Date.now()}`),privateDir=path.join(workdir,'_work');
  await fs.mkdir(privateDir,{recursive:true});
  const source=path.join(workdir,'fixture.pdf');
  const py=spawnSync(process.env.RUNTIME_PYTHON,['-c','from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=320,height=160); w.write(sys.argv[1])',source],{encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);
  const runtime=await loadRuntime(process.env.RUNTIME_NODE_MODULES);
  // A 2.8:1 image exposed detached labels without triggering shallow-figure diagnostics.
  const imageBytes=await runtime.sharp({create:{width:448,height:160,channels:3,background:'#32497B'}}).png().toBuffer();
  await fs.writeFile(path.join(privateDir,'source-figure.png'),imageBytes);
  const papers={papers:[{paper_id:'P1',title:'导航布局回归来源',citation:'Synthetic navigation fixture',pdf_page_count:1,source_sha256:sha256(await fs.readFile(source)),main_evidence_reviewed:true,main_evidence_ids:['P1:Fig1'],evidence:[{evidence_id:'P1:Fig1',kind:'figure',pdf_page:1,locator:'Fixture figure',source_excerpt:'Synthetic test image.',asset_path:'_work/source-figure.png',reviewed:true}]}]};
  const content=(slide_id,title,section_id,render)=>({slide_id,title,section_id,layout_id:'derived:navigation-test',layout_reason:'Native navigation regression fixture',paper_ids:['P1'],evidence_ids:['P1:Fig1'],claims:[],render});
  const plan={navigation:{mode:'single',groups:[{group_id:'paper1',paper_ids:['P1'],sections:[{section_id:'background',label:'研究背景'},{section_id:'methods',label:'材料与方法'},{section_id:'results',label:'结果与分析'}]}]},slides:[
    {slide_id:'S1',title:'导航布局测试',layout_id:'derived:navigation-test',layout_reason:'Fixture cover',paper_ids:['P1'],evidence_ids:[],claims:[],render:{type:'cover'}},
    content('S2','周期冲击信号中的故障诊断问题','background',{type:'text',body:['实际信号同时包含目标冲击、周期干扰和背景噪声。','本页用于验证栏目标题、具体主题和正文保持分离，所有文字均可编辑。'],takeaway:'来源内容及其边界需要完整保留'}),
    content('S3','滤波器系数的迭代求解','methods',{type:'methods',input:'输入：振动信号、滤波器长度与初始参数。\n依据已核实的目标函数更新滤波器。',steps:[{title:'读取输入',body:'读取已确认数据\n检查采样率与单位\n保留实验限定条件'},{title:'估计参数',body:'根据当前模态\n计算目标所需参数\n记录估计的适用条件'},{title:'更新系数',body:'依据目标函数求解\n保留原文关键步骤\n再次计算候选模态'},{title:'检查终止',body:'比较本轮与上一轮\n检查收敛或迭代上限\n满足条件才输出'}],stop:'停止条件：达到原文规定的收敛阈值或迭代上限。\n若尚未满足条件，保留必要状态并继续下一轮计算。',output:'输出：保留方法规定的结果与必要诊断信息'}),
    content('S4','实验条件与对照设置','results',{type:'table',table:{headers:['比较维度','方法一','方法二'],rows:[['输入范围','相同采样窗口','相同采样窗口'],['判断依据','来源证据一','来源证据二'],['结果边界','保留限定条件','保留限定条件']],column_widths:[254,450,450]},body:['该表仅作为软件回归测试，不代表真实科研比较。']}),
    content('S5','故障特征在结果中的表现','results',{type:'single-figure',figures:[{evidence_id:'P1:Fig1',caption:'原图保持尺寸比例与原始字节。'}],body:['解释图像呈现的结果。','保留实验条件及结论边界。'],takeaway:'本页具体主题与栏目名称分别显示'}),
    content('S6','两个模态的特征比较','results',{type:'two-figures',figures:[{evidence_id:'P1:Fig1',label:'模态一',caption:'原图内容保持完整。'},{evidence_id:'P1:Fig1',label:'模态二',caption:'图注与对应图像同侧。'}]}),
    content('S7','三个说明组保持独立可编辑','results',{type:'explanation',sections:[
      {title:'测试对象',body:'标题和正文均应保留为独立的原生文本对象。'},
      {title:'对应关系',body:'每个小标题位于对应正文上方，保持紧密关联。'},
      {title:'验证边界',body:'该页面仅用于软件测试，不代表任何科研结果。'},
    ],takeaway:'说明组使用真实文案形成清楚的阅读顺序'}),
    {slide_id:'S8',title:'汇报完毕，敬请老师同学批评指正！',layout_id:'derived:navigation-test',layout_reason:'Fixed ending',paper_ids:[],evidence_ids:[],claims:[],render:{type:'closing'}},
  ]};
  const run={schema_version:3,status:'page_count_confirmed',target_slide_count:8,user_answer:'8 (navigation regression fixture)',theme_id:'teal',theme_user_answer:'青色',inputs:[{paper_id:'P1',path:source}]};
  await fs.writeFile(path.join(privateDir,'run.json'),JSON.stringify(run));await fs.writeFile(path.join(privateDir,'papers.json'),JSON.stringify(papers));await fs.writeFile(path.join(privateDir,'deck-plan.json'),JSON.stringify(plan));
  const receipt=await main(['--workdir',workdir,'--font','Source Han Sans CN','--out','_work/build/navigation.pptx','--preview','none']);
  assert.equal(receipt.navigation.enabled,true);
  assert.equal(receipt.navigation.headings.S2.header,'1 研究背景');
  assert.equal(receipt.navigation.headings.S3.header,'2 材料与方法');
  assert.equal(receipt.navigation.headings.S4.header,receipt.navigation.headings.S5.header);
  assert.equal(receipt.navigation.headings.S5.header,receipt.navigation.headings.S6.header);
  const check=spawnSync(process.env.RUNTIME_PYTHON,['-c',`import sys,json,zipfile,hashlib,posixpath,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]); plan=json.load(open(sys.argv[2]));ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
def shapes(n):
 root=E.fromstring(z.read(f'ppt/slides/slide{n}.xml'));result=[]
 for sp in root.findall('.//p:sp',ns):
  text=''.join(t.text or '' for t in sp.findall('.//a:t',ns));xf=sp.find('p:spPr/a:xfrm',ns)
  if not text or xf is None:continue
  off=xf.find('a:off',ns);ext=xf.find('a:ext',ns)
  result.append((text,float(off.get('x'))/9525,float(off.get('y'))/9525,float(ext.get('cx'))/9525,float(ext.get('cy'))/9525))
 return result
headers=['1 研究背景','2 材料与方法','3 结果与分析','3 结果与分析','3 结果与分析','3 结果与分析']
for n,header in zip(range(2,8),headers):
 s=shapes(n);heading=next(x for x in s if x[0]==header);title=next(x for x in s if x[0]==plan['slides'][n-1]['title'])
 assert heading[2]<68 and 100<=title[2]<=102
 assert 25<=title[4]<=43 and title[1]+title[3]<=1225
 for text,x,y,w,h in s:
  if text in [header,plan['slides'][n-1]['title'],str(n)] or text.startswith('来源：'):continue
  assert y>=159,(n,text,y)
  assert y+h<=660,(n,text,y,h)
for n in [1,8]:assert not any('研究背景'==x[0] or x[0].startswith('1 研究背景') for x in shapes(n))
method=shapes(3);stop=next(x for x in method if x[0].startswith('停止条件：'));output=next(x for x in method if x[0].startswith('输出：'))
assert stop[2]+stop[4]<output[2]
for n in [5,6]:
 root=E.fromstring(z.read(f'ppt/slides/slide{n}.xml'))
 rels=E.fromstring(z.read(f'ppt/slides/_rels/slide{n}.xml.rels'))
 targets={rel.get('Id'):posixpath.normpath(posixpath.join('ppt/slides',rel.get('Target'))).lstrip('/') for rel in rels}
 pictures=[]
 for pic in root.findall('.//p:pic',ns):
  xf=pic.find('p:spPr/a:xfrm',ns);off=xf.find('a:off',ns);ext=xf.find('a:ext',ns)
  x,y,w,h=[float(value)/9525 for value in [off.get('x'),off.get('y'),ext.get('cx'),ext.get('cy')]]
  assert abs(w/h-2.8)<0.001,(n,w,h)
  embed=pic.find('p:blipFill/a:blip',ns).get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
  assert hashlib.sha256(z.read(targets[embed])).hexdigest()==sys.argv[3]
  pictures.append((x,y,w,h))
 pictures.sort();figures=plan['slides'][n-1]['render']['figures'];assert len(pictures)==len(figures)
 texts=shapes(n)
 for figure,(x,y,w,h) in zip(figures,pictures):
  caption=next(shape for shape in texts if shape[0]==figure['caption'])
  assert 8<=caption[2]-(y+h)<=16,(n,'detached caption',caption,y,h)
  if figure.get('label'):
   label=next(shape for shape in texts if shape[0]==figure['label'])
   assert 12<=y-(label[2]+label[4])<=24,(n,'detached label',label,y)
explanation=E.fromstring(z.read('ppt/slides/slide7.xml'));native=shapes(7)
assert not explanation.findall('.//p:pic',ns),'explanation must not be a raster slide'
for section in plan['slides'][6]['render']['sections']:
 title=[shape for shape in native if shape[0]==section['title']]
 body=[shape for shape in native if shape[0]==section['body']]
 assert len(title)==len(body)==1,(section,title,body)
 title,body=title[0],body[0]
 assert abs(title[1]-body[1])<1
 assert title[2]+title[4]<body[2]
print('Native navigation, explanation text, figure adjacency, image bytes and aspect ratio verified')`,receipt.pptx,path.join(privateDir,'deck-plan.json'),sha256(imageBytes)],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
  const imported=await runtime.PresentationFile.importPptx(await runtime.FileBlob.load(receipt.pptx));
  await renderSlides(imported,path.join(privateDir,'navigation-previews'),[2,3,4,5,6,7],1);
  assert.ok(receipt.assets.every(asset=>asset.sha256===sha256(imageBytes)));
  console.log(`Navigation representative previews: ${path.join(privateDir,'navigation-previews')}`);
});
test('real PPTX build preserves native tables, arrow direction, image bytes and source notes; exported deck renders', {skip:!runtimeReady}, async()=>{
  const base=path.resolve(process.env.BUILDER_TEST_WORKDIR),workdir=path.join(base,`test-${Date.now()}`),privateDir=path.join(workdir,'_work');
  await fs.mkdir(privateDir,{recursive:true});
  const source=path.join(workdir,'fixture.pdf');
  const py=spawnSync(process.env.RUNTIME_PYTHON,['-c','from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=320,height=80); w.write(sys.argv[1])',source],{encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);
  const runtime=await loadRuntime(process.env.RUNTIME_NODE_MODULES);
  const bytes=await runtime.sharp({create:{width:320,height:80,channels:3,background:'#32497B'}}).png().toBuffer();
  await fs.writeFile(path.join(privateDir,'test-figure.png'),bytes);
  const evidence=[{evidence_id:'P1:Fig1',kind:'figure',pdf_page:1,locator:'Fixture figure 1',source_excerpt:'Synthetic software fixture, no scientific finding.',asset_path:'_work/test-figure.png',reviewed:true},{evidence_id:'P1:Setup',kind:'text',pdf_page:1,locator:'Fixture setup',source_excerpt:'Fixture fs=20 kHz.'}];
  const papers={papers:[{paper_id:'P1',title:'软件回归测试',citation:'Synthetic regression fixture',pdf_page_count:1,source_sha256:sha256(await fs.readFile(source)),main_evidence_reviewed:true,main_evidence_ids:['P1:Fig1'],evidence,experiments:[{experiment_id:'P1:ExpA',sources:['P1:Setup'],values:{fs:'20 kHz'}}]}]};
  const source2=path.join(workdir,'fixture-2.pdf');await fs.copyFile(source,source2);
  papers.papers.push({paper_id:'P2',title:'第二篇回归测试',pdf_page_count:1,source_sha256:sha256(await fs.readFile(source2)),main_evidence_reviewed:true,main_evidence_ids:[],evidence:[{evidence_id:'P2:Setup',kind:'text',pdf_page:1,locator:'Fixture second paper',source_excerpt:'Synthetic fixture.'}]});
  const renders=[{type:'cover',body:['可编辑组件验证']},{type:'single-figure',figures:[{evidence_id:'P1:Fig1',label:'原始图像',caption:'保留比例与完整边界'}],body:['采样率 {{P1:ExpA.fs}}']},{type:'two-figures',figures:[{evidence_id:'P1:Fig1',caption:'图像字节保持一致'},{evidence_id:'P1:Fig1',caption:'横纵比保持一致'}]},{type:'table',table:{headers:['项目','值'],rows:[['采样率',{condition_ref:'P1:ExpA.fs'}],['说明','测试值']]},takeaway:'表格保持原生可编辑'},{type:'methods',input:'输入与参数',steps:[{title:'读取',body:'已确认的来源'},{title:'核对',body:'数值与证据'},{title:'输出',body:'可编辑页面'}],stop:'完成全部核对后停止',output:'用于检查连线方向'}];
  const plan={slides:renders.map((render,i)=>({slide_id:`S${i+1}`,layout_id:'derived:smoke',layout_reason:'Synthetic component regression fixture',title:['组件测试','原图与解释','原图并列','条件表格','原生流程'][i],paper_ids:['P1'],evidence_ids:['P1:Fig1','P1:Setup'],claims:[{text:'测试采样率 {{P1:ExpA.fs}}',provenance:'paper',sources:['P1:Setup']}],render}))};
  plan.slides[4].paper_ids.push('P2');plan.slides[4].evidence_ids.push('P2:Setup');
  plan.slides.splice(1,0,{slide_id:'A',title:'目录',layout_id:'derived:smoke',layout_reason:'Multi-paper agenda regression',paper_ids:['P1','P2'],evidence_ids:[],claims:[],render:{type:'agenda',items:[{label:'第一篇论文',paper_ids:['P1'],target_slide_id:'S2'},{label:'第二篇论文',paper_ids:['P2'],target_slide_id:'S5'}]}});
  plan.slides.push({slide_id:'C',title:'汇报完毕，敬请老师同学批评指正！',layout_id:'derived:smoke',layout_reason:'Fixed closing regression',paper_ids:[],evidence_ids:[],claims:[],render:{type:'closing'}});
  const run={schema_version:3,status:'page_count_confirmed',target_slide_count:7,user_answer:'7 (synthetic software fixture)',theme_id:'red',theme_user_answer:'红色',inputs:[{paper_id:'P1',path:source},{paper_id:'P2',path:source2}]};
  const obsoleteCoverPlan=structuredClone(plan);obsoleteCoverPlan.slides[0].render.kicker='不应显示的封面眉题';
  await assert.rejects(authorDeck({runtime,workdir,plan:obsoleteCoverPlan,papers,fontFamily:'Source Han Sans CN',themeId:'red'}),/does not support render.kicker/);
  assert.throws(()=>createComponents('Source Han Sans CN').cover(null,'题名',{kicker:'不应显示的封面眉题'}),/no longer supported/);
  await fs.writeFile(path.join(privateDir,'run.json'),JSON.stringify(run));
  await fs.writeFile(path.join(privateDir,'papers.json'),JSON.stringify(papers));
  await fs.writeFile(path.join(privateDir,'deck-plan.json'),JSON.stringify(plan));
  const receipt=await main(['--workdir',workdir,'--font',process.env.BUILDER_TEST_FONT||'Source Han Sans CN','--out','_work/build/test.pptx','--preview','none']);
  assert.equal(receipt.slide_count,7);assert.equal(receipt.render_count,0);assert.deepEqual(receipt.requirements.requiredNativeTableOwnerSlides,[5]);
  assert.equal(receipt.theme_id,'red');assert.equal(receipt.palette_sha256,getTheme('red').palette_sha256);
  assert.equal(receipt.assets.length,3);assert.equal(receipt.assets[0].sha256,sha256(bytes));
  assert.ok(receipt.assets.every(a=>Math.abs(a.position.width/a.position.height-4)<1e-10));
  const inspect=spawnSync(process.env.RUNTIME_PYTHON,['-c',`import sys,json,zipfile,hashlib,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]); ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
cover=E.fromstring(z.read('ppt/slides/slide1.xml'))
cover_text=[]
for sp in cover.findall('.//p:sp',ns):
 text=''.join(t.text or '' for t in sp.findall('.//a:t',ns))
 if not text:continue
 y=int(sp.find('p:spPr/a:xfrm/a:off',ns).get('y'))/9525
 assert y>=211.42,(text,y)
 cover_text.append(text)
assert '组件测试' in cover_text and '可编辑组件验证' in cover_text
table=E.fromstring(z.read('ppt/slides/slide5.xml')); method=E.fromstring(z.read('ppt/slides/slide6.xml'))
assert len(table.findall('.//a:tbl',ns))==1
assert any(t.text=='20 kHz' for t in table.findall('.//a:t',ns))
cons=method.findall('.//p:cxnSp',ns); assert len(cons)==2
for c in cons:
 assert c.find('.//a:tailEnd',ns).attrib['type']=='triangle'
 assert c.find('.//a:xfrm/a:ext',ns).attrib['cx']!='0'
notes=''.join(t.text or '' for t in E.fromstring(z.read('ppt/notesSlides/notesSlide5.xml')).findall('.//a:t',ns))
assert 'P1:Setup' in notes and '20 kHz' in notes
assert any(hashlib.sha256(z.read(n)).hexdigest()==sys.argv[2] for n in z.namelist() if n.startswith('ppt/media/'))
assert '{{' not in notes
agenda=E.fromstring(z.read('ppt/slides/slide2.xml')); labels=[t.text for t in agenda.findall('.//a:t',ns)]
assert '目录' in labels and '3' in labels and '6' in labels
ending=E.fromstring(z.read('ppt/slides/slide7.xml')); endtext=[t.text for t in ending.findall('.//a:t',ns)]
assert endtext==['汇报完毕，敬请老师同学批评指正！']
print(json.dumps({'native_tables':1,'connectors':len(cons),'notes_and_image_bytes':True}))`,receipt.pptx,sha256(bytes)],{encoding:'utf8'});
  assert.equal(inspect.status,0,inspect.stderr);
  const render=await main(['--workdir',workdir,'--render-pptx',receipt.pptx,'--scale','1']);
  assert.equal(render.render_count,7);assert.equal(render.pptx_sha256,receipt.pptx_sha256);
  assert.ok(render.slides.every(s=>s.png_sha256));
  await assert.rejects(fs.access(path.join(privateDir,'review.json')));
  // Check real package colors on agenda/table/methods/closing for every theme.
  for(const themeId of ['blue','teal','red','purple']){
    const theme=getTheme(themeId),themeDir=path.join(privateDir,'themes',themeId);
    await fs.mkdir(themeDir,{recursive:true});
    let pptx=receipt.pptx;
    if(themeId!=='red'){
      const authored=await authorDeck({runtime,workdir,plan,papers,fontFamily:'Source Han Sans CN',themeId});
      pptx=path.join(themeDir,'theme.pptx');await(await runtime.PresentationFile.exportPptx(authored.presentation)).save(pptx);
    }
    const colorCheck=spawnSync(process.env.RUNTIME_PYTHON,['-c',`import sys,zipfile,xml.etree.ElementTree as E,hashlib
z=zipfile.ZipFile(sys.argv[1]); primary,light,muted=sys.argv[2:5];ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
def colors(n): return {c.get('val') for c in E.fromstring(z.read(f'ppt/slides/slide{n}.xml')).findall('.//a:srgbClr',ns)}
for n in [2,5,6,7]:
 assert primary in colors(n),(n,colors(n),primary)
 if primary!='32497B': assert '32497B' not in colors(n),(n,'unexpected old blue')
assert light in colors(5) and light in colors(6)
assert muted in colors(2)
assert any(hashlib.sha256(z.read(n)).hexdigest()==sys.argv[5] for n in z.namelist() if n.startswith('ppt/media/'))`,pptx,theme.colors.primary.slice(1),theme.colors.light.slice(1),theme.colors.muted_on_primary.slice(1),sha256(bytes)],{encoding:'utf8'});
    assert.equal(colorCheck.status,0,colorCheck.stderr);
    const imported=await runtime.PresentationFile.importPptx(await runtime.FileBlob.load(pptx));
    await renderSlides(imported,themeDir,[2,5,6,7],1);
  }
  const unselected={...run,theme_id:null,theme_user_answer:null};await fs.writeFile(path.join(privateDir,'run.json'),JSON.stringify(unselected));
  await assert.rejects(main(['--workdir',workdir,'--font','Source Han Sans CN','--out','_work/build/no-theme.pptx']),/get-theme failed/);
  await assert.rejects(fs.access(path.join(privateDir,'build/no-theme.pptx')));
  await fs.writeFile(path.join(privateDir,'run.json'),JSON.stringify(run));
  // The default workflow must reject bad evidence references before creating a draft.
  plan.slides[2].render.body=['采样率 {{P1:ExpA.missing}}'];await fs.writeFile(path.join(privateDir,'deck-plan.json'),JSON.stringify(plan));
  await assert.rejects(main(['--workdir',workdir,'--font','Source Han Sans CN','--out','_work/build/bad.pptx']),/check-plan failed/);
  await assert.rejects(fs.access(path.join(privateDir,'build/bad.pptx')));
  plan.slides[2].render.body=['完整证据'.repeat(500)];await fs.writeFile(path.join(privateDir,'deck-plan.json'),JSON.stringify(plan));
  await assert.rejects(main(['--workdir',workdir,'--font','Source Han Sans CN','--out','_work/build/overflow.pptx']),/too much text/);
  await assert.rejects(fs.access(path.join(privateDir,'build/overflow.pptx')));
  console.log(`Inspected actual exported fixture: ${receipt.pptx}`);
});

function recordingSlide() {
  const objects=[],images=[];
  const slide={shapes:{add:options=>{
    const record={...options,textStyle:{},textValue:''};
    const obj={position:options.position,get text(){return record.textStyle;},set text(value){record.textValue=value;}};
    objects.push(record);return obj;
  }},images:{add:image=>{images.push(image);return image;}}};
  return {slide,objects,images,texts:()=>objects.map(object=>object.textValue).filter(Boolean)};
}
const reportFixture={presenter_name:'张三',presenter_omitted:false,report_date:'2026.09.07',report_timezone:'Asia/Shanghai'};
test('fixed report covers and closings use confirmed metadata and the extracted template icons',()=>{
  for(const themeId of ['blue','purple']) {
    const c=createComponents('Fixture Font',themeId),cover=recordingSlide(),closing=recordingSlide();
    c.reportCover(cover.slide,reportFixture);c.reportClosing(closing.slide,reportFixture);
    assert.deepEqual(cover.texts(),[REPORT_TITLE,'汇报人：张三','汇报日期：2026.09.07']);
    assert.deepEqual(closing.texts(),[CLOSING_TEXT,'汇报人：张三','汇报日期：2026.09.07']);
    assert.equal(cover.images.length,2);assert.equal(closing.images.length,2);
    for(const image of cover.images) {
      assert.equal(image.contentType,'image/svg+xml');
      assert.match(Buffer.from(image.blob).toString(),/Extracted without path redesign/);
      assert.ok(Buffer.from(image.blob).toString().includes(c.colors.primary));
      if(themeId!=='blue')assert.ok(!Buffer.from(image.blob).toString().includes('#32497B'));
    }
  }
  const omitted=recordingSlide();createComponents('Fixture Font').reportCover(omitted.slide,{...reportFixture,presenter_name:null,presenter_omitted:true});
  assert.deepEqual(omitted.texts(),[REPORT_TITLE,'汇报日期：2026.09.07']);assert.equal(omitted.images.length,1);
  assert.throws(()=>validateReportMetadata(),/confirmed report metadata/);
  assert.throws(()=>validateReportMetadata({...reportFixture,presenter_name:null}),/confirmed presenter name/);
  assert.throws(()=>validateReportMetadata({...reportFixture,presenter_omitted:true}),/cannot retain/);
  assert.throws(()=>validateReportMetadata({...reportFixture,report_date:'2026.02.30'}),/real calendar/);
  assert.throws(()=>validateReportMetadata({...reportFixture,report_timezone:'not-a-zone'}),/IANA/);
  assert.equal(validateReportMetadata({...reportFixture,report_timezone:null}).report_timezone,null);
});
test('paper-info uses source metadata, keeps the complete title and omits unavailable ranking fields',()=>{
  const c=createComponents('Fixture Font'),record=recordingSlide();
  const paper={title:'A long English research title that remains complete across wrapped lines in the report',title_zh:'论文完整题名',authors:['Author One','Author Two','Author Three','Author Four','Author Five'],journal:'Journal of Synthetic Fixtures',year:2026,doi:'10.0000/fixture'};
  c.paperInfo(record.slide,paper,{summary:'这是一条软件布局测试的研究内容说明。',keywords:['软件测试','可编辑文本']});
  const texts=record.texts();assert.ok(texts.includes(paper.title));assert.ok(texts.includes(paper.title_zh));
  assert.ok(texts.includes('作者：Author One, Author Two, Author Three 等（共 5 位）'));
  assert.ok(texts.includes('DOI：10.0000/fixture'));assert.ok(!texts.some(value=>/影响因子|分区/.test(value)));
  assert.equal(record.images.length,0);
  assert.throws(()=>c.paperInfo(recordingSlide().slide,{title:'题名'},{summary:'内容'.repeat(400)}),/exceeds/);
});
test('section dividers mark precisely the active paper without content header or footer',()=>{
  const c=createComponents('Fixture Font','purple'),record=recordingSlide();
  const section={group_id:'g2',number:'02',label:'第二篇论文',items:[{group_id:'g1',number:'01',label:'第一篇论文',active:false},{group_id:'g2',number:'02',label:'第二篇论文',active:true},{group_id:'g3',number:'03',label:'综合思考',active:false}]};
  c.sectionDivider(record.slide,section);
  assert.ok(record.texts().includes('PART TWO'));assert.ok(!record.texts().some(value=>/来源|1\./.test(value)));
  const active=record.objects.find(object=>object.textValue==='第二篇论文');
  assert.equal(active.textStyle.style.color,'#000000');
  assert.equal(record.objects.find(object=>object.textValue==='第一篇论文').textStyle.style.color,'#B9BCC3');
});
test('paper-info and divider evidence cannot substitute for actual substantive paper coverage',()=>{
  const fixture=structureFixture();fixture.plan.slides[1].render.type='paper-info';
  assert.throws(()=>checkDeckStructure(fixture.plan,fixture.papers),/actual content slide/);
});

test('new group-meeting reports build fixed covers, numbered dividers and editable paper information', {skip:!runtimeReady}, async()=>{
  const runtime=await loadRuntime(process.env.RUNTIME_NODE_MODULES);
  for(const multiple of [false,true]) {
    const workdir=path.join(path.resolve(process.env.BUILDER_TEST_WORKDIR),`group-meeting-${multiple?'multi':'single'}-${Date.now()}`),priv=path.join(workdir,'_work');
    await fs.mkdir(priv,{recursive:true});const source=path.join(workdir,'fixture.pdf');
    const py=spawnSync(process.env.RUNTIME_PYTHON,['-c','from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=320,height=160); w.write(sys.argv[1])',source],{encoding:'utf8'});assert.equal(py.status,0,py.stderr);
    const fixture=structureFixture(multiple),{plan,papers}=fixture;
    for(const paper of papers.papers)Object.assign(paper,{title:`Complete English source title for ${paper.paper_id}`,authors:['First Author','Second Author','Third Author','Fourth Author','Fifth Author'],year:2026,
      citation:'Software regression fixture',pdf_page_count:1,source_sha256:sha256(await fs.readFile(source)),main_evidence_reviewed:true,main_evidence_ids:[],
      evidence:[{evidence_id:`${paper.paper_id}:E1`,kind:'text',pdf_page:1,locator:'Synthetic fixture',source_excerpt:'A software test only.'}]});
    const groups=papers.papers.map((paper,i)=>({group_id:`g${i+1}`,label:`论文主题${i+1}`,paper_ids:[paper.paper_id],sections:[
      {section_id:`info${i+1}`,label:'文献基本信息',role:'paper_info'},{section_id:`findings${i+1}`,label:'主要结果与分析',role:'findings',covers:['background','methods','appraisal','implications']},
    ]}));
    plan.navigation={profile:'group-meeting',mode:multiple?'by-paper':'single',groups};
    for(const [i,group] of groups.entries()) {
      const body=plan.slides.find(slide=>slide.slide_id===`${group.paper_ids[0]}-body`);body.section_id=`findings${i+1}`;body.render.body=['原文主要发现及其适用边界。'];
      const info={slide_id:`info-${group.group_id}`,title:'文献基本信息',paper_ids:group.paper_ids,evidence_ids:[],claims:[],section_id:`info${i+1}`,render:{type:'paper-info',summary:'研究论文中的问题、方法及其主要发现。',keywords:['研究问题','关键证据']}};
      const insertion=[...(multiple?[{slide_id:`divider-${group.group_id}`,title:'论文切换',paper_ids:group.paper_ids,evidence_ids:[],claims:[],render:{type:'section-divider',group_id:group.group_id}}]:[]),info];
      plan.slides.splice(plan.slides.indexOf(body),0,...insertion);
    }
    if(multiple)plan.slides[1].render.items=groups.map(group=>({label:group.label,paper_ids:group.paper_ids,target_slide_id:`divider-${group.group_id}`}));
    for(const slide of plan.slides)Object.assign(slide,{layout_id:'derived:group-meeting-regression',layout_reason:'Group meeting software regression'});
    const run={schema_version:4,status:'page_count_confirmed',target_slide_count:plan.slides.length,user_answer:String(plan.slides.length),theme_id:'purple',theme_user_answer:'紫色',
      presenter_name:'张三',presenter_user_answer:'张三',presenter_omitted:false,report_timezone:'Asia/Shanghai',inputs:papers.papers.map(paper=>({paper_id:paper.paper_id,path:source}))};
    for(const [name,value] of Object.entries({'run.json':run,'papers.json':papers,'deck-plan.json':plan}))await fs.writeFile(path.join(priv,name),JSON.stringify(value));
    await assert.rejects(authorDeck({runtime,workdir,plan,papers,fontFamily:'Source Han Sans CN',themeId:'purple'}),/confirmed report metadata/);
    const draft=await main(['--workdir',workdir,'--font','Source Han Sans CN','--out','_work/build/fixture.pptx']);
    assert.equal(draft.report.presenter_name,'张三');assert.match(draft.report.report_date,/^\d{4}\.\d{2}\.\d{2}$/);
    assert.equal(draft.navigation.headings['info-g1'].header,'1.1 文献基本信息');
    if(multiple)assert.equal(draft.navigation.report_structure.divider_items['divider-g2'].number,'02');
    const verify=spawnSync(process.env.RUNTIME_PYTHON,['-c',`import json,sys,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);p=json.load(open(sys.argv[2]));ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
def texts(n):return [t.text for t in E.fromstring(z.read(f'ppt/slides/slide{n}.xml')).findall('.//a:t',ns)]
assert texts(1)==['组会汇报','汇报人：张三','汇报日期：'+sys.argv[3]]
assert texts(len(p['slides']))==['汇报完毕，敬请老师同学批评指正！','汇报人：张三','汇报日期：'+sys.argv[3]]
for i,slide in enumerate(p['slides'],1):
 if slide['render']['type']=='paper-info':
  assert any(t.startswith('Complete English source title') for t in texts(i))
  assert any(t.endswith('文献基本信息') for t in texts(i))
  assert len(E.fromstring(z.read(f'ppt/slides/slide{i}.xml')).findall('.//p:pic',ns))==0
  notes=''.join(E.fromstring(z.read(f'ppt/notesSlides/notesSlide{i}.xml')).itertext());assert 'Fifth Author' in notes
 if slide['render']['type']=='section-divider':
  assert any(t.startswith('PART ') for t in texts(i));assert not any(t.startswith('来源：') for t in texts(i))
print('Fixed report chrome, native source information and complete author notes verified')`,draft.pptx,path.join(priv,'deck-plan.json'),draft.report.report_date],{encoding:'utf8'});
    assert.equal(verify.status,0,verify.stderr);
    const imported=await runtime.PresentationFile.importPptx(await runtime.FileBlob.load(draft.pptx));
    await renderSlides(imported,path.join(priv,'exported-previews'),Array.from({length:plan.slides.length},(_,i)=>i+1),1);
  }
});

test('7–12 group navigation uses two readable columns and rejects larger navigation',()=>{
  const c=createComponents('Fixture Font');
  for(const count of [7,12]) {
    const items=Array.from({length:count},(_,i)=>({group_id:`g${i+1}`,number:String(i+1).padStart(2,'0'),label:`研究主题 ${i+1}：主要发现与结论`,active:i===count-1,paper_ids:[`P${i+1}`],start_page:i*3+3}));
    for(const type of ['agenda','divider']) {
      const r=recordingSlide();if(type==='agenda')c.agenda(r.slide,items);else c.sectionDivider(r.slide,{...items.at(-1),items});
      const labels=r.objects.filter(object=>items.some(item=>item.label===object.textValue));
      assert.equal(labels.length,count);
      assert.ok(labels.slice(0,Math.ceil(count/2)).every(object=>object.position.left<200));
      assert.ok(labels.slice(Math.ceil(count/2)).every(object=>object.position.left>700));
      for(const object of r.objects){const box=object.position;assert.ok(box.left>=0&&box.top>=0&&box.left+box.width<=1281&&box.top+box.height<=721);}
      for(const object of labels)assert.equal(object.textStyle.style.fontSize,26.666667);
    }
  }
  const tooMany=Array.from({length:13},(_,i)=>({group_id:`g${i}`,number:i+1,label:'研究主题',active:i===0}));
  assert.throws(()=>c.agenda(recordingSlide().slide,tooMany),/1–12/);
  assert.throws(()=>c.sectionDivider(recordingSlide().slide,{group_id:'g0',items:tooMany}),/2–12/);
  const venue=recordingSlide();c.paperInfo(venue.slide,{title:'软件测试',venue:'Proceedings of an Example Conference',journal:'Ignored journal'},{summary:'软件测试内容。'});
  assert.ok(venue.texts().includes('来源：Proceedings of an Example Conference'));assert.ok(!venue.texts().some(text=>text.includes('Ignored journal')));
});
