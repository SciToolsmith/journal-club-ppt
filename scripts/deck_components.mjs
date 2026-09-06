// Reusable K105 geometry. Text is always native; evidence images remain unchanged.
import { getTheme } from './themes.mjs';
import { readFileSync } from 'node:fs';
export const STYLE = Object.freeze({
  width: 1280, height: 720,
});
export const COVER_MARKS = Object.freeze([
  [36.365, 27.573, 62.635, 6.396], [36.365, 38.178, 45.439, 6.396],
  [36.365, 48.784, 30.604, 6.396], [1181, 686.367, 62.635, 6.396],
  [1198.196, 675.761, 45.439, 6.396], [1213.030, 665.156, 30.604, 6.396],
]);
export const REPORT_TITLE = '组会汇报';
export const CLOSING_TEXT = '汇报完毕，敬请老师同学批评指正！';

// This catches obviously overfull copy without shrinking, truncating or rewriting it.
// Actual exported-slide rendering and visual review remain mandatory.
export function estimatedLines(value, width, size) {
  return String(value).split('\n').reduce((sum, line) => {
    const units = Array.from(line).reduce((n, char) => n + (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|[，。；：？！、（）]/u.test(char) ? 1 : 0.56), 0);
    return sum + Math.max(1, Math.ceil(units * size / width));
  }, 0);
}
export function assertTextFits(value, width, height, size, label = 'text') {
  if (typeof value !== 'string') throw new Error(`${label}: expected resolved text`);
  if (estimatedLines(value, width, size) * size * 1.3 > height + 1) {
    throw new Error(`${label}: copy exceeds this layout's capacity; shorten without losing evidence, repartition content, or use a custom layout. Text will not be shrunk or truncated.`);
  }
}

// Geometry estimates flag composition risks; they never certify visual quality.
export function paragraphGeometry(lines, box, size = 27, gap = 24, distribution = 'top') {
  if (!['top', 'balanced'].includes(distribution)) throw new Error('Unknown paragraph distribution');
  const [x, y, width, height] = box;
  const heights = lines.map(line => estimatedLines(line, width, size) * size * 1.35);
  const naturalHeight = heights.reduce((a,b)=>a+b,0) + Math.max(0,lines.length-1)*gap;
  if (naturalHeight > height) throw new Error('body: too much text for the selected layout; revise content or choose a custom layout');
  const spare = height-naturalHeight;
  const actualGap = distribution==='balanced' && lines.length>1 ? Math.min(48,gap+spare/(2*(lines.length-1))) : gap;
  const groupHeight = heights.reduce((a,b)=>a+b,0)+Math.max(0,lines.length-1)*actualGap;
  let top = y+(distribution==='balanced' ? (height-groupHeight)/2 : 0);
  const boxes=heights.map(h=>{const b=[x,top,width,h+1];top+=h+actualGap;return b;});
  return {boxes,naturalHeight,groupHeight,gap:actualGap,spare,
    sparse:lines.length===0 || (spare>120 && naturalHeight/height<0.55)};
}

