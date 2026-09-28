import { classifyDocumentRole } from '@/lib/luna/document-role';
import { diversePriorityFiles, documentRole, nasPriority, normalizeNasPath, projectPathRoot, rankNasPriority, type NasMark, type PriorityRow } from '@/lib/luna/nas-priority';

export const PROJECT_NAVIGATION_VERSION = 'project-navigation/1';
export function isProjectDetailFollowup(text: string): boolean {
  return /^(?:(?:그거보다|그보다)\s*|(?:그|이)\s*(?:자료|보고|디자인)(?:의|가|이|는)?\s*)?(?:더\s*)?(?:자세히|자세한\s*자료|세부\s*자료|아이데이션|수정안|전후\s*과정|나온\s*과정)(?:\s*(?:도|을|를))?\s*(?:알고\s*싶어|보여\s*줘|찾아\s*줘|알려\s*줘)?[.!?]*$/.test(text.trim());
}
export function wantsProjectDetail(query: string): boolean {
  const condition = query.split(/\r?\n조건:/).slice(1).join(' ');
  return /자세|세부|과정|아이데이션|수정안|대안|전후|이전.*보고/.test(condition);
}
function dateIn(text: string): string | null {
  for (const match of text.matchAll(/(?:^|\D)(20\d{6}|\d{6})(?=\D|$)/g)) {
    const value = match[1]!.length === 6 ? '20' + match[1] : match[1]!;
    const iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
    const date = new Date(iso + 'T00:00:00Z');
    if (Number.isFinite(date.getTime()) && date.toISOString().startsWith(iso)) return iso;
  }
  return null;
}
export function projectFileStep(row: PriorityRow) {
  const root = projectPathRoot(row.path);
  const clean = row.path.replace(/^[a-z]:[/\\]+/i, '');
  const relative = root ? clean.slice(root.length).replace(/^[/\\]+/, '') : clean;
  const parts = relative.split(/[/\\]+/).filter(Boolean);
  const file = parts.pop() ?? '';
  const eligible = [...parts].reverse().find(p => /보고|report|review|리뷰|미팅|회의|ideation|아이데이션|기획|컨셉|concept|수정|시안|design|디자인|설계/i.test(p));
  const datedFolderIndex = parts.findLastIndex(p => Boolean(dateIn(p)));
  const separator = row.path.includes('\\') ? '\\' : '/';
  const folder = datedFolderIndex >= 0
    ? [root, ...parts.slice(0, datedFolderIndex + 1)].filter(Boolean).join(separator)
    : row.path.slice(0, Math.max(row.path.lastIndexOf('/'), row.path.lastIndexOf('\\')));
  const purpose = classifyDocumentRole(relative);
  const external = /(?:^|[/\\])(?:\d*[ ._-]*)?(?:제공받은|외부자료|수급자료|고객사\s*수취|research|references?|samples?)(?:[^/\\]*)/i.test(relative);
  const milestone = !external && !purpose.purpose && purpose.role !== 'operations' && purpose.role !== 'reference' &&
    /보고|report|review|리뷰|미팅|회의|제출/i.test(eligible ?? file);
  const date = dateIn([...parts].reverse().find(p => dateIn(p)) ?? file);
  return { root, section: [root, parts[0]].filter(Boolean).join(separator), folder, label: datedFolderIndex >= 0 ? parts[datedFolderIndex]! : eligible ?? parts[parts.length - 1] ?? '프로젝트 자료', date, milestone,
    core: !external && !purpose.purpose && !['operations','reference'].includes(purpose.role) &&
      (purpose.role !== 'other' || Boolean(eligible)), role: documentRole(row.path), excluded: external || Boolean(purpose.purpose) || purpose.role === 'reference' };
}

