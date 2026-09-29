import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotionSource } from './notion';
import { loadPagesByIds } from './search-secondary';
import { isSearchToken } from './keyword-token';

export type NotionDirectoryProject = { key: string; pageIds: string[] };

/** Exact names in the accepted directory can scope a named request even when
 * the generic parser does not know that project. Similar-example requests stay broad.
 */
export function namedDirectorySubjects(directory: NotionDirectoryProject[], query: string): string[] {
  if (/유사|비슷|다른\s*프로젝트|비교|참고\s*사례/.test(query)) return [];
  const compact = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const asked = compact(query);
  const dates: string[] = query.match(/(?<!\d)\d{6}(?!\d)/g) ?? [];
  const subjects = directory.flatMap(p => {
    const date = p.key.match(/^\s*(\d{6})\s+/)?.[1];
    if (dates.length && date && !dates.includes(date)) return [];
    const name = p.key.replace(/^\s*\d{6}\s+/, '').trim();
    if (compact(name).length < 6 || !/[가-힣a-z]/i.test(name) || !asked.includes(compact(name))) return [];
    return [name];
  });
  return [...new Set(subjects)].filter(s => !subjects.some(other => other !== s && compact(other).includes(compact(s))));
}

/** Navigate existing accepted relationships; this does not infer or write membership. */
export async function loadNotionProjectDirectory(admin: SupabaseClient): Promise<NotionDirectoryProject[]> {
  const projects = new Map<string, Set<string>>();
  for (let start = 0; start < 4000; start += 1000) {
    const { data, error } = await admin.from('luna_links').select('from_id,to_id')
      .eq('kind', 'belongs').eq('from_type', 'notion_page').eq('to_type', 'project')
      .eq('status', 'active').gte('confidence', 0.7)
      .order('to_id', { ascending: true }).order('from_id', { ascending: true }).range(start, start + 999);
    if (error) return [];
    for (const row of data ?? []) {
      if (!row.from_id || !row.to_id) continue;
      const ids = projects.get(row.to_id) ?? new Set<string>();
      ids.add(row.from_id); projects.set(row.to_id, ids);
    }
    if (!data || data.length < 1000) break;
  }
  return [...projects].slice(0, 240).map(([key, ids]) => ({ key, pageIds: [...ids] }));
}

export function selectDirectoryProjects(directory: NotionDirectoryProject[], choices: unknown): NotionDirectoryProject[] {
  if (!Array.isArray(choices)) return [];
  return [...new Set(choices)].filter((i): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < directory.length)
    .slice(0, 6).map(i => directory[i]);
}

/** Ground navigation in actual document titles, not just a project-name guess. */
export async function describeNotionProjectDirectory(admin: SupabaseClient, directory: NotionDirectoryProject[]): Promise<string> {
  const ids = [...new Set(directory.flatMap(p => p.pageIds))];
  const titles = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 200) {
    const {data, error} = await admin.from('luna_notion_pages').select('page_id,title')
      .in('page_id', ids.slice(start, start + 200)).eq('archived', false);
    if (error) continue;
    for (const page of data ?? []) titles.set(page.page_id, page.title);
  }
  return directory.map((p,i) => {
    const docs = [...new Set(p.pageIds.flatMap(id => titles.has(id) ? [titles.get(id)!] : []))];
    const selected: string[] = [], roles = new Set<string>();
    for (const title of docs) { const role = documentRole(title); if (!roles.has(role)) { roles.add(role); selected.push(title); } }
    for (const title of docs) if (!selected.includes(title)) selected.push(title);
    return `[${i}] ${p.key} (${p.pageIds.length}개 문서) — ${selected.slice(0, 6).join(' / ')}`;
  }).join('\n');
}

function documentRole(title: string): string {
  if (/테스트|test|빔테스트/i.test(title)) return 'test';
  if (/준공|최종|final/i.test(title)) return 'final';
  if (/설계|도서|허가|시공|design/i.test(title)) return 'design';
  if (/회의|미팅|콘콜|컨콜|meeting/i.test(title)) return 'meeting';
  if (/아이데이션|ideation|concept/i.test(title)) return 'ideation';
  if (/보고|제안|proposal|report/i.test(title)) return 'report';
  return 'record';
}

/** Preserve document stages within each project and interleave projects fairly. */
export async function readDirectoryMaterials(admin: SupabaseClient, projects: NotionDirectoryProject[], query: string): Promise<NotionSource[]> {
  const ids = [...new Set(projects.flatMap(p => p.pageIds.slice(0, 80)))];
  const pages = await loadPagesByIds(admin, ids);
  const terms = [...new Set((query.toLowerCase().match(/[가-힣a-z0-9]+/g) ?? [])
    .filter(isSearchToken).filter(t => !/^(자료|관련|모두|전부|전체|찾아줘)$/.test(t)))];
  const score = (p: {title:string;excerpt?:string|null}) => terms.reduce((n,t) =>
    n + (p.title.toLowerCase().includes(t) ? 3 : 0) + ((p.excerpt ?? '').toLowerCase().includes(t) ? 1 : 0), 0);
  const groups = projects.map(project => {
    const ranked = project.pageIds.flatMap(id => pages.has(id) ? [pages.get(id)!] : [])
      .sort((a,b) => score(b)-score(a) || a.title.localeCompare(b.title));
    const selected: typeof ranked = [];
    const roles = new Set<string>();
    for (const p of ranked) {
      const role = documentRole(p.title);
      if (roles.has(role)) continue;
      roles.add(role); selected.push(p);
    }
    for (const p of ranked) if (!selected.includes(p)) selected.push(p);
    return selected.slice(0,8).map((p): NotionSource => ({
      id:p.page_id, title:p.title, url:p.url || `https://notion.so/${p.page_id.replace(/-/g,'')}`,
      excerpt:p.excerpt, parent_id:p.parent_id, path_titles:p.path_titles ?? [],
      nas_path:p.nas_path, last_edited_time:p.last_edited_time,
      project_key:project.key, link_expanded:true, via_link:'project_directory', match_score:8
    }));
  });
  const result: NotionSource[] = [], seen = new Set<string>();
  for (let i=0;i<8;i++) for (const group of groups) {
    const source=group[i];
    if (source && !seen.has(source.id)) { seen.add(source.id); result.push(source); }
  }
  return result.slice(0,48);
}
