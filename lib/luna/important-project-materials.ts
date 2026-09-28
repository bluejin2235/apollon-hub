import { conflictsWithSeason, groundedSeasonSources, matchesSeasonSubject, requestedSeason } from '@/lib/luna/season-scope';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotionSource } from '@/lib/luna/notion';
import type { LunaCard } from '@/lib/luna/tavily';
import { dedupeDocumentVariants } from '@/lib/luna/workserver';
import { broadProjectSubject, buildPriorityProfile, diversePriorityFiles, documentRole, nasPriority, normalizeNasPath, projectPathRoot, ROLE_LABELS, sameDrive, underNasPath, type NasMark, type PriorityRow } from '@/lib/luna/nas-priority';

const compact = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => '\\' + c);
const DOCUMENT_FILTER = ['pdf','pptx','ppt','docx','doc','hwp','hwpx'].map(ext => `path.ilike.%.${ext}`).join(',');
export async function loadNasPriorityMarks(admin: SupabaseClient): Promise<NasMark[]> {
  const { data, error } = await admin.from('nas_important_paths').select('drive,path,note').limit(2000);
  if (error) throw error;
  return (data ?? []) as NasMark[];
}
export function groundedProjectRoots(query: string, sources: NotionSource[], marks: NasMark[]) {
  const subject = broadProjectSubject(query);
  if (!subject) return [];
  const roots: Array<{ drive: string; path: string }> = [];
  const season = requestedSeason(subject);
  const scoped = season === null ? sources.filter(s => compact(s.title).includes(compact(subject))) : groundedSeasonSources(subject, sources);
  for (const source of scoped) {
    for (const path of [...(source.paths ?? []), ...(source.nas_path ? [source.nas_path] : [])]) {
      const root = projectPathRoot(path), drive = path.match(/^([a-z]):/i)?.[1]?.toUpperCase();
      if (root && drive && (season === null || !conflictsWithSeason(root, season))) roots.push({ drive, path: root });
    }
  }
  for (const mark of marks) {
    const root = projectPathRoot(mark.path);
    if (root && matchesSeasonSubject(root.split(/[/\\]+/).pop()!, subject)) roots.push({ drive: mark.drive, path: root });
  }
  // Prefer the actual stored separator representation for bounded DB prefix queries.
  return [...new Map(roots.map(root => {
    const stored = marks.find(m => sameDrive(m.drive, root.drive) && normalizeNasPath(projectPathRoot(m.path) ?? '') === normalizeNasPath(root.path));
    const path = stored ? projectPathRoot(stored.path)! : root.path;
    return [root.drive + ':' + normalizeNasPath(path), { ...root, path }];
  })).values()].slice(0, 3);
}
type FileRow = PriorityRow & { type: string; size_bytes: number | null; file_summary: string | null; modified_at: string | null; drive: string };
export type ImportantProjectMaterials = { cards: LunaCard[]; sources: NotionSource[]; rows: FileRow[]; prompt: string; trace: Record<string, unknown> };
/** A file-finding request needs a grounded inventory, not another generated essay. */
export function importantMaterialsAnswer(query: string, materials: ImportantProjectMaterials | null): string | null {
  const subject = broadProjectSubject(query);
  if (!subject || !materials?.cards.length || !materials.prompt) return null;
  const escapeText = (text: string) => text.replace(/[\\`*_{}\[\]<>]/g, '\\$&').replace(/[\r\n]+/g, ' ');
  const lines = materials.cards.map(card => {
    const role = documentRole(card.raw_path ?? card.title);
    const marked = card.description?.startsWith('★') ? '★ ' : '';
    return `- **${ROLE_LABELS[role]}** — ${marked}${escapeText(card.title)}`;
  });
  return `${escapeText(subject)}의 우선 자료 **${materials.cards.length}개**를 찾았습니다. 중요 표시와 자료 유형을 기준으로 골랐습니다.\n\n` +
    lines.join('\n') +
    `\n\n아래 **Work서버 카드에서 폴더 경로를 복사**할 수 있습니다. 관련 노션 문서 ${materials.sources.length}개도 함께 제공합니다. 접힌 자료는 ‘나머지 보기’로 펼칠 수 있습니다.\n\n` +
    `★ 중요 표시가 있는 폴더·파일입니다. 파일명과 경로 기준으로 분류했으며, 본문·최종 승인 여부는 별도 확인이 필요합니다. 전체 전수 목록이 아닌 우선 자료입니다.` +
    (materials.trace.truncated ? ' 조회 한도에 도달해 추가 자료가 남아 있을 수 있습니다.' : '');
}
export async function retrieveImportantProjectMaterials(admin: SupabaseClient, query: string, sources: NotionSource[]): Promise<ImportantProjectMaterials> {
  const empty = { cards: [], sources: [], rows: [], prompt: '', trace: {} };
  if (!broadProjectSubject(query)) return empty;
  const subject = broadProjectSubject(query)!;
  const season = requestedSeason(subject);
  if (season !== null) sources = groundedSeasonSources(subject, sources);
  const marks = await loadNasPriorityMarks(admin);
  const roots = groundedProjectRoots(query, sources, marks);
  if (!roots.length) return empty;
  const profile = buildPriorityProfile(marks);
  const results = await Promise.all(roots.map(async root => {
    const label = root.path.split(/[/\\]+/).pop()!.replace(/^\d+[\s._-]+/, '');
    const rootSource = sources.find(s => s.parent_id && [...(s.paths ?? []), ...(s.nas_path ? [s.nas_path] : [])]
      .some(path => sameDrive(path.match(/^([a-z]):/i)?.[1], root.drive) && underNasPath(path, root.path)));
    const seasonAnchor = season === null ? undefined : sources.find(s => matchesSeasonSubject(s.title, subject) &&
      [...(s.paths ?? []), ...(s.nas_path ? [s.nas_path] : [])].some(path => sameDrive(path.match(/^([a-z]):/i)?.[1], root.drive) && underNasPath(path, root.path)));
    const parentId = seasonAnchor?.id ?? rootSource?.parent_id;
    let pageQuery = admin.from('luna_notion_pages').select('page_id,title,url,nas_path,last_edited_time,parent_id')
      .eq('archived', false);
    pageQuery = parentId ? pageQuery.eq('parent_id', parentId)
      : pageQuery.ilike('title', '%' + escapeLike(label) + '%');
    const [files, pages] = await Promise.all([
      admin.from('nas_directory').select('drive,path,type,size_bytes,modified_at,file_summary,importance')
        .eq('drive', root.drive).eq('type', 'file').gte('path', root.path).lt('path', root.path + '\uffff')
        .or(DOCUMENT_FILTER)
        .order('importance', { ascending: false }).order('path').limit(1001),
      pageQuery.limit(31)
    ]);
    if (files.error) throw files.error;
    if (pages.error) throw pages.error;
    return { root, files: (files.data ?? []) as FileRow[], groundedParent: Boolean(parentId),
      pages: (pages.data ?? []).filter(p => (season === null || !conflictsWithSeason([p.title, p.nas_path].filter(Boolean).join(' '), season)) &&
        (parentId || !p.nas_path || (sameDrive(String(p.nas_path).match(/^([a-z]):/i)?.[1], root.drive) && underNasPath(p.nas_path, root.path)))) };
  }));
  // A project's proposal may live under Business Development. Expand only through
  // sibling documents in the exact source-backed Notion parent, never similar names.
  const linkedRoots = [...new Map(results.filter(r => r.groundedParent).flatMap(r => r.pages).flatMap(p => {
    const path = p.nas_path ? projectPathRoot(p.nas_path) : null;
    const drive = p.nas_path?.match(/^([a-z]):/i)?.[1]?.toUpperCase();
    return path && drive && (season === null || !conflictsWithSeason(path, season)) ? [[drive + ':' + normalizeNasPath(path), { drive, path }] as const] : [];
  })).values()].filter(linked => !roots.some(root => sameDrive(root.drive, linked.drive) && normalizeNasPath(root.path) === normalizeNasPath(linked.path))).slice(0, 3);
  const linkedFiles = await Promise.all(linkedRoots.map(async root => {
    const {data,error} = await admin.from('nas_directory').select('drive,path,type,size_bytes,modified_at,file_summary,importance')
      .eq('drive',root.drive).eq('type','file').gte('path',root.path).lt('path',root.path+'\uffff')
      .or(DOCUMENT_FILTER)
      .order('importance',{ascending:false}).order('path').limit(1001);
    if(error) throw error;
    return {root,files:(data??[]) as FileRow[]};
  }));
  const allFileResults = [...results, ...linkedFiles];
  const files = allFileResults.flatMap(r => r.files.slice(0, 1000).filter(f => underNasPath(f.path, r.root.path)))
    .filter(f => /\.(?:pptx?|pdf|docx?|hwp|hwpx)$/i.test(f.path) && !/(?:^|[/\\])(?:backup|백업|old|temp)(?:[/\\]|$)/i.test(f.path));
  const seasonFiles = season === null ? files : files.filter(f => !conflictsWithSeason(f.path, season));
  const selected = diversePriorityFiles(dedupeDocumentVariants(seasonFiles), marks, 8);
  const cards: LunaCard[] = selected.map(f => {
    const priority = nasPriority(f, marks, profile);
    return { type: 'nas', title: f.path.split(/[/\\]+/).pop()!, url: null, thumbnail: null,
      description: `${priority.manual || priority.scanner ? '★ ' : ''}${ROLE_LABELS[priority.role]} · ${priority.reason} · 파일 목록 확인(본문·승인 여부 미검증)`,
      drive: f.drive, raw_path: f.path, is_file: true };
  });
  const pageMap = new Map(results.flatMap(r => r.pages.slice(0, 30)).map(p => [String(p.page_id), p]));
  const projectSources: NotionSource[] = [...pageMap.values()].filter(p => p.url).map(p => ({
    id: String(p.page_id), title: String(p.title), url: String(p.url), nas_path: p.nas_path, parent_id: p.parent_id,
    last_edited_time: p.last_edited_time, excerpt: '프로젝트 문서 목록에서 확인. 이 조회에서는 본문과 최종 승인 여부를 검증하지 않음.',
    match_score: 1, keyword_score: 0
  }));
  if (season !== null) {
    for (const anchor of sources.filter(s => matchesSeasonSubject(s.title, subject))) {
      if (!projectSources.some(s => s.id === anchor.id)) projectSources.push(anchor);
    }
  }
  projectSources.sort((a, b) => {
    const roles = ['proposal', 'concept', 'design', 'report', 'planning', 'operations', 'review', 'other', 'reference'];
    return roles.indexOf(documentRole(a.title)) - roles.indexOf(documentRole(b.title));
  });
  const prompt = `[중요 프로젝트 자료 — 이번 전체 자료 요청의 우선 목록]\n` +
    `등록 중요 폴더와 스캔 중요 표시를 먼저 반영했다. 추정 유형은 직접 중요 표시와 구별한다.\n` +
    `소개문·운영 매뉴얼만으로 답하지 말고 아래에 실제 존재하는 제안→컨셉→디자인→주요 보고→수행계획→운영 자료를 유형별로 먼저 안내한다. 없는 유형은 없다고 단정하지 말고 이번 후보에서 미확인으로 짧게 표시한다.\n` +
    `파일명·경로/링크는 검증된 목록이다. 본문을 읽었다고 하거나 내용·최종 승인을 추정하지 않는다. 날짜/최종이라는 파일명은 승인 증거가 아니다. 범위를 넓힐지 다시 묻지 않는다. 전체 목록 완주가 아닌 우선 자료 ${cards.length}개와 문서 링크 ${projectSources.length}개임을 밝힌다.\n` +
    cards.map(c => `- ${c.description}: ${c.title} — ${c.drive}:\\${c.raw_path}`).join('\n') + '\n' +
    projectSources.map(s => `- [${ROLE_LABELS[documentRole(s.title)]}] ${s.title} — ${s.url}`).join('\n');
  return { cards, sources: projectSources, rows: selected, prompt, trace: { profile, roots, linked_roots: linkedRoots, candidate_files: files.length,
    selected_files: selected.map(f => ({ path: f.path, drive: f.drive, ...nasPriority(f, marks, profile) })),
    truncated: allFileResults.some(r => r.files.length >= 1000) || results.some(r => r.pages.length > 30), metadata_only: true } };
}