/** Date/folder adjacency is a navigation hint, never a proven decision/causal chain. */
export function buildProjectNavigation<T extends PriorityRow>(files: T[], marks: NasMark[], query: string, limit = 8) {
  const detail = wantsProjectDetail(query);
  const ranked = rankNasPriority(files, marks);
  const steps = ranked.map(row => ({ row, ...projectFileStep(row) }));
  const grouped = new Map<string, typeof steps[number]>();
  for (const step of steps.filter(s => s.core || s.milestone)) {
    const key = `${step.row.drive}:${normalizeNasPath(step.folder)}:${step.date ?? ''}`;
    if (!grouped.has(key)) grouped.set(key, step);
  }
  const groups = [...grouped.values()];
  const dated = groups.filter(s => s.date).sort((a,b) => a.date!.localeCompare(b.date!) || a.folder.localeCompare(b.folder));
  // Reserve room for actual report/review folders rather than another manual version.
  const milestones = rankNasPriority(groups.filter(s => s.milestone).map(s => s.row), marks).slice(0, 2);
  const core = diversePriorityFiles(groups.filter(s => s.core).map(s => s.row), marks, limit);
  const designIndex = core.findIndex(r => documentRole(r.path) === 'design');
  if (designIndex >= 0) {
    const currentLevel = nasPriority(core[designIndex]!, marks).level;
    const projectDesign = groups.find(s => s.core && s.role === 'design' &&
      /(?:planning|document|기획|문서)/i.test(s.section) && nasPriority(s.row, marks).level >= currentLevel);
    if (projectDesign) core[designIndex] = projectDesign.row;
  }
  const unique = (rows: T[]) => [...new Map(rows.map(r => [`${r.drive}:${normalizeNasPath(r.path)}`, r])).values()];
  const anchorRow = core.find(r => projectFileStep(r).milestone) ?? milestones[0];
  const anchor = anchorRow ? projectFileStep(anchorRow) : null;
  // Expand inside the phase that contains the important report, not arbitrary
  // newest files across later operations or award folders.
  const rootSteps = anchor ? dated.filter(s => s.root === anchor.root) : dated;
  const sectionSteps = anchor ? rootSteps.filter(s => s.section === anchor.section) : rootSteps;
  const phase = sectionSteps.length >= 3 ? sectionSteps : rootSteps;
  const before = anchor?.date ? phase.filter(s => s.date! <= anchor.date!) : phase;
  const detailSteps = before.length > limit
    ? [before[0]!, ...before.slice(-(limit-1))]
    : [...before, ...phase.filter(s => !before.includes(s))].slice(0, limit);
  const detailRows = detailSteps.map(s => s.row);
  const selected = detail
    ? unique([...detailRows, ...core, ...milestones]).slice(0, limit)
    : unique([...core.slice(0,3), ...milestones, ...core.slice(3), ...diversePriorityFiles(files.filter(r => !projectFileStep(r).excluded), marks, limit)]).slice(0, limit);
  const shownSteps = detail ? detailSteps : dated.filter(s => milestones.includes(s.row) || s.row === anchorRow);
  return { selected, trace: { layer: 2, rule_version: PROJECT_NAVIGATION_VERSION, mode: detail ? 'detail' : 'overview',
    state: 'metadata-supported-navigation', full_document_verified: false,
    milestones: milestones.map(r => ({ drive:r.drive, path:r.path, ...projectFileStep(r) })),
    steps: shownSteps.map(s => ({ drive:s.row.drive, folder:s.folder, label:s.label, date:s.date,
      representative_path:s.row.path, basis:'folder-name-and-date', relation:'adjacent-candidate' })),
    anchor: anchor ? { root:anchor.root, folder:anchor.folder, date:anchor.date } : null,
    candidate_steps:dated.length, phase_steps:phase.length, omitted_steps: Math.max(0, (detail ? phase : dated).length - shownSteps.length),
    selection: selected.map(r => ({ drive:r.drive, path:r.path,
      source:{id:r.id ?? null,scan_batch:r.scan_batch ?? null,modified_at:r.modified_at ?? null},
      ...nasPriority(r, marks), ...projectFileStep(r) })) } };
}