export function explanationGeometry(sections, box, composition = 'prose') {
  if (!Array.isArray(sections) || sections.length<2 || sections.length>4)
    throw new Error('explanation: use 2–4 substantive titled sections; otherwise choose another composition');
  if (!['prose','focus-left','focus-top','sequence'].includes(composition))
    throw new Error('explanation: unknown composition');
  if (composition.startsWith('focus-') && sections.length>3)
    throw new Error('explanation: focus compositions need one main point and 1–2 supporting sections');
  sections.forEach(section=>{
    if (!section || typeof section.title!=='string' || !section.title.trim() || typeof section.body!=='string' || !section.body.trim())
      throw new Error('explanation: each section needs a nonempty title and body');
    if(Object.keys(section).some(key=>!['title','body'].includes(key)))throw new Error('explanation: unsupported section field');
  });
  const [bx,by,bw,bh]=box, x=bx+18, y=by+18, width=bw-36, height=bh-36;
  const measure=(i,w,bodySize=26,titleSize=26)=>({
    th:estimatedLines(sections[i].title,w,titleSize)*titleSize*1.35+1,
    bh:estimatedLines(sections[i].body,w,bodySize)*bodySize*1.35+1,
    titleSize,bodySize,
  });
  const fail=(i,required,available)=>{
      const titleChars=Array.from(sections[i].title.trim().replace(/\s+/g,' '));
      const shortTitle=titleChars.slice(0,24).join('')+(titleChars.length>24?'…':'');
      throw new Error(`explanation ${composition} section ${i+1} (${JSON.stringify(shortTitle)}): text requires ${required.toFixed(1)} px, available ${available.toFixed(1)} px; simplify or use a custom layout, never shrink`);
  };
  const place=(i,left,top,w,m,emphasis=false)=>({
    title:[left,top,w,m.th],body:[left,top+m.th+14,w,m.bh],
    titleSize:m.titleSize,bodySize:m.bodySize,emphasis,
  });
  const groupHeight=m=>m.th+14+m.bh;
  if(composition==='prose') {
    const measures=sections.map((_,i)=>measure(i,width)), gap=30;
    const total=measures.reduce((n,m)=>n+groupHeight(m),0)+gap*(sections.length-1);
    if(total>height)fail(measures.findIndex(m=>groupHeight(m)===Math.max(...measures.map(groupHeight))),total,height);
    let top=y+Math.min(26,(height-total)/2);
    return measures.map((m,i)=>{const item=place(i,x,top,width,m);top+=groupHeight(m)+gap;return item;});
  }
  if(composition==='sequence') {
    const gap=52, w=(width-gap*(sections.length-1))/sections.length;
    const measures=sections.map((_,i)=>measure(i,w,30,30));
    const headingHeight=Math.max(...measures.map(m=>m.th));
    const total=74+headingHeight+20+Math.max(...measures.map(m=>m.bh));
    if(total>height)fail(measures.findIndex(m=>m.bh===Math.max(...measures.map(m=>m.bh))),total,height);
    const top=y+Math.min(24,(height-total)/2);
    return measures.map((m,i)=>({
      title:[x+i*(w+gap),top+74,w,m.th],body:[x+i*(w+gap),top+74+headingHeight+20,w,m.bh],
      titleSize:m.titleSize,bodySize:m.bodySize,emphasis:false,
      number:[x+i*(w+gap),top,w,65],
      connector:i<sections.length-1?[x+i*(w+gap)+w+10,top+28,gap-20]:null,
    }));
  }
  if(composition==='focus-left') {
    const leadWidth=width*0.43, rightX=x+leadWidth+80, rightWidth=width-leadWidth-80;
    const lead=measure(0,leadWidth,34), supports=sections.slice(1).map((_,i)=>measure(i+1,rightWidth));
    const total=supports.reduce((n,m)=>n+groupHeight(m),0)+42*(supports.length-1);
    if(groupHeight(lead)>height)fail(0,groupHeight(lead),height);
    if(total>height)fail(1+supports.findIndex(m=>groupHeight(m)===Math.max(...supports.map(groupHeight))),total,height);
    const leadTop=y+Math.min(24,(height-groupHeight(lead))/2), result=[place(0,x,leadTop,leadWidth,lead,true)];
    let top=y+Math.min(24,(height-total)/2);
    supports.forEach((m,j)=>{result.push(place(j+1,rightX,top,rightWidth,m));top+=groupHeight(m)+42;});
    return result;
  }
  const lead=measure(0,width,34), gap=72, supportWidth=(width-gap*(sections.length-2))/(sections.length-1);
  const supports=sections.slice(1).map((_,i)=>measure(i+1,supportWidth));
  const total=groupHeight(lead)+54+Math.max(...supports.map(groupHeight));
  if(total>height)fail(groupHeight(lead)>Math.max(...supports.map(groupHeight))?0:1+supports.findIndex(m=>groupHeight(m)===Math.max(...supports.map(groupHeight))),total,height);
  const top=y+Math.min(24,(height-total)/2);
  return [place(0,x,top,width,lead,true),...supports.map((m,j)=>place(j+1,x+j*(supportWidth+gap),top+groupHeight(lead)+54,supportWidth,m))];
}

