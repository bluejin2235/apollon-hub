import { classifyDocumentRole, type DocumentRole } from '@/lib/luna/document-role';
export type { DocumentRole } from '@/lib/luna/document-role';
/** Explicit marks remain separate from patterns inferred from marked folders. */
export type NasMark = { drive: string; path: string; note?: string | null };
export type PriorityRow = { drive?: string | null; path: string; importance?: number | null; modified_at?: string | null };
export const ROLE_LABELS: Record<DocumentRole, string> = {
  proposal: '제안', concept: '컨셉·기획', design: '디자인·설계', report: '주요 보고',
  planning: '수행계획', operations: '운영', review: '심의·기술자료', reference: '참고', other: '기타 자료'
};
export const normalizeNasPath = (path: string) => path.replace(/^[a-z]:[/\\]+/i, '').replace(/[/\\]+/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
export const sameDrive = (a?: string | null, b?: string | null) => Boolean(a && b && a.replace(':', '').toUpperCase() === b.replace(':', '').toUpperCase());
export function underNasPath(path: string, prefix: string): boolean {
  const p = normalizeNasPath(path), root = normalizeNasPath(prefix);
  return Boolean(root && (p === root || p.startsWith(root + '/')));
}
export function projectPathRoot(path: string): string | null {
  const clean = path.replace(/^[a-z]:[/\\]+/i, '');
  const match = clean.match(/^(?:(?:\d+\s+)?(?:Project|사업개발)[/\\]+\d{4}[/\\]+[^/\\]+|\d+\s+[^/\\]+)(?=[/\\]|$)/i);
  return match?.[0] ?? null;
}
export function documentRole(path: string): DocumentRole {
  const root = projectPathRoot(path);
  const text = (root ? path.replace(/^[a-z]:[/\\]+/i, '').slice(root.length) : path).toLowerCase();
  return classifyDocumentRole(text).role;
}
export function buildPriorityProfile(marks: NasMark[]) {
  const counts = Object.fromEntries(Object.keys(ROLE_LABELS).map(k => [k, 0])) as Record<DocumentRole, number>;
  for (const mark of marks) counts[documentRole(mark.path)]++;
  return { marked_paths: marks.length, roles: counts };
}
export function nasPriority(row: PriorityRow, marks: NasMark[], profile = buildPriorityProfile(marks)) {
  const manual = marks.some(m => sameDrive(row.drive, m.drive) && underNasPath(row.path, m.path));
  const role = documentRole(row.path);
  const scanner = (row.importance ?? 0) > 0;
  const pattern = role !== 'other' && role !== 'reference' && profile.roles[role] >= 2;
  const level = manual ? 3 : scanner ? 2 : pattern ? 1 : 0;
  const reason = manual ? '등록 중요 폴더 하위' : scanner ? '스캔 중요 표시' : pattern ? '중요 폴더의 문서 유형과 유사' : '프로젝트 소속';
  return { level, role, reason, manual, scanner, inferred: !manual && !scanner && pattern };
}
const roleRank: Record<DocumentRole, number> = { proposal: 8, concept: 7, design: 6, report: 5, planning: 4, operations: 3, review: 2, other: 1, reference: 0 };
function filenameVersion(path: string): number {
  const leaf = path.split(/[/\\]+/).pop() ?? '';
  const dates = [...leaf.matchAll(/(?:^|\D)(\d{8}|\d{6})(?=\D|$)/g)].map(m => Number(m[1]) + (m[1]!.length === 6 ? 20000000 : 0)).filter(n => {
    const day = n % 100, month = Math.floor(n / 100) % 100;
    return month >= 1 && month <= 12 && day >= 1 && day <= 31;
  });
  return Math.max(0, ...dates);
}
const namedDelivery = (path: string) => /final|최종|제출/i.test(path.split(/[/\\]+/).pop() ?? '') ? 1 : 0;
/** Relevance/snapshot filters must run first. This never widens project scope. */
export function rankNasPriority<T extends PriorityRow>(rows: T[], marks: NasMark[], limit = rows.length): T[] {
  const profile = buildPriorityProfile(marks);
  const priorities = new Map(rows.map(row => [row, nasPriority(row, marks, profile)]));
  return [...rows].sort((a, b) => {
    const x = priorities.get(a)!, y = priorities.get(b)!;
    return y.level - x.level || roleRank[y.role] - roleRank[x.role] ||
      namedDelivery(b.path) - namedDelivery(a.path) ||
      filenameVersion(b.path) - filenameVersion(a.path) ||
      (Date.parse(b.modified_at ?? '') || 0) - (Date.parse(a.modified_at ?? '') || 0) || a.path.localeCompare(b.path);
  }).slice(0, limit);
}
/** One representative of each important role prevents duplicate versions filling the brief. */
export function diversePriorityFiles<T extends PriorityRow>(rows: T[], marks: NasMark[], limit = 8): T[] {
  const ranked = rankNasPriority(rows, marks).filter(r => documentRole(r.path) !== 'reference');
  const selected: T[] = [];
  for (const role of ['proposal', 'concept', 'design', 'report', 'planning', 'operations', 'review'] as DocumentRole[]) {
    const candidate = ranked.find(r => documentRole(r.path) === role);
    if (candidate) selected.push(candidate);
  }
  return [...selected, ...ranked.filter(r => !selected.includes(r))].slice(0, limit);
}
export function broadProjectSubject(query: string): string | null {
  const q = query.trim().split(/\r?\n조건:/, 1)[0]!;
  const match = q.match(/^(.{2,60}?)\s+(?:관련\s+)?(?:전체|모든)\s*(?:자료|문서|파일)\s*(?:찾아\s*줘|찾아\s*주세요|보여\s*줘|보여\s*주세요|검색해\s*줘)[.!?]*$/);
  const subject = match?.[1]?.replace(/\s*관련$/, '').trim();
  return subject && !/^(?:전체|모든|나스|NAS|워크서버|우리|회사)$/i.test(subject) ? subject : null;
}
