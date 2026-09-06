// Reusable K105 geometry. Text is always native; evidence images remain unchanged.
import { getTheme } from './themes.mjs';
export const STYLE = Object.freeze({
  width: 1280, height: 720,
});
export const COVER_MARKS = Object.freeze([
  [36.365, 27.573, 62.635, 6.396], [36.365, 38.178, 45.439, 6.396],
  [36.365, 48.784, 30.604, 6.396], [1181, 686.367, 62.635, 6.396],
  [1198.196, 675.761, 45.439, 6.396], [1213.030, 665.156, 30.604, 6.396],
]);
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

export function explanationGeometry(sections, box) {
  if (!Array.isArray(sections) || sections.length<2 || sections.length>4)
    throw new Error('explanation: use 2–4 substantive titled sections; otherwise choose another composition');
  const [x,y,width,height]=box, rowHeight=height/sections.length, labelWidth=230, gutter=40;
  return sections.map((section,i)=>{
    if (!section || typeof section.title!=='string' || !section.title.trim() || typeof section.body!=='string' || !section.body.trim())
      throw new Error('explanation: each section needs a nonempty title and body');
    if(Object.keys(section).some(key=>!['title','body'].includes(key)))throw new Error('explanation: unsupported section field');
    const bodyWidth=width-labelWidth-gutter;
    const th=estimatedLines(section.title,labelWidth,26)*26*1.35;
    const bh=estimatedLines(section.body,bodyWidth,26)*26*1.35;
    if(Math.max(th,bh)>rowHeight-24)throw new Error('explanation: text exceeds a row; simplify or use a custom layout, never shrink');
    return {title:[x,y+i*rowHeight+(rowHeight-th)/2,labelWidth,th+1],
      body:[x+labelWidth+gutter,y+i*rowHeight+(rowHeight-bh)/2,bodyWidth,bh+1],
      divider:i?y+i*rowHeight:null};
  });
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
  function paragraphs(slide, lines, box, size = 27, gap = 24, distribution = 'top') {
    const geometry=paragraphGeometry(lines,box,size,gap,distribution);
    lines.forEach((line,i)=>text(slide,line,...geometry.boxes[i],size,{label:`body ${i+1}`}));
    return geometry;
  }
  function explanation(slide, sections, box) {
    const [x,,width]=box;
    const rows=explanationGeometry(sections,box);
    rows.forEach((row,i)=>{
      if(row.divider!==null)rule(slide,x,row.divider,width,C.rule);
      text(slide,sections[i].title,...row.title,26,{bold:true,color:C.primary,label:'explanation heading'});
      text(slide,sections[i].body,...row.body,26,{label:'explanation body'});
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
    if (!Array.isArray(items) || !items.length || items.length > 6)
      throw new Error('agenda: this template supports 1–6 short items; consolidate sections without omitting primary papers');
    shape(slide, 'rect', 16.900682, 16.930814, 1246.198636, 686.138478, 'none', C.blue, 2);
    shape(slide, 'rect', 503.184777, 16.930814, 273.630551, 160.035696, C.blue);
    text(slide, '目录', 556.256798, 35.438530, 167.486510, 96.937533, 72,
      { color: C.on_primary, bold: true, align: 'center' });
    text(slide, 'contents', 550, 120, 180, 38, 26.666667,
      { color: C.muted_on_primary, bold: true, align: 'center' });
    const gap = items.length <= 4 ? 100.540578 : 77;
    const first = items.length <= 4 ? 227.282625 : 212;
    items.forEach((item, i) => {
      const y = first + gap * i, numberHeight = items.length <= 4 ? 66.846929 : 60;
      shape(slide, 'rect', 75.835906, y, 70.183412, numberHeight, C.blue);
      text(slide, String(i + 1).padStart(2, '0'), 80, y + (numberHeight - 49) / 2, 61, 49, 37.333333,
        { color: C.on_primary, bold: true, align: 'center' });
      text(slide, item.label, 163.435906, y + 12.420262, 905, 42.006300, 26.666667,
        { color: '#000000', bold: true, label: 'agenda short label' });
      text(slide, String(item.start_page), 1120, y + 12.420262, 84, 42.006300, 26.666667,
        { color: C.blue, bold: true, align: 'right', label: 'agenda start page' });
    });
  }
  return { shape, text, rule, header, pageTitle, footer, takeaway, label, cover, paragraphs, explanation, nativeTable, methods, closing, agenda, colors: C, fontFamily, themeId:theme.theme_id, paletteSha256:theme.palette_sha256 };
}
