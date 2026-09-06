import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNavigation } from '../scripts/navigation.mjs';

const source = (...ids) => ({ papers: ids.map(paper_id => ({ paper_id })) });
const section = (section_id, label) => ({ section_id, label });
const group = (group_id, paper_ids, sections) => ({ group_id, paper_ids, sections });
const body = (slide_id, section_id, paper_ids = ['P1'], title = '本页具体研究主题') =>
  ({ slide_id, section_id, paper_ids, title, render: { type: 'text' } });
const navigationPage = (slide_id, type) => ({ slide_id, paper_ids: [], title: '导航页', render: { type } });
const single = () => ({
  navigation: { mode: 'single', groups: [group('paper', ['P1'], [section('background', '研究背景'), section('method', '材料与方法')])] },
  slides: [navigationPage('cover', 'cover'), body('b1', 'background'), body('m1', 'method'), navigationPage('end', 'closing')],
});
const byPaper = () => ({
  navigation: { mode: 'by-paper', groups: [
    group('second-first', ['P2'], [section('p2-background', '研究背景'), section('p2-results', '结果分析')]),
    group('first-second', ['P1'], [section('p1-background', '研究背景'), section('p1-results', '结果分析')]),
    group('synthesis', ['P1', 'P2'], [section('comparison', '横向比较')]),
  ] },
  slides: [navigationPage('cover', 'cover'), navigationPage('agenda', 'agenda'),
    body('p2b', 'p2-background', ['P2']), body('p2r', 'p2-results', ['P2']),
    body('p1b', 'p1-background'), body('p1r', 'p1-results'),
    body('compare', 'comparison', ['P1', 'P2']), navigationPage('end', 'closing')],
});

test('legacy plans without navigation keep the previous behavior', () => {
  const plan = { slides: [{ slide_id: 'old', title: '1. 旧式页标题', render: { type: 'text' } }] };
  assert.deepEqual(resolveNavigation(plan, {}), { enabled: false, headings: {} });
  plan.navigation = null;
  assert.deepEqual(resolveNavigation(plan, {}), { enabled: false, headings: {} });
});

test('section references require a navigation directory', () => {
  assert.throws(() => resolveNavigation({ slides: [body('s1', 'background')] }, source('P1')), /requires plan.navigation/);
  assert.throws(() => resolveNavigation({ slides: [{ section_id: null }] }, {}), /requires plan.navigation/);
});

test('single-paper navigation separates section heading from the untouched specific title', () => {
  const plan = single(), snapshot = structuredClone(plan);
  const result = resolveNavigation(plan, source('P1'));
  assert.equal(result.enabled, true);
  assert.deepEqual(result.headings.b1, { header: '1 研究背景', section_id: 'background', section_label: '研究背景',
    number: '1', group_id: 'paper', paper_ids: ['P1'] });
  assert.equal(result.headings.m1.header, '2 材料与方法');
  assert.deepEqual(Object.keys(result.headings), ['b1', 'm1']);
  assert.deepEqual(plan, snapshot);
});

test('inserting another body page in the same section repeats its number without adding a section', () => {
  const plan = single();
  plan.slides.splice(2, 0, body('b2', 'background', ['P1'], '第二项背景证据'));
  const result = resolveNavigation(plan, source('P1'));
  assert.equal(result.headings.b1.header, result.headings.b2.header);
  assert.equal(result.headings.m1.number, '2');
  assert.equal(plan.slides.length, 5);
});

test('section labels and count are chosen explicitly, not a hardcoded four-section outline', () => {
  const plan = single();
  plan.navigation.groups[0].sections = [section('clinical', '2型糖尿病'), section('printing', '3D打印'), section('other', '其他证据')];
  plan.slides = [body('s1', 'clinical'), body('s2', 'printing'), body('s3', 'other')];
  const result = resolveNavigation(plan, source('P1'));
  assert.equal(result.headings.s1.header, '1 2型糖尿病');
  assert.equal(result.headings.s2.header, '2 3D打印');
  assert.equal(result.headings.s3.number, '3');
});

