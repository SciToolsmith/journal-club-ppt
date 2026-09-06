/** Validate the reusable group-meeting outline, separately from scientific evidence. */

export const REPORT_SECTION_ROLES = Object.freeze([
  'paper_info', 'background', 'methods', 'findings', 'appraisal', 'implications',
  'theory', 'materials', 'mechanism', 'validation', 'comparison', 'custom',
]);
const ROLES = new Set(REPORT_SECTION_ROLES);
const SPECIAL_PAGES = new Set(['cover', 'agenda', 'section-divider', 'closing']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameMembers = (a, b) => a.length === b.length && a.every(value => b.includes(value));

function requireThat(condition, message) {
  if (!condition) throw new Error(`Report structure: ${message}`);
}
function identifier(value, label) {
  requireThat(typeof value === 'string' && value.length > 0 && value === value.trim(), `${label} must be a nonempty string without surrounding whitespace`);
  return value;
}
function identifiers(value, label) {
  requireThat(Array.isArray(value) && value.length > 0, `${label} must be a nonempty list`);
  value.forEach(item => identifier(item, label));
  requireThat(new Set(value).size === value.length, `${label} must not contain duplicates`);
  return value;
}

/**
 * A profile is explicit so previously delivered plans retain their old behavior.
 * by-theme remains supported only without this profile, so a new group-meeting
 * plan cannot bypass the required one-paper-at-a-time structure.
 * @returns {{divider_items: Record<string, object>} | null}
 */
export function validateReportStructure(plan, papers) {
  const navigation = plan?.navigation;
  if (navigation?.profile == null) return null;
  requireThat(navigation.profile === 'group-meeting', 'unknown navigation.profile');
  requireThat(['single', 'by-paper'].includes(navigation.mode), 'group-meeting mode must be single or by-paper');
  requireThat(record(papers) && Array.isArray(papers.papers), 'papers.papers must be a list');
  requireThat(Array.isArray(plan.slides) && plan.slides.length > 0, 'plan.slides must be a nonempty list');
  const sources = new Map();
  for (const paper of papers.papers) {
    requireThat(record(paper), 'each source must be an object');
    const pid = identifier(paper.paper_id, 'paper_id');
    requireThat(!sources.has(pid), `duplicate paper_id: ${pid}`);
    sources.set(pid, paper);
  }
  const primaryIds = [...sources].filter(([, paper]) => (paper.source_role ?? 'primary') === 'primary').map(([id]) => id);
  requireThat(primaryIds.length > 0, 'at least one primary paper is required');
  const groups = navigation.groups;
  requireThat(Array.isArray(groups) && groups.length > 0, 'navigation.groups must be a nonempty list');
  if (navigation.mode === 'single') {
    requireThat(primaryIds.length === 1 && groups.length === 1, 'single mode requires one primary paper and one group');
  } else {
    requireThat(primaryIds.length > 1, 'by-paper mode requires multiple primary papers');
    requireThat(groups.length === primaryIds.length || groups.length === primaryIds.length + 1,
      'by-paper requires one group per paper and at most one final synthesis group');
  }

  const groupIds = new Set(), sections = new Map(), groupPapers = [];
  for (const [groupIndex, group] of groups.entries()) {
    requireThat(record(group), 'each group must be an object');
    const gid = identifier(group.group_id, 'group_id');
    requireThat(!groupIds.has(gid), `duplicate group_id: ${gid}`);
    groupIds.add(gid);
    identifier(group.label, `${gid}.label`);
    identifiers(group.paper_ids, `${gid}.paper_ids`);
    requireThat(group.paper_ids.every(pid => primaryIds.includes(pid)), `${gid} must reference primary papers only`);
    const synthesis = navigation.mode === 'by-paper' && groupIndex === primaryIds.length;
    if (synthesis) requireThat(sameMembers(group.paper_ids, primaryIds), 'the final synthesis group must contain all primary papers');
    else {
      requireThat(group.paper_ids.length === 1, `${gid} must contain exactly one primary paper`);
      groupPapers.push(group.paper_ids[0]);
    }
    requireThat(Array.isArray(group.sections) && group.sections.length > 0, `${gid}.sections must be a nonempty list`);
    for (const [sectionIndex, section] of group.sections.entries()) {
      requireThat(record(section), `${gid} section must be an object`);
      const sid = identifier(section.section_id, 'section_id');
      requireThat(!sections.has(sid), `duplicate section_id: ${sid}`);
      identifier(section.label, `${sid}.label`);
      requireThat(ROLES.has(section.role), `${sid}.role must be a supported report section role`);
      if (section.covers !== undefined) {
        requireThat(Array.isArray(section.covers), `${sid}.covers must be a list of additional report roles`);
        requireThat(new Set(section.covers).size === section.covers.length && section.covers.every(role => ROLES.has(role)),
          `${sid}.covers must contain unique supported report roles`);
        requireThat(!section.covers.includes('paper_info'), `${sid}: paper_info cannot be substituted by covers`);
        requireThat(section.role !== 'paper_info' || section.covers.length === 0,
          `${sid}: paper_info must remain independent and cannot cover other report roles`);
      }
      if (section.role === 'custom' || section.covers?.includes('custom')) {
        identifier(section.reason, `${sid}.reason for custom role`);
      }
      if (!synthesis && sectionIndex === 0) {
        requireThat(section.role === 'paper_info' && section.label === '文献基本信息',
          `${gid}: first section must have role paper_info and label 文献基本信息`);
      } else requireThat(section.role !== 'paper_info', `${sid}: paper_info belongs only to the first section of each paper group`);
      sections.set(sid, { group, groupIndex, section, ordinal: sections.size, uses: 0 });
    }
  }
  requireThat(sameMembers(groupPapers, primaryIds) && new Set(groupPapers).size === primaryIds.length,
    'paper groups must cover each primary paper exactly once');

  const overrides = plan.structure_overrides ?? {};
  requireThat(record(overrides), 'structure_overrides must contain explicit written reasons');
  for (const [key, value] of Object.entries(overrides)) {
    requireThat(['agenda', 'closing'].includes(key), 'structure_overrides accepts only agenda/closing');
    identifier(value, `structure_overrides.${key} reason`);
  }
  const slides = plan.slides, slideIds = new Set(), positions = new Map();
  for (const [index, slide] of slides.entries()) {
    requireThat(record(slide), 'each slide must be an object');
    const sid = identifier(slide.slide_id, 'slide_id');
    requireThat(!slideIds.has(sid), `duplicate slide_id: ${sid}`);
    slideIds.add(sid); positions.set(sid, index);
  }
  const indexesOf = type => slides.flatMap((slide, index) => slide.render?.type === type ? [index] : []);
  const covers = indexesOf('cover'), endings = indexesOf('closing'), agendas = indexesOf('agenda');
  requireThat(covers.length === 1 && covers[0] === 0, 'exactly one cover must be the first slide');
  requireThat(endings.length <= 1 && (endings.length === 0 || endings[0] === slides.length - 1), 'a closing slide must be unique and last');
  requireThat(overrides.closing || endings.length === 1, 'a fixed closing slide is required unless explicitly overridden');
  if (!overrides.agenda) {
    if (navigation.mode === 'single') requireThat(agendas.length === 0, 'single-paper reports do not use an agenda');
    else requireThat(agendas.length === 1 && agendas[0] === 1, 'multi-paper reports require one agenda immediately after the cover');
  }
  const dividers = new Map(), firstBodies = new Map();
  let currentGroup = -1, previousSection = -1;
  for (const [index, slide] of slides.entries()) {
    const type = slide.render?.type, sid = slide.slide_id;
    if (SPECIAL_PAGES.has(type)) {
      requireThat(!own(slide, 'section_id'), `${sid}: navigation pages must not carry section_id`);
      if (type !== 'section-divider') continue;
      requireThat(navigation.mode === 'by-paper', 'single-paper reports do not use section-divider pages');
      requireThat(Object.keys(slide.render).every(key => ['type', 'group_id'].includes(key)), `${sid}: section-divider accepts only render.type and group_id`);
      const gid = identifier(slide.render.group_id, `${sid}.render.group_id`);
      const groupIndex = groups.findIndex(group => group.group_id === gid), group = groups[groupIndex];
      requireThat(groupIndex >= 0, `${sid}: unknown divider group_id`);
      requireThat(!dividers.has(gid), `${gid}: each group has exactly one divider`);
      requireThat(groupIndex === currentGroup + 1, `${sid}: dividers must follow group order`);
      requireThat(groupIndex === 0 || firstBodies.has(groups[groupIndex - 1].group_id), `${sid}: previous group has no body pages before this divider`);
      identifiers(slide.paper_ids, `${sid}.paper_ids`);
      requireThat(sameMembers(slide.paper_ids, group.paper_ids), `${sid}: divider paper_ids must match its group exactly`);
      requireThat(!slide.claims?.length && !slide.evidence_ids?.length, `${sid}: divider pages cannot carry scientific claims or evidence`);
      dividers.set(gid, { slide, index }); currentGroup = groupIndex;
      continue;
    }
    const entry = sections.get(slide.section_id);
    requireThat(entry !== undefined, `${sid}: body page must reference a known section_id`);
    const { group, groupIndex, section } = entry;
    if (navigation.mode === 'by-paper') requireThat(groupIndex === currentGroup, `${sid}: each paper's body must follow its own divider without crossing groups`);
    requireThat(entry.ordinal >= previousSection, `${sid}: section order moves backwards`);
    previousSection = entry.ordinal; entry.uses += 1;
    const slidePapers = identifiers(slide.paper_ids, `${sid}.paper_ids`);
    requireThat(slidePapers.some(pid => group.paper_ids.includes(pid)), `${sid}: body page must declare its group's primary paper`);
    requireThat(slidePapers.every(pid => {
      const paper = sources.get(pid);
      return paper && group.paper_ids.includes((paper.source_role ?? 'primary') === 'primary' ? pid : paper.related_to);
    }), `${sid}: body page sources must belong to its paper group; cross-paper synthesis belongs in the final synthesis group`);
    if (!firstBodies.has(group.group_id)) {
      firstBodies.set(group.group_id, { slide, index });
      if (group.paper_ids.length === 1) requireThat(type === 'paper-info' && section.role === 'paper_info', `${group.group_id}: first body page must use render.type paper-info`);
    }
    if (type === 'paper-info' || section.role === 'paper_info') {
      requireThat(type === 'paper-info' && section.role === 'paper_info', `${sid}: paper-info render and paper_info section role must agree`);
      requireThat(sameMembers(slidePapers, group.paper_ids), `${sid}: paper-info must correspond only to its primary paper`);
    }
  }
  for (const [sid, entry] of sections) requireThat(entry.uses > 0, `${sid}: unused section has no body page`);
  if (navigation.mode === 'by-paper') requireThat(dividers.size === groups.length, 'every paper and synthesis group requires its own divider');
  for (const index of agendas) {
    const slide = slides[index], items = slide.render.items;
    requireThat(Array.isArray(items) && items.length === groups.length, `${slide.slide_id}: agenda must have one item per group in group order`);
    for (const [groupIndex, group] of groups.entries()) {
      const item = items[groupIndex], target = (dividers.get(group.group_id) ?? firstBodies.get(group.group_id))?.slide;
      requireThat(record(item) && item.label === group.label && Array.isArray(item.paper_ids) && sameMembers(item.paper_ids, group.paper_ids),
        `${slide.slide_id}: agenda labels and paper_ids must match groups in group order`);
      requireThat(target && item.target_slide_id === target.slide_id && positions.get(target.slide_id) > index,
        `${slide.slide_id}: agenda target must be the corresponding subsequent group divider (or first body for an explicit single-paper agenda)`);
    }
  }
  const dividerItems = {};
  for (const [gid, { slide }] of dividers) {
    const groupIndex = groups.findIndex(group => group.group_id === gid), group = groups[groupIndex];
    Object.defineProperty(dividerItems, slide.slide_id, { enumerable: true, value: {
      group_id: gid, number: String(groupIndex + 1).padStart(2, '0'), label: group.label,
      items: groups.map((item, index) => ({ group_id: item.group_id, number: String(index + 1).padStart(2, '0'),
        label: item.label, active: index === groupIndex, paper_ids: [...item.paper_ids] })),
    } });
  }
  return { divider_items: dividerItems };
}
