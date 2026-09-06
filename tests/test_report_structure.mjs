import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REPORT_SECTION_ROLES, validateReportStructure } from '../scripts/report_structure.mjs';
import { resolveNavigation } from '../scripts/navigation.mjs';

const sources = (...ids) => ({ papers: ids.map(paper_id => ({ paper_id })) });
const navPage = (slide_id, type, paper_ids = [], extra = {}) => ({ slide_id, paper_ids: [...paper_ids], render: { type, ...extra } });
const body = (slide_id, section_id, paper_ids, type = 'text') => ({ slide_id, section_id, paper_ids: [...paper_ids], render: { type } });
const group = (group_id, paper_id) => ({
  group_id, label: `${paper_id}论文短标题`, paper_ids: [paper_id], sections: [
    { section_id: `${group_id}-info`, label: '文献基本信息', role: 'paper_info' },
    { section_id: `${group_id}-results`, label: '主要结果与分析', role: 'findings' },
    { section_id: `${group_id}-appraisal`, label: '贡献、局限与研究启发', role: 'appraisal', covers: ['implications'] },
  ],
});
const bodies = group => group.sections.map((section, index) => body(`${group.group_id}-body${index + 1}`, section.section_id, group.paper_ids, index === 0 ? 'paper-info' : 'text'));
const single = () => {
  const g = group('g1', 'P1');
  return { navigation: { profile: 'group-meeting', mode: 'single', groups: [g] },
    slides: [navPage('cover', 'cover'), ...bodies(g), navPage('closing', 'closing')] };
};
const byPaper = (synthesis = true) => {
  const groups = [group('g1', 'P2'), group('g2', 'P1')];
  if (synthesis) groups.push({ group_id: 'g3', label: '文献比较与综合思考', paper_ids: ['P1', 'P2'],
    sections: [{ section_id: 'g3-comparison', role: 'comparison', label: '文献比较与综合思考' }] });
  return { navigation: { profile: 'group-meeting', mode: 'by-paper', groups }, slides: [
    navPage('cover', 'cover'), navPage('agenda', 'agenda', ['P1', 'P2'], {
      items: groups.map(g => ({ label: g.label, paper_ids: g.paper_ids, target_slide_id: `${g.group_id}-divider` })),
    }),
    ...groups.flatMap(g => [navPage(`${g.group_id}-divider`, 'section-divider', g.paper_ids, { group_id: g.group_id }),
      ...(g.paper_ids.length === 1 ? bodies(g) : [body('synthesis', 'g3-comparison', ['P1', 'P2'])])]),
    navPage('closing', 'closing'),
  ] };
};

test('new single-paper profile has 1.1 numbering, stable sections and no separate paper divider', () => {
  const plan = single(), snapshot = structuredClone(plan), result = resolveNavigation(plan, sources('P1'));
  assert.equal(result.headings['g1-body1'].header, '1.1 文献基本信息');
  assert.equal(result.headings['g1-body2'].header, '1.2 主要结果与分析');
  assert.equal(result.headings['g1-body3'].number, '1.3');
  assert.deepEqual(result.report_structure, { divider_items: {} });
  assert.deepEqual(plan, snapshot);
});

test('multi-paper navigation and divider highlights follow report order, including synthesis', () => {
  const plan = byPaper(), snapshot = structuredClone(plan), result = resolveNavigation(plan, sources('P1', 'P2'));
  assert.equal(result.headings['g1-body1'].header, '1.1 文献基本信息');
  assert.equal(result.headings['g2-body1'].header, '2.1 文献基本信息');
  assert.equal(result.headings.synthesis.number, '3.1');
  assert.equal(result.headings['g1-divider'], undefined);
  const dividers = result.report_structure.divider_items;
  assert.deepEqual(Object.keys(dividers), ['g1-divider', 'g2-divider', 'g3-divider']);
  assert.deepEqual(dividers['g2-divider'], {
    group_id: 'g2', number: '02', label: 'P1论文短标题', items: [
      { group_id: 'g1', number: '01', label: 'P2论文短标题', active: false, paper_ids: ['P2'] },
      { group_id: 'g2', number: '02', label: 'P1论文短标题', active: true, paper_ids: ['P1'] },
      { group_id: 'g3', number: '03', label: '文献比较与综合思考', active: false, paper_ids: ['P1', 'P2'] },
    ],
  });
  assert.deepEqual(plan, snapshot);
});

test('synthesis is optional and adding a page does not create a subsection', () => {
  const plan = byPaper(false);
  plan.slides.splice(5, 0, body('more-results', 'g1-results', ['P2']));
  const result = resolveNavigation(plan, sources('P1', 'P2'));
  assert.equal(result.headings['more-results'].header, result.headings['g1-body2'].header);
  assert.equal(Object.keys(result.report_structure.divider_items).length, 2);
});