test('by-paper numbering follows narration order rather than input source order', () => {
  const result = resolveNavigation(byPaper(), source('P1', 'P2'));
  assert.equal(result.headings.p2b.header, '1.1 研究背景');
  assert.equal(result.headings.p2r.number, '1.2');
  assert.equal(result.headings.p1b.header, '2.1 研究背景');
  assert.equal(result.headings.p1r.number, '2.2');
  assert.equal(result.headings.compare.header, '3.1 横向比较');
  assert.deepEqual(result.headings.compare.paper_ids, ['P1', 'P2']);
});

test('reordering primary groups and their body pages updates numbers automatically', () => {
  const plan = byPaper();
  [plan.navigation.groups[0], plan.navigation.groups[1]] = [plan.navigation.groups[1], plan.navigation.groups[0]];
  plan.slides = [plan.slides[0], plan.slides[1], plan.slides[4], plan.slides[5], plan.slides[2], plan.slides[3], plan.slides[6], plan.slides[7]];
  const result = resolveNavigation(plan, source('P1', 'P2'));
  assert.equal(result.headings.p1b.number, '1.1');
  assert.equal(result.headings.p2b.number, '2.1');
  assert.equal(result.headings.compare.number, '3.1');
});

test('by-paper synthesis is optional', () => {
  const plan = byPaper();
  plan.navigation.groups.pop();
  plan.slides = plan.slides.filter(slide => slide.slide_id !== 'compare');
  assert.equal(resolveNavigation(plan, source('P1', 'P2')).headings.p1r.number, '2.2');
});

test('by-theme allows individual-paper evidence pages within the all-paper group', () => {
  const plan = { navigation: { mode: 'by-theme', groups: [group('all', ['P2', 'P1'], [section('problem', '研究问题'), section('evidence', '关键证据')])] },
    slides: [body('p1', 'problem', ['P1']), body('p2', 'problem', ['P2']), body('results', 'evidence', ['P1', 'P2'])] };
  const result = resolveNavigation(plan, source('P1', 'P2'));
  assert.equal(result.headings.p1.number, '1');
  assert.equal(result.headings.p2.number, '1');
  assert.equal(result.headings.results.number, '2');
});

test('mode cardinality and primary membership are validated', () => {
  assert.throws(() => resolveNavigation(single(), source('P1', 'P2')), /exactly one primary/);
  const one = single(); one.navigation.mode = 'by-theme';
  assert.throws(() => resolveNavigation(one, source('P1')), /multiple primary/);
  one.navigation.mode = 'by-paper';
  assert.throws(() => resolveNavigation(one, source('P1')), /multiple primary/);
  const missing = byPaper(); missing.navigation.groups[1].paper_ids = ['P2'];
  assert.throws(() => resolveNavigation(missing, source('P1', 'P2')), /exactly once/);
  const incompleteTheme = single(); incompleteTheme.navigation.mode = 'by-theme';
  assert.throws(() => resolveNavigation(incompleteTheme, source('P1', 'P2')), /all primary/);
  assert.throws(() => resolveNavigation(single(), source('P1', 'P1')), /must not be duplicated/);
});

test('supplement and duplicate sources do not become primary groups', () => {
  const papers = source('P1');
  papers.papers.push({ paper_id: 'S1', source_role: 'supplement', related_to: 'P1' }, { paper_id: 'D1', source_role: 'duplicate', related_to: 'P1' });
  assert.equal(resolveNavigation(single(), papers).enabled, true);
  const plan = single(); plan.navigation.groups[0].paper_ids = ['S1'];
  assert.throws(() => resolveNavigation(plan, papers), /primary papers only/);
});

test('synthesis must be last and must contain every primary paper', () => {
  const first = byPaper(); [first.navigation.groups[0], first.navigation.groups[2]] = [first.navigation.groups[2], first.navigation.groups[0]];
  assert.throws(() => resolveNavigation(first, source('P1', 'P2')), /exactly one primary/);
  const partial = byPaper(); partial.navigation.groups[2].paper_ids = ['P1'];
  assert.throws(() => resolveNavigation(partial, source('P1', 'P2')), /synthesis group must contain all/);
  const extra = byPaper(); extra.navigation.groups.push(group('extra', ['P1'], [section('extra', '额外') ]));
  assert.throws(() => resolveNavigation(extra, source('P1', 'P2')), /at most one final synthesis/);
});