export function validateReportMetadata(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('group-meeting requires confirmed report metadata');
  if (typeof report.presenter_omitted !== 'boolean') throw new Error('report.presenter_omitted must explicitly record the presenter choice');
  if (report.presenter_omitted) {
    if (report.presenter_name !== null && report.presenter_name !== '') throw new Error('An omitted presenter cannot retain a presenter_name');
  } else if (typeof report.presenter_name !== 'string' || !report.presenter_name.trim()) throw new Error('group-meeting requires a confirmed presenter name or explicit omission');
  const parts=/^(\d{4})\.(\d{2})\.(\d{2})$/.exec(report.report_date || '');
  if (!parts) throw new Error('report.report_date must be a generated YYYY.MM.DD date');
  const [year,month,day]=parts.slice(1).map(Number), date=new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) throw new Error('report.report_date is not a real calendar date');
  if (report.report_timezone!==null) {
    if (typeof report.report_timezone !== 'string' || !report.report_timezone.trim()) throw new Error('report.report_timezone must record local time as null or an IANA timezone');
    try { new Intl.DateTimeFormat('en',{timeZone:report.report_timezone}); } catch { throw new Error('report.report_timezone must be an IANA timezone'); }
  }
  return {presenter_name:report.presenter_omitted?null:report.presenter_name.trim(),presenter_omitted:report.presenter_omitted,report_date:report.report_date,report_timezone:report.report_timezone};
}