test('cross-disciplinary titles and short reports do not require six separate sections', () => {
  const plan = single();
  plan.navigation.groups[0].sections[1].label = '核心观点与史料论证';
  plan.navigation.groups[0].sections[2].label = '论证评价与争议';
  assert.equal(resolveNavigation(plan, sources('P1')).headings['g1-body2'].header, '1.2 核心观点与史料论证');
});

test('every paper requires a real paper-info first body and fixed basic-information label', () => {
  const cases = [
    [p => { p.navigation.groups[0].sections[0].role = 'background'; }, /first section/],
    [p => { p.navigation.groups[0].sections[0].label = '论文概况'; }, /first section/],
    [p => { p.slides[1].render.type = 'text'; }, /first body page/],
    [p => { p.slides[2].render.type = 'paper-info'; }, /must agree/],
    [p => { p.navigation.groups[0].sections[1].role = 'paper_info'; }, /only to the first section/],
    [p => { p.navigation.groups[0].sections[1].covers = ['paper_info']; }, /cannot be substituted/],
    [p => { p.navigation.groups[0].sections[0].covers = ['findings']; }, /must remain independent/],
  ];
  for (const [mutate, error] of cases) { const plan = single(); mutate(plan); assert.throws(() => validateReportStructure(plan, sources('P1')), error); }
  const secondMissing = byPaper();
  secondMissing.slides.find(s => s.slide_id === 'g2-body1').render.type = 'text';
  assert.throws(() => resolveNavigation(secondMissing, sources('P1', 'P2')), /first body page/);
  const emptyCovers = single(); emptyCovers.navigation.groups[0].sections[0].covers = [];
  assert.ok(resolveNavigation(emptyCovers, sources('P1')));
});

test('section roles and custom reasons are validated without hardcoding every label', () => {
  const plan = single();
  const section = plan.navigation.groups[0].sections[1];
  section.role = 'custom'; section.label = '版本谱系与文本流传'; section.reason = '版本差异是论证有效性的关键';
  assert.ok(validateReportStructure(plan, sources('P1')));
  delete section.reason;
  assert.throws(() => validateReportStructure(plan, sources('P1')), /reason for custom/);
  section.role = 'invented';
  assert.throws(() => validateReportStructure(plan, sources('P1')), /supported report section role/);
  section.role = 'findings'; section.covers = ['invalid'];
  assert.throws(() => validateReportStructure(plan, sources('P1')), /supported report roles/);
  section.covers = ['validation', 'validation'];
  assert.throws(() => validateReportStructure(plan, sources('P1')), /unique supported/);
});

test('cover is unique and first; a closing when present is unique and last', () => {
  for (const mutate of [p => p.slides.shift(), p => p.slides.push(navPage('other-cover', 'cover')), p => p.slides.reverse()]) {
    const plan = single(); mutate(plan); assert.throws(() => validateReportStructure(plan, sources('P1')), /cover must be the first/);
  }
  const plan = single(); plan.slides.splice(2, 0, navPage('early-end', 'closing'));
  assert.throws(() => validateReportStructure(plan, sources('P1')), /unique and last/);
});

test('single reports omit agendas and dividers by default', () => {
  const agenda = single(); agenda.slides.splice(1, 0, navPage('agenda', 'agenda'));
  assert.throws(() => validateReportStructure(agenda, sources('P1')), /do not use an agenda/);
  const divider = single(); divider.slides.splice(1, 0, navPage('divider', 'section-divider', ['P1'], { group_id: 'g1' }));
  assert.throws(() => validateReportStructure(divider, sources('P1')), /do not use section-divider/);
});

test('explicit agenda and closing exceptions retain required reasons and valid existing positions', () => {
  const plan = single(); plan.slides.pop();
  assert.throws(() => validateReportStructure(plan, sources('P1')), /fixed closing slide is required/);
  plan.structure_overrides = { closing: '用户明确要求不设结束页' };
  assert.ok(validateReportStructure(plan, sources('P1')));
  plan.structure_overrides.agenda = '用户明确要求单篇也列目录';
  const g = plan.navigation.groups[0];
  plan.slides.splice(1, 0, navPage('agenda', 'agenda', ['P1'], { items: [{ label: g.label, paper_ids: ['P1'], target_slide_id: 'g1-body1' }] }));
  assert.ok(validateReportStructure(plan, sources('P1')));
  plan.structure_overrides.agenda = '';
  assert.throws(() => validateReportStructure(plan, sources('P1')), /reason must be/);
  const multi = byPaper(); multi.structure_overrides = { agenda: '用户明确要求逐篇直接进入，不加总目录' }; multi.slides.splice(1, 1);
  assert.ok(validateReportStructure(multi, sources('P1', 'P2')));
});