test('duplicate and empty identifiers and labels fail explicitly', () => {
  const cases = [
    [plan => { plan.navigation.groups[0].group_id = ''; }, /group_id must be a nonempty/],
    [plan => { plan.navigation.groups[0].sections[0].section_id = ' '; }, /section_id must be a nonempty/],
    [plan => { plan.navigation.groups[0].sections[0].label = ''; }, /label must be a nonempty/],
    [plan => { plan.navigation.groups[0].sections[0].label = ' 背景'; }, /whitespace/],
    [plan => { plan.navigation.groups[0].sections[1].section_id = 'background'; }, /duplicate section_id/],
    [plan => { plan.navigation.groups[0].paper_ids = ['P1', 'P1']; }, /must not contain duplicates/],
    [plan => { plan.navigation.groups[0].sections = []; }, /nonempty list/],
    [plan => { plan.slides[2].slide_id = 'b1'; }, /duplicate slide_id/],
  ];
  for (const [mutate, expected] of cases) { const plan = single(); mutate(plan); assert.throws(() => resolveNavigation(plan, source('P1')), expected); }
  const plan = byPaper(); plan.navigation.groups[1].group_id = plan.navigation.groups[0].group_id;
  assert.throws(() => resolveNavigation(plan, source('P1', 'P2')), /duplicate group_id/);
});

test('handwritten numeric and chapter prefixes are rejected while scientific names survive', () => {
  for (const label of ['1. 研究背景', '1、研究背景', '1 研究背景', '1.1 研究背景', '1.1研究背景', '（1）研究背景', '(2)研究背景', '一、研究背景', '第一章 研究背景', '第2节 方法', 'Part 1 Background', '1', '1.1', '①研究背景', 'IV. 方法', 'Part 1']) {
    const plan = single(); plan.navigation.groups[0].sections[0].label = label;
    assert.throws(() => resolveNavigation(plan, source('P1')), /handwritten number prefix/, label);
  }
});

test('body pages must name known sections and navigation pages must not name them', () => {
  const omitted = single(); delete omitted.slides[1].section_id;
  assert.throws(() => resolveNavigation(omitted, source('P1')), /section_id must be a nonempty/);
  const unknown = single(); unknown.slides[1].section_id = 'guessed-from-title';
  assert.throws(() => resolveNavigation(unknown, source('P1')), /unknown section_id/);
  for (const type of ['cover', 'agenda', 'closing']) {
    const plan = single(); plan.slides.unshift({ ...navigationPage(`extra-${type}`, type), section_id: 'background' });
    assert.throws(() => resolveNavigation(plan, source('P1')), /must not carry section_id/);
  }
});

test('body pages must intersect the group primary sources but may declare additional evidence sources', () => {
  const bad = byPaper(); bad.slides[2].paper_ids = ['P1'];
  assert.throws(() => resolveNavigation(bad, source('P1', 'P2')), /must intersect/);
  const mixed = byPaper(); mixed.slides[2].paper_ids = ['P1', 'P2'];
  assert.equal(resolveNavigation(mixed, source('P1', 'P2')).headings.p2b.number, '1.1');
});

test('unused sections and groups cannot pad the navigation directory', () => {
  const plan = single(); plan.navigation.groups[0].sections.push(section('unused', '尚未讨论'));
  assert.throws(() => resolveNavigation(plan, source('P1')), /unused section/);
  const allUnused = byPaper(); allUnused.slides = allUnused.slides.filter(slide => slide.slide_id !== 'p1b' && slide.slide_id !== 'p1r');
  assert.throws(() => resolveNavigation(allUnused, source('P1', 'P2')), /unused section/);
});

test('section traversal must follow directory order without backwards jumps', () => {
  const reversed = single(); [reversed.slides[1], reversed.slides[2]] = [reversed.slides[2], reversed.slides[1]];
  assert.throws(() => resolveNavigation(reversed, source('P1')), /moves backwards/);
  const loop = single(); loop.slides.splice(3, 0, body('loop', 'background'));
  assert.throws(() => resolveNavigation(loop, source('P1')), /moves backwards/);
  const groupsBackwards = byPaper(); groupsBackwards.slides.splice(6, 0, body('back-to-p2', 'p2-results', ['P2']));
  assert.throws(() => resolveNavigation(groupsBackwards, source('P1', 'P2')), /moves backwards/);
});