export function createComponents(fontFamily, themeId = 'blue') {
  if (!fontFamily?.trim()) throw new Error('A verified font family is required');
  const theme = getTheme(themeId);
  const C = Object.freeze({ ...theme.colors, blue:theme.colors.primary });
  function shape(slide, geometry, x, y, w, h, fill = C.white, stroke = 'none', lineWidth = 0) {
    return slide.shapes.add({ geometry, position: { left: x, top: y, width: w, height: h }, fill, line: { fill: stroke, width: lineWidth } });
  }
  function text(slide, value, x, y, w, h, size = 24, options = {}) {
    assertTextFits(value, w, h, size, options.label || 'text');
    const obj = shape(slide, 'textbox', x, y, w, h, 'none');
    obj.text = value;
    obj.text.style = { typeface: fontFamily, fontSize: size, color: options.color || C.ink,
      bold: options.bold || false, alignment: options.align || 'left', verticalAlignment: 'top',
      autoFit: 'none', wrap: 'square', insets: { left: 0, right: 0, top: 0, bottom: 0 } };
    return obj;
  }
  function rule(slide, x, y, w, color = C.blue) { return shape(slide, 'rect', x, y, w, 1, color); }
  function header(slide, title, page) {
    const triangle = shape(slide, 'triangle', 56, 31, 24, 22, C.blue);
    triangle.position = { left: 56, top: 31, width: 24, height: 22, rotation: 90 };
    text(slide, title, 90, 23, 1125, 43, 32, { color: C.blue, bold: true, label: 'slide title' });
    rule(slide, 56, 67, 1168);
    shape(slide, 'rect', 1237, 676, 43, 44, C.blue);
    text(slide, String(page), 1240, 683, 35, 27, 18, { color: C.on_primary, align: 'center' });
  }
  function pageTitle(slide, title) {
    return text(slide, title, 64, 101, 1150, 42, 26,
      { color: C.ink, bold: true, label: 'specific page title' });
  }
  function footer(slide, source) {
    if (source) text(slide, source, 57, 675, 1152, 37, 14, { color: C.gray, label: 'source footer' });
  }
  function takeaway(slide, value) {
    if (!value) return;
    shape(slide, 'rect', 57, 602, 1166, 55, C.blue);
    text(slide, value, 74, 614, 1132, 33, 24, { color: C.on_primary, bold: true, align: 'center', label: 'takeaway' });
  }
  function label(slide, value, x, y, w, size = 24) {
    if (value) text(slide, value, x, y, w, size * 1.4, size, { bold: true, color: C.blue });
  }
  function cover(slide, title, options = {}) {
    if (Object.hasOwn(options,'kicker')) throw new Error('cover: kicker is no longer supported; remove the extra cover label from the plan');
    const { subtitle = '', body = [] } = options;
    shape(slide, 'rect', 0, 211.42, 1280, 261.78, C.blue);
    for (const args of COVER_MARKS) shape(slide, 'roundRect', ...args, C.blue);
    text(slide, title, 105, 244, 1070, 130, 48, { color: C.on_primary, bold: true, align: 'center', label: 'cover title' });
    if (subtitle) text(slide, subtitle, 130, 387, 1020, 60, 30, { color: C.on_primary, align: 'center', label: 'cover subtitle' });
    if (body.length) text(slide, body.join('\n'), 130, 511, 1020, 137, 22, { align: 'center', label: 'cover body' });
  }
  function reportSignature(slide, metadata) {
    const report=validateReportMetadata(metadata);
    const icon=(name,box)=>{
      const svg=readFileSync(new URL(`../assets/k105-blue/icons/${name}.svg`,import.meta.url),'utf8').replaceAll('#32497B',C.primary);
      slide.images.add({blob:new Uint8Array(Buffer.from(svg)),contentType:'image/svg+xml',
        alt:name==='presenter'?'K105 学士帽图标':'K105 日历图标',fit:'contain',
        position:{left:box[0],top:box[1],width:box[2],height:box[3]}});
    };
    if (!report.presenter_omitted) {
      icon('presenter',[277.883,547.451,27.458,24.071]);
      text(slide,`汇报人：${report.presenter_name}`,315,544,355,75,26.666667,{color:'#000000',label:'presenter name'});
      icon('calendar',[697.54,547.008,25.923,26.759]);
      text(slide,`汇报日期：${report.report_date}`,735,544,370,42,26.666667,{color:'#000000',label:'generation date'});
    } else {
      icon('calendar',[443,547.008,25.923,26.759]);
      text(slide,`汇报日期：${report.report_date}`,480,544,370,42,26.666667,{color:'#000000',label:'generation date'});
    }
  }
  function reportCover(slide, metadata) {
    validateReportMetadata(metadata);
    shape(slide,'rect',0,211.416483,1280,261.777743,C.primary);
    for(const args of COVER_MARKS)shape(slide,'roundRect',...args,C.primary);
    text(slide,REPORT_TITLE,180,279,920,127,88,{color:C.on_primary,bold:true,align:'center',label:'fixed report cover'});
    reportSignature(slide,metadata);
  }
  function reportClosing(slide, metadata) {
    closing(slide);
    reportSignature(slide,metadata);
  }
  function sectionDivider(slide, section) {
    if(!section || !Array.isArray(section.items) || section.items.length<2 || section.items.length>12)
      throw new Error('section-divider: use 2–12 report groups with short display labels');
    const active=section.items.filter(item=>item.active);
    if(active.length!==1 || active[0].group_id!==section.group_id)throw new Error('section-divider: exactly the current group must be active');
    shape(slide,'rect',16.900682,16.930814,1246.198636,686.138478,'none',C.primary,2);
    shape(slide,'rect',503.184777,16.930814,273.630551,160.035696,C.primary);
    text(slide,String(section.number).padStart(2,'0'),560,35.438530,160,96.937533,72,{color:C.on_primary,bold:true,align:'center'});
    const part=['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN','ELEVEN','TWELVE'][Number(section.number)-1];
    text(slide,`PART ${part || section.number}`,535,119,210,39,26.666667,{color:C.muted_on_primary,bold:true,align:'center'});
    const twoColumns=section.items.length>6, rowsPerColumn=twoColumns?Math.ceil(section.items.length/2):section.items.length;
    const gap=rowsPerColumn<=4?100.540578:77, first=rowsPerColumn<=4?227.282625:212;
    section.items.forEach((item,index)=>{
      const y=first+gap*(twoColumns?index%rowsPerColumn:index), boxHeight=section.items.length<=4?66.846929:60;
      const x=twoColumns?64+604*Math.floor(index/rowsPerColumn):75.835906, labelX=twoColumns?x+78:163.435906, labelWidth=twoColumns?470:1040;
      shape(slide,'rect',x,y,twoColumns?62:70.183412,boxHeight,item.active?C.primary:'#BFC4D0');
      text(slide,String(item.number).padStart(2,'0'),twoColumns?x+4:80,y+(boxHeight-49)/2,twoColumns?54:61,49,twoColumns?32:37.333333,{color:C.on_primary,bold:true,align:'center'});
      const labelH=Math.max(42.0063,estimatedLines(item.label,labelWidth,26.666667)*26.666667*1.35+2);
      if(labelH>gap-2)throw new Error('section-divider: display label is too long; use a short group label and retain the full paper title on paper-info');
      text(slide,item.label,labelX,y+(boxHeight-labelH)/2,labelWidth,labelH,26.666667,{color:item.active?'#000000':'#B9BCC3',bold:true,label:'section-divider label'});
    });
  }
  function paperInfo(slide, paper, {summary,keywords=[]} = {}) {
    if(typeof paper?.title!=='string'||!paper.title.trim())throw new Error('paper-info requires the complete source paper title');
    if(typeof summary!=='string'||!summary.trim())throw new Error('paper-info.summary must state the paper’s main research content');
    if(!Array.isArray(keywords)||keywords.some(value=>typeof value!=='string'||!value.trim()))throw new Error('paper-info.keywords must be a list of nonempty text');
    let top=103;
    const titleH=estimatedLines(paper.title,1150,30)*30*1.35+3;
    text(slide,paper.title,64,top,1150,titleH,30,{bold:true,label:'complete paper title'});top+=titleH+10;
    if(paper.title_zh && paper.title_zh!==paper.title) {
      const h=estimatedLines(paper.title_zh,1150,24)*24*1.35+2;
      text(slide,paper.title_zh,64,top,1150,h,24,{color:C.gray,label:'Chinese paper title'});top+=h+12;
    }
    rule(slide,64,top+5,1150,C.rule);top+=29;
    const available=641-top;
    const rawAuthors=Array.isArray(paper.authors)?paper.authors:typeof paper.authors==='string'?[paper.authors]:[];
    if(rawAuthors.some(value=>typeof value!=='string'))throw new Error('paper.authors must be names as text');
    let authors=rawAuthors.join(', ');
    if(rawAuthors.length>4)authors=`${rawAuthors.slice(0,3).join(', ')} 等（共 ${rawAuthors.length} 位）`;
    if(estimatedLines(authors,537,24)>3 && rawAuthors.length>1)authors=`${rawAuthors[0]} 等（共 ${rawAuthors.length} 位）`;
    const metadata=[authors&&`作者：${authors}`,(paper.venue || paper.journal || paper.conference || paper.publisher)&&`来源：${paper.venue || paper.journal || paper.conference || paper.publisher}`,
      (paper.publication_date || paper.year) && `发表：${paper.publication_date || paper.year}`,
      paper.doi&&`DOI：${paper.doi}`].filter(Boolean).map(String);
    paragraphs(slide,metadata,[64,top,537,available],24,16);
    const rightX=661,rightWidth=553;
    label(slide,'主要研究内容',rightX,top,rightWidth,24);
    const summaryH=estimatedLines(summary,rightWidth,26)*26*1.35+2;
    text(slide,summary,rightX,top+42,rightWidth,summaryH,26,{label:'paper research summary'});
    if(keywords.length) {
      const keyY=top+42+summaryH+25, value=keywords.join('、'), h=estimatedLines(value,rightWidth,24)*24*1.35+2;
      if(keyY+42+h>641)throw new Error('paper-info keywords exceed the available height; shorten display keywords or research summary without changing the full paper title');
      label(slide,'关键词',rightX,keyY,rightWidth,24);
      text(slide,value,rightX,keyY+42,rightWidth,h,24,{label:'paper keywords'});
    } else if(top+42+summaryH>641)throw new Error('paper-info summary exceeds the available height');
  }
  function paragraphs(slide, lines, box, size = 27, gap = 24, distribution = 'top') {
    const geometry=paragraphGeometry(lines,box,size,gap,distribution);
    lines.forEach((line,i)=>text(slide,line,...geometry.boxes[i],size,{label:`body ${i+1}`}));
    return geometry;
  }
  function explanation(slide, sections, box, composition = 'prose') {
    const rows=explanationGeometry(sections,box,composition);
    rows.forEach((row,i)=>{
      if(row.number)text(slide,String(i+1).padStart(2,'0'),...row.number,46,{color:C.rule,bold:true,label:'sequence number'});
      if(row.connector) {
        const [x,y,w]=row.connector;
        rule(slide,x,y,w-5,C.primary);
        const arrow=shape(slide,'triangle',x+w-7,y-4,8,9,C.primary);
        arrow.position={left:x+w-7,top:y-4,width:8,height:9,rotation:90};
      }
      text(slide,sections[i].title,...row.title,row.titleSize,{bold:true,color:C.primary,label:'explanation heading'});
      text(slide,sections[i].body,...row.body,row.bodySize,{bold:row.emphasis,color:row.emphasis?C.primary:C.ink,label:'explanation body'});
    });
    return rows;
  }
  function nativeTable(slide, values, box, columnWidths, size = 22) {
    const [x, y, width, height] = box;
    if (values.length < 2 || values.length > 7 || !values[0]?.length || values[0].length > 6)
      throw new Error('table: built-in layout supports 2–7 rows including header and 1–6 columns; use a custom layout for other sizes');
    if (values.some(row => row.length !== values[0].length)) throw new Error('table: inconsistent row widths');
    const widths = columnWidths || Array(values[0].length).fill(width / values[0].length);
    if (widths.length !== values[0].length || widths.some(n => !Number.isFinite(n) || n <= 24) || Math.abs(widths.reduce((a,b)=>a+b,0)-width) > 1)
      throw new Error(`table: column_widths must be positive pixel widths summing to ${width}`);
    const rowH = height / values.length;
    values.forEach((row, r) => row.forEach((cell, col) => assertTextFits(cell, widths[col] - 24, rowH - 18, size, `table ${r + 1},${col + 1}`)));
    const obj = slide.tables.add({ rows: values.length, columns: values[0].length, left: x, top: y, width, height, columnWidths: widths, values });
    obj.borders.assign({ fill: C.rule, width: 0.7, style: 'solid' });
    values.forEach((row, r) => row.forEach((_, col) => {
      const cell = obj.getCell(r, col); cell.fill = r === 0 ? C.blue : r % 2 === 0 ? C.light : C.white;
      cell.text.style = { fontSize: size, typeface: fontFamily, color: r === 0 ? C.on_primary : C.ink, bold: r === 0 };
    }));
    obj.cells.block({ row: 0, column: 0, rowCount: values.length, columnCount: values[0].length }).assign({ margins: { left: 12, right: 12, top: 10, bottom: 8 }, anchor: 'center' });
    return obj;
  }
  function methods(slide, steps, { input = '', stop = '', output = '', pageTitleCreated = false } = {}) {
    if (!Array.isArray(steps) || steps.length < 2 || steps.length > 4) throw new Error('methods: built-in layout requires 2–4 steps');
    const inputY = pageTitleCreated ? 160 : 111, stepY = pageTitleCreated ? 245 : 213;
    const bodyY = pageTitleCreated ? 340 : 314, stopY = pageTitleCreated ? 477 : 465;
    if (input) text(slide, input, 62, inputY, 1154, 75, 25, { label: 'method input' });
    const gap = 42, width = (1154 - gap * (steps.length - 1)) / steps.length;
    const boxes = steps.map((step, index) => {
      const x = 62 + index * (width + gap);
      const box = shape(slide, 'rect', x, stepY, width, 73, C.light, C.rule, 1);
      text(slide, step.title, x + 10, stepY + 21, width - 20, 38, 24, { color: C.blue, bold: true, align: 'center', label: 'method step title' });
      if (step.body) text(slide, step.body, x + 7, bodyY, width - 14, 126, 23, { label: 'method step body' });
      return box;
    });
    boxes.slice(0, -1).forEach((box, i) => slide.shapes.connect(box, boxes[i + 1], {
      kind: 'straight', fromSide: 'right', toSide: 'left', line: { fill: C.blue, width: 2 },
      // In the current Artifact Tool API tail is the destination marker.
      tail: { type: 'triangle', width: 'sm', length: 'sm' },
    }));
    if (stop) { rule(slide, 62, stopY, 1154, C.rule); text(slide, stop, 62, stopY + 22, 1154, pageTitleCreated ? 77 : 89, 24, { label: 'method stopping condition' }); }
    if (output) takeaway(slide, output);
  }
  function closing(slide) {
    shape(slide, 'rect', 0, 211.416483, 1280, 261.777743, C.blue);
    for (const args of COVER_MARKS) shape(slide, 'roundRect', ...args, C.blue);
    text(slide, CLOSING_TEXT, 134.847874, 301.914751, 1010.304252, 80.781208,
      44 * 4 / 3, { color: C.on_primary, bold: true, align: 'center', label: 'fixed closing' });
  }
  function agenda(slide, items) {
    if (!Array.isArray(items) || !items.length || items.length > 12)
      throw new Error('agenda: this template supports 1–12 short items; larger reports need a deliberately authored navigation layout');
    shape(slide, 'rect', 16.900682, 16.930814, 1246.198636, 686.138478, 'none', C.blue, 2);
    shape(slide, 'rect', 503.184777, 16.930814, 273.630551, 160.035696, C.blue);
    text(slide, '目录', 556.256798, 35.438530, 167.486510, 96.937533, 72,
      { color: C.on_primary, bold: true, align: 'center' });
    text(slide, 'contents', 550, 120, 180, 38, 26.666667,
      { color: C.muted_on_primary, bold: true, align: 'center' });
    const twoColumns=items.length>6, rowsPerColumn=twoColumns?Math.ceil(items.length/2):items.length;
    const gap = rowsPerColumn <= 4 ? 100.540578 : 77;
    const first = rowsPerColumn <= 4 ? 227.282625 : 212;
    items.forEach((item, i) => {
      const y = first + gap * (twoColumns?i%rowsPerColumn:i), numberHeight = items.length <= 4 ? 66.846929 : 60;
      const x=twoColumns?64+604*Math.floor(i/rowsPerColumn):75.835906;
      shape(slide, 'rect', x, y, twoColumns?62:70.183412, numberHeight, C.blue);
      text(slide, String(i + 1).padStart(2, '0'), twoColumns?x+4:80, y + (numberHeight - 49) / 2, twoColumns?54:61, 49, twoColumns?32:37.333333,
        { color: C.on_primary, bold: true, align: 'center' });
      const labelWidth=twoColumns?418:905,labelH=twoColumns?Math.max(42.0063,estimatedLines(item.label,labelWidth,26.666667)*26.666667*1.35+2):42.0063;
      if(labelH>gap-2)throw new Error('agenda: display label is too long; use a short group label and retain the complete title on paper-info');
      text(slide, item.label, twoColumns?x+78:163.435906, twoColumns?y+(numberHeight-labelH)/2:y+12.420262, labelWidth, labelH, 26.666667,
        { color: '#000000', bold: true, label: 'agenda short label' });
      text(slide, String(item.start_page), twoColumns?x+510:1120, y + 12.420262, twoColumns?40:84, 42.006300, 26.666667,
        { color: C.blue, bold: true, align: 'right', label: 'agenda start page' });
    });
  }
  return { shape, text, rule, header, pageTitle, footer, takeaway, label, cover, paragraphs, explanation, nativeTable, methods, closing, agenda, reportCover, reportClosing, reportSignature, sectionDivider, paperInfo, colors: C, fontFamily, themeId:theme.theme_id, paletteSha256:theme.palette_sha256 };
}
