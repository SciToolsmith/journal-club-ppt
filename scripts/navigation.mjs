/** Resolve explicit section navigation without inferring it from slide titles. */

import { validateReportStructure } from './report_structure.mjs';

const NAVIGATION_PAGES = new Set(['cover', 'agenda', 'closing']);
const MODES = new Set(['single', 'by-paper', 'by-theme']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireThat(condition, message) {
  if (!condition) throw new Error(`Navigation: ${message}`);
}

function identifier(value, label) {
  requireThat(typeof value === 'string' && value.trim().length > 0, `${label} must be a nonempty string`);
  requireThat(value === value.trim(), `${label} must not have leading or trailing whitespace`);
  return value;
}

function identifiers(value, label) {
  requireThat(Array.isArray(value) && value.length > 0, `${label} must be a nonempty list`);
  value.forEach(item => identifier(item, label));
  requireThat(new Set(value).size === value.length, `${label} must not contain duplicates`);
  return value;
}

function sameMembers(a, b) {
  return a.length === b.length && a.every(value => b.includes(value));
}

function hasNumberPrefix(label) {
  // Delimiters distinguish numbering from names such as 2型糖尿病 or 3D打印.
  // Hierarchical numbers and explicit chapter names are unambiguous prefixes.
  const chinese = '[一二三四五六七八九十百零〇两]+';
  const number = `(?:\\d+|${chinese})`;
  return new RegExp(`^(?:` +
    `\\d+(?:[.．]\\d+)+(?:\\s|[.．、:：)）]|(?=[^\\d.．])|$)|` +
    `${number}\\s*[.．、:：)）]\\s*|` +
    `${number}\\s+|` +
    `${number}$|` +
    `[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|` +
    `[IVXLCDM]+[.．、:：)）]\\s*|` +
    `[（(]\\s*${number}\\s*[)）]|` +
    `第\\s*${number}\\s*(?:章|节|部分|篇)|` +
    `(?:Chapter|Section|Part)\\s+\\d+(?:\\s|[.．:：、)）]|$)` +
    `)`, 'i').test(label);
}

/**
 * @param {{navigation?: object, slides: object[]}} plan Explicit deck plan.
 * @param {{papers: object[]}} papers Source records, including source_role.
 * @returns {{enabled: boolean, headings: Record<string, object>}}
 */
export function resolveNavigation(plan, papers) {
  requireThat(record(plan) && Array.isArray(plan.slides), 'plan.slides must be a list');
  const configured = plan.navigation !== undefined && plan.navigation !== null;
  const hasSections = plan.slides.some(slide => record(slide) && own(slide, 'section_id'));
  if (!configured) {
    requireThat(!hasSections, 'slide.section_id requires plan.navigation');
    return { enabled: false, headings: {} };
  }

  const navigation = plan.navigation;
  requireThat(record(navigation) && MODES.has(navigation.mode), 'mode must be single, by-paper or by-theme');
  requireThat(record(papers) && Array.isArray(papers.papers), 'papers.papers must be a list');
  const primaryIds = [];
  for (const paper of papers.papers) {
    requireThat(record(paper), 'each source record must be an object');
    if ((paper.source_role ?? 'primary') === 'primary') primaryIds.push(identifier(paper.paper_id, 'primary paper_id'));
  }
  requireThat(primaryIds.length > 0, 'at least one primary paper is required');
  requireThat(new Set(primaryIds).size === primaryIds.length, 'primary paper_id must not be duplicated');
  const groups = navigation.groups;
  requireThat(Array.isArray(groups) && groups.length > 0, 'groups must be a nonempty list');
  const groupIds = new Set(), sections = new Map();

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    requireThat(record(group), 'each group must be an object');
    const groupId = identifier(group.group_id, 'group_id');
    requireThat(!groupIds.has(groupId), `duplicate group_id: ${groupId}`);
    groupIds.add(groupId);
    const groupPapers = identifiers(group.paper_ids, `${groupId}.paper_ids`);
    requireThat(groupPapers.every(pid => primaryIds.includes(pid)), `${groupId} must reference primary papers only`);
    requireThat(Array.isArray(group.sections) && group.sections.length > 0, `${groupId}.sections must be a nonempty list`);
    for (let sectionIndex = 0; sectionIndex < group.sections.length; sectionIndex += 1) {
      const section = group.sections[sectionIndex];
      requireThat(record(section), `${groupId} section must be an object`);
      const sectionId = identifier(section.section_id, 'section_id');
      requireThat(!sections.has(sectionId), `duplicate section_id: ${sectionId}`);
      const label = identifier(section.label, `${sectionId}.label`);
      requireThat(!hasNumberPrefix(label), `${sectionId}.label must not include a handwritten number prefix`);
      const numberedByPaper = navigation.mode === 'by-paper' || (navigation.profile === 'group-meeting' && navigation.mode === 'single');
      const number = numberedByPaper ? `${groupIndex + 1}.${sectionIndex + 1}` : `${sectionIndex + 1}`;
      sections.set(sectionId, {
        ordinal: sections.size,
        heading: { header: `${number} ${label}`, section_id: sectionId, section_label: label,
          number, group_id: groupId, paper_ids: [...groupPapers] },
        uses: 0,
      });
    }
  }

  if (navigation.mode === 'single') {
    requireThat(primaryIds.length === 1, 'single mode requires exactly one primary paper');
    requireThat(groups.length === 1 && sameMembers(groups[0].paper_ids, primaryIds),
      'single mode requires exactly one group containing the primary paper');
  } else if (navigation.mode === 'by-theme') {
    requireThat(primaryIds.length > 1, 'by-theme mode requires multiple primary papers');
    requireThat(groups.length === 1 && sameMembers(groups[0].paper_ids, primaryIds),
      'by-theme mode requires exactly one group containing all primary papers');
  } else {
    const count = primaryIds.length;
    requireThat(count > 1, 'by-paper mode requires multiple primary papers');
    requireThat(groups.length === count || groups.length === count + 1,
      'by-paper requires one group per primary paper, plus at most one final synthesis group');
    const orderedPapers = groups.slice(0, count).map(group => {
      requireThat(group.paper_ids.length === 1, 'each by-paper group must contain exactly one primary paper');
      return group.paper_ids[0];
    });
    requireThat(sameMembers(orderedPapers, primaryIds) && new Set(orderedPapers).size === count,
      'by-paper groups must cover every primary paper exactly once');
    if (groups.length === count + 1) {
      requireThat(sameMembers(groups[count].paper_ids, primaryIds),
        'the optional final synthesis group must contain all primary papers');
    }
  }

  const headings = {}, slideIds = new Set();
  let previousOrdinal = -1;
  for (const slide of plan.slides) {
    requireThat(record(slide), 'each slide must be an object');
    const slideId = identifier(slide.slide_id, 'slide_id');
    requireThat(!slideIds.has(slideId), `duplicate slide_id: ${slideId}`);
    slideIds.add(slideId);
    if (NAVIGATION_PAGES.has(slide.render?.type) || (navigation.profile === 'group-meeting' && navigation.mode !== 'by-theme' && slide.render?.type === 'section-divider')) {
      requireThat(!own(slide, 'section_id'), `${slideId}: navigation pages must not carry section_id`);
      continue;
    }
    const sectionId = identifier(slide.section_id, `${slideId}.section_id`);
    const section = sections.get(sectionId);
    requireThat(section !== undefined, `${slideId}: unknown section_id: ${sectionId}`);
    const slidePapers = identifiers(slide.paper_ids, `${slideId}.paper_ids`);
    requireThat(slidePapers.some(pid => section.heading.paper_ids.includes(pid)),
      `${slideId}: paper_ids must intersect the section group's primary papers`);
    requireThat(section.ordinal >= previousOrdinal,
      `${slideId}: section order moves backwards relative to groups/sections`);
    previousOrdinal = section.ordinal;
    section.uses += 1;
    // Defining a data property also handles unusual but valid ids such as
    // "__proto__" without changing the object's prototype.
    Object.defineProperty(headings, slideId, { value: { ...section.heading, paper_ids: [...section.heading.paper_ids] },
      enumerable: true, configurable: true, writable: true });
  }
  for (const [sectionId, section] of sections) {
    requireThat(section.uses > 0, `unused section has no body page: ${sectionId}`);
  }
  const reportStructure = validateReportStructure(plan, papers);
  return { enabled: true, headings, ...(reportStructure ? { report_structure: reportStructure } : {}) };
}