test('multi-paper agenda uses exact group labels/order and targets each actual divider', () => {
  const cases = [
    [p => p.slides.splice(1, 1), /one agenda immediately/],
    [p => { [p.slides[1], p.slides[2]] = [p.slides[2], p.slides[1]]; }, /one agenda immediately/],
    [p => { p.slides[1].render.items[0].target_slide_id = 'g1-body1'; }, /corresponding subsequent group divider/],
    [p => { p.slides[1].render.items[0].label = '另一名称'; }, /labels and paper_ids/],
    [p => { p.slides[1].render.items.reverse(); }, /labels and paper_ids/],
    [p => { p.slides[1].render.items.pop(); }, /one item per group/],
  ];
  for (const [mutate, error] of cases) { const plan = byPaper(); mutate(plan); assert.throws(() => validateReportStructure(plan, sources('P1', 'P2')), error); }
});

test('each group has exactly one correctly attributed divider before its body', () => {
  const cases = [
    [p => { p.slides = p.slides.filter(s => s.slide_id !== 'g1-divider'); }, /body must follow its own divider/],
    [p => { p.slides[2].render.group_id = 'g2'; }, /dividers must follow group order/],
    [p => { p.slides[2].paper_ids = ['P1']; }, /paper_ids must match/],
    [p => { p.slides[2].section_id = 'g1-info'; }, /must not carry section_id/],
    [p => { p.slides[2].claims = [{ text: '伪装为分隔页的研究结论' }]; }, /cannot carry scientific claims/],
    [p => { p.slides[2].render.title = '不受目录管理的标题'; }, /accepts only/],
    [p => { p.slides.splice(3, 0, { ...structuredClone(p.slides[2]), slide_id: 'duplicate-divider' }); }, /exactly one divider/],
  ];
  for (const [mutate, error] of cases) { const plan = byPaper(); mutate(plan); assert.throws(() => validateReportStructure(plan, sources('P1', 'P2')), error); }
});

test('body pages remain within paper groups while related supplement evidence is allowed', () => {
  const plan = byPaper(), papers = sources('P1', 'P2');
  papers.papers.push({ paper_id: 'S2', source_role: 'supplement', related_to: 'P2' });
  plan.slides.find(s => s.slide_id === 'g1-body2').paper_ids = ['P2', 'S2'];
  assert.ok(resolveNavigation(plan, papers));
  plan.slides.find(s => s.slide_id === 'g1-body2').paper_ids.push('P1');
  assert.throws(() => resolveNavigation(plan, papers), /sources must belong to its paper group/);
  const info = byPaper(); info.slides.find(s => s.slide_id === 'g1-body1').paper_ids.push('S2');
  assert.throws(() => resolveNavigation(info, papers), /paper-info must correspond only/);
});

test('section order, unused sections, and interleaved papers cannot disguise missing coverage', () => {
  const reversed = single(); [reversed.slides[2], reversed.slides[3]] = [reversed.slides[3], reversed.slides[2]];
  assert.throws(() => validateReportStructure(reversed, sources('P1')), /section order moves backwards/);
  const unused = single(); unused.slides.splice(2, 1);
  assert.throws(() => validateReportStructure(unused, sources('P1')), /unused section/);
  const interleaved = byPaper();
  interleaved.slides.splice(-1, 0, body('back-to-first', 'g1-results', ['P2']));
  assert.throws(() => validateReportStructure(interleaved, sources('P1', 'P2')), /without crossing groups/);
});

test('legacy by-theme remains supported but cannot bypass the new group-meeting profile', () => {
  assert.equal(validateReportStructure({}, {}), null);
  const legacy = single(); delete legacy.navigation.profile;
  assert.equal(validateReportStructure(legacy, sources('P1')), null);
  assert.equal(resolveNavigation(legacy, sources('P1')).headings['g1-body1'].number, '1');
  const thematic = { navigation: { mode: 'by-theme', groups: [{ group_id: 'all', paper_ids: ['P1', 'P2'],
    sections: [{ section_id: 'comparison', label: '共同问题' }] }] }, slides: [body('compare', 'comparison', ['P1', 'P2'])] };
  assert.equal(validateReportStructure(thematic, sources('P1', 'P2')), null);
  assert.equal(resolveNavigation(thematic, sources('P1', 'P2')).headings.compare.number, '1');
  thematic.navigation.profile = 'group-meeting';
  assert.throws(() => validateReportStructure(thematic, sources('P1', 'P2')), /group-meeting mode must be single or by-paper/);
  assert.throws(() => resolveNavigation(thematic, sources('P1', 'P2')), /group-meeting mode must be single or by-paper/);
});

test('catalog and validation share the exact supported report functions', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../assets/report-sections.json', import.meta.url), 'utf8'));
  assert.deepEqual(catalog.sections.map(section => section.role), REPORT_SECTION_ROLES);
  assert.equal(catalog.sections.find(section => section.role === 'paper_info').label, '文献基本信息');
  assert.equal(catalog.default_roles.length, 6);
});
