#!/usr/bin/env node
// Maintenance command only. Ordinary paper tasks reuse these tested components.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createComponents, COVER_MARKS, STYLE } from './deck_components.mjs';
import { loadRuntime, fileHash, renderSlides, previewNumbers } from './build_deck.mjs';
import { getTheme } from './themes.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw new Error('Use --font FAMILY --workdir ABS [--runtime-node-modules ABS]');args[process.argv[i].slice(2)]=process.argv[i+1];}
if(!path.isAbsolute(args.workdir||''))throw new Error('--workdir must be an absolute private maintenance directory');
if(!args.font)throw new Error('--font must name a verified available family');
if(!path.isAbsolute(args['presentations-skill']||'')||!path.isAbsolute(process.env.RUNTIME_PYTHON||''))throw new Error('Maintenance requires --presentations-skill ABS and RUNTIME_PYTHON from workspace dependencies');
const theme=getTheme(args.theme||'blue');
const runtime=await loadRuntime(args['runtime-node-modules']||process.env.RUNTIME_NODE_MODULES), c=createComponents(args.font,theme.theme_id),C=c.colors;
const p=runtime.Presentation.create({slideSize:{width:STYLE.width,height:STYLE.height}});
const layouts=['cover','text','single-figure','two-figures','table','methods','summary','agenda','paper-info','section-divider','closing'];
const report={presenter_name:'汇报人姓名',presenter_omitted:false,report_date:new Date().toLocaleDateString('sv-SE').replaceAll('-','.'),report_timezone:null};
const sectionItems=[{group_id:'p1',number:'01',label:'第一篇论文的短题名',active:true,paper_ids:['P1']},{group_id:'p2',number:'02',label:'第二篇论文的短题名',active:false,paper_ids:['P2']},{group_id:'synthesis',number:'03',label:'文献阅读总结与思考',active:false,paper_ids:['P1','P2']}];
function frame(s,x,y,w,h){c.shape(s,'rect',x,y,w,h,C.white,C.rule,1);c.text(s,'原文图表区域',x+20,y+h/2-18,w-40,40,24,{color:C.gray,align:'center'});}
layouts.forEach((type,i)=>{
 const s=p.slides.add();s.background.fill=C.white;
 if(type==='cover')c.reportCover(s,report);
 else if(type==='agenda')c.agenda(s,[{label:'第一篇论文的研究主题',start_page:3},{label:'第二篇论文的研究主题',start_page:6},{label:'综合比较与讨论',start_page:8}]);
 else if(type==='closing')c.reportClosing(s,report);
 else if(type==='section-divider')c.sectionDivider(s,{group_id:'p1',number:'01',label:sectionItems[0].label,items:sectionItems});
 else if(type==='paper-info'){c.header(s,'1.1 文献基本信息',i+1);c.paperInfo(s,{title:'论文完整题名',title_zh:'必要时可另列中文译名',authors:['真实作者信息'],venue:'发表载体',year:'发表年份'},{summary:'简要交代文献研究对象、核心问题与主要研究内容。正式汇报中据用户论文填写，不将本页标签作为事实。',keywords:['据原文提炼的关键词']});c.footer(s,'论文出处与原文定位');}
 else {
  const names={text:'研究问题', 'single-figure':'单图与解释', 'two-figures':'并列图表',table:'实验条件对比',methods:'关键方法步骤',summary:'结论与讨论'};
  c.header(s,names[type],i+1);
  if(type==='text')c.paragraphs(s,['研究背景与待解决的问题','方法选择与比较条件','需要核验的关键证据'],[64,133,1150,430],27,42);
  if(type==='single-figure'){frame(s,62,155,550,365);c.paragraphs(s,['实验条件','图表支持的结论','结论适用范围'],[671,159,535,365],26,40);}
  if(type==='two-figures'){frame(s,62,155,550,365);frame(s,666,155,550,365);c.label(s,'图表说明',66,544,540);c.label(s,'图表说明',670,544,540);}
  if(type==='table')c.nativeTable(s,[['比较维度','条件一','条件二'],['实验设置','据原文填写','据原文填写'],['主要结果','据原文填写','据原文填写'],['适用边界','据原文填写','据原文填写']],[62,141,1154,398],[254,450,450]);
  if(type==='methods')c.methods(s,[{title:'输入',body:'信号与已知参数'},{title:'目标',body:'目标函数与约束'},{title:'求解',body:'关键更新步骤'},{title:'输出',body:'结果与停止条件'}],{input:'方法的输入与前提',stop:'迭代或终止条件',output:'方法输出'});
  if(type==='summary')c.paragraphs(s,['主要发现与证据','方法局限与适用范围','需要进一步验证的问题'],[64,134,1150,430],28,52);
  if(type!=='methods')c.takeaway(s,'本页要点');c.footer(s,'来源标识与页码');
 }
 s.speakerNotes.textFrame.setText('K105干净版式示意，仅含编辑标签，无示例论文或演示数据。普通任务通过同源组件创建已填充页面，不将这些标签带入成品。');
});
await fs.mkdir(args.workdir,{recursive:true});
const output=theme.theme_id==='blue'?path.join(root,'assets/k105-blue/starter.pptx'):path.join(args.workdir,`starter-${theme.theme_id}.pptx`);
const manifestPath=theme.theme_id==='blue'?path.join(root,'assets/k105-blue/starter-manifest.json'):path.join(args.workdir,`starter-${theme.theme_id}-manifest.json`);
const candidate=path.join(args.workdir,`starter-candidate-${Date.now()}.pptx`),checked=path.join(args.workdir,'checked',`starter-${Date.now()}.pptx`);
await fs.mkdir(path.dirname(checked),{recursive:true});
await(await runtime.PresentationFile.exportPptx(p)).save(candidate);
const {finalizePresentation}=await import(pathToFileURL(path.join(args['presentations-skill'],'container_tools/artifact_tool_utils.mjs')).href);
await finalizePresentation({workspaceDir:args.workdir,candidatePath:candidate,finalPath:checked,pythonExecutable:process.env.RUNTIME_PYTHON,integrityValidatorPath:path.join(args['presentations-skill'],'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(args['presentations-skill'],'container_tools/inspect_presentation_layout_geometry.py'),explicitTotalSlideCount:layouts.length,requiredNativeTableOwnerSlides:[5],requiredNativeChartOwnerSlides:[],layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','5'],fontPolicy:{basis:'design',families:[args.font]},verifyArtifactToolImport:true,receiptPath:path.join(args.workdir,`starter-validation-${Date.now()}.json`)});
await fs.copyFile(checked,output);
// Import the actual exported starter before rendering; render success is not review.
const imported=await runtime.PresentationFile.importPptx(await runtime.FileBlob.load(output));
const selected=previewNumbers(args.preview||'all',layouts.length);
const previews=await renderSlides(imported,path.join(args.workdir,'starter-exported'),selected,1);
// The original reference is optional local maintenance material, not a public asset.
const referenceHash=await fileHash(path.join(root,'assets/k105-blue/reference.pptx')).catch(error=>{
 if(error.code!=='ENOENT')throw error;
 return null;
});
const manifest={schema_version:2,report_profile:'group-meeting',purpose:'Clean K105 layout reference; filled decks are built from the same native components',generated_at:new Date().toISOString(),runtime_version:runtime.runtimeVersion,starter_sha256:await fileHash(output),reference_sha256:referenceHash,components_sha256:await fileHash(path.join(root,'scripts/deck_components.mjs')),font_family:args.font,font_fallback_rule:'Verify availability through the bundled runtime. Prefer the original template family when available; otherwise explicitly record a visually checked CJK fallback. Never silently substitute or shrink.',slide_size:[1280,720],theme_id:theme.theme_id,palette_sha256:theme.palette_sha256,primary:C.primary,cover_band:[0,211.42,1280,261.78],cover_marks:COVER_MARKS,layouts:layouts.map((type,i)=>({type,slide:i+1})),sample_content:false,package_validation_passed:true,render_verified:selected.length===layouts.length,rendered_slide_numbers:selected,visual_review_status:'pending',previews_are_private:true};
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({output,manifest:manifestPath,render_count:previews.length,previews:path.join(args.workdir,'starter-exported')}));
