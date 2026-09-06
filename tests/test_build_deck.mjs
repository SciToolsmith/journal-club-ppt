import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeResolver, main, loadRuntime, sha256, checkDeckStructure, authorDeck, renderSlides, resolveWorkdir, parseArgs, previewNumbers, finalizationOptions } from '../scripts/build_deck.mjs';
import { assertTextFits, createComponents, paragraphGeometry, explanationGeometry } from '../scripts/deck_components.mjs';
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
test('explanation rows preserve semantic pairs, spread across the body and reject overflow',()=>{
  const sections=[{title:'研究对象',body:'振动信号包含目标冲击与多种干扰。'},{title:'研究困难',body:'按频带分解可能优先提取窄带干扰。'},{title:'本文思路',body:'相关峭度引导滤波器提取周期冲击。'}];
  const rows=explanationGeometry(sections,[62,160,1154,421]);
  assert.equal(rows.length,3);
  rows.forEach((r,i)=>{
    assert.ok(r.body[0]>=r.title[0]+r.title[2]+30);
    assert.ok(Math.abs((r.title[1]+r.title[3]/2)-(r.body[1]+r.body[3]/2))<1);
    if(i)assert.ok(r.divider>rows[i-1].body[1]+rows[i-1].body[3]);
  });
  assert.ok(rows[2].body[1]>470);
  assert.throws(()=>explanationGeometry([sections[0]],[62,160,1154,421]),/2–4/);
  assert.throws(()=>explanationGeometry([{title:'甲',body:'证据'.repeat(200)},sections[1]],[62,160,1154,421]),/never shrink/);
  assert.throws(()=>explanationGeometry([{title:'甲',body:'',extra:'不可丢失'},sections[1]],[62,160,1154,421]),/nonempty/);
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
      {title:'对应关系',body:'每个小标题与对应正文在同一行构成说明组。'},
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
 assert title[1]+title[3]<body[1]
 assert abs((title[2]+title[4]/2)-(body[2]+body[4]/2))<1
assert max(shape[2] for shape in native if shape[0] in [section['body'] for section in plan['slides'][6]['render']['sections']])>470
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
