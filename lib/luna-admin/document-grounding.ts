import { createHash } from 'node:crypto';
import type { PrimaryNasSnapshot, PrimaryMarkSnapshot } from '@/lib/luna-admin/secondary-document-profile';
import { normalizeNasPath, sameDrive, underNasPath } from '@/lib/luna/nas-priority';
import { classifyDocumentRole, DOCUMENT_ROLE_RULE_VERSION } from '@/lib/luna/document-role';
import { seasonsIn } from '@/lib/luna/season-scope';

export const GROUNDING_NAMESPACE = 'secondary_document_grounding_v1';
export const GROUNDING_RULE_VERSION = 'document-grounding/1';
type TextSnapshot = { path: string; drive: string; status: string; size_bytes: number | null;
  modified_at: string | null; content_hash: string | null; chunk_count: number; text_length: number;
  extracted_at: string | null; updated_at: string | null };
type Chunk = { id: string; path: string; seq: number; content: string; created_at: string };
type NotionPage = { page_id: string; title: string; parent_id: string | null; parent_type: string;
  nas_path: string | null; archived: boolean; last_edited_time: string | null; scan_batch: string | null };
export type GroundingInput = { primary: PrimaryNasSnapshot; text: TextSnapshot | null; chunks: Chunk[];
  path_owner_count: number; marks: PrimaryMarkSnapshot[]; notion: NotionPage[] };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const idKey = (id: string) => id.replace(/-/g, '').toLowerCase();
const titleKey = (title: string) => title.replace(/\.(pdf|pptx?|docx?|hwp|xlsx?)$/i, '').replace(/[\s_]+/g, '').toLowerCase();
const sameTime = (a: string | null, b: string | null) => Boolean(a && b && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
function pathMatch(source: PrimaryNasSnapshot, path: string | null) {
  const drive = path?.match(/^([a-z]):[/\\]/i)?.[1];
  return Boolean(drive && sameDrive(source.drive, drive) && underNasPath(source.path, path!));
}
function selectedNotion(source: PrimaryNasSnapshot, pages: NotionPage[]) {
  const map = new Map<string, NotionPage>();
  for (const page of pages) {
    if (!page.page_id || map.has(idKey(page.page_id))) throw new Error('Duplicate/missing Notion identity');
    map.set(idKey(page.page_id), page);
  }
  const matches = pages.filter(p => !p.archived && p.last_edited_time && p.scan_batch && pathMatch(source, p.nas_path));
  const deepest = Math.max(0, ...matches.map(p => normalizeNasPath(p.nas_path!).length));
  const leaf = source.path.split(/[/\\]+/).pop() ?? '';
  const deepestPages = matches.filter(p => normalizeNasPath(p.nas_path!).length === deepest);
  // Shared folders establish association, not equality of every file and page.
  const exactTitles = deepestPages.filter(p => titleKey(p.title) === titleKey(leaf));
  const selected = exactTitles.length ? exactTitles : deepestPages;
  return selected.map(page => {
    const chain: NotionPage[] = [page], seen = new Set([idKey(page.page_id)]);
    let cycle = false;
    for (let hop = 0; hop < pages.length; hop++) {
      const current = chain[chain.length - 1]!;
      if (current.parent_type !== 'page_id' || !current.parent_id) break;
      const key = idKey(current.parent_id), parent = map.get(key);
      if (seen.has(key)) { cycle = true; break; }
      if (!parent || parent.archived || !parent.last_edited_time || !parent.scan_batch) break;
      chain.push(parent); seen.add(key);
    }
    return { association: titleKey(page.title) === titleKey(leaf) ? 'title-and-path' : 'folder-only', cycle,
      chain: chain.map(p => ({ page_id: p.page_id, title: p.title, parent_id: p.parent_id, parent_type: p.parent_type,
        nas_path: p.nas_path, archived: p.archived, last_edited_time: p.last_edited_time, scan_batch: p.scan_batch })) };
  });
}
function textCoverage(chunks: Chunk[], complete: boolean) {
  // Extraction page delimiters are diagnostics, never a claim to read page images.
  const pageText = new Map<number, string>(); let total = 0;
  for (const chunk of chunks) {
    let start = 0;
    for (const match of chunk.content.matchAll(/--\s*(\d+)\s+of\s+(\d+)\s*--/g)) {
      const page = Number(match[1]); total = Math.max(total, Number(match[2]));
      const text = chunk.content.slice(start, match.index).replace(/https?:\/\/\S+|www\.\S+|\S+@\S+|T\s*H\s*A\s*N\s*K\s*Y\s*O\s*U/gi, '').replace(/[^\p{L}\p{N}]/gu, '');
      if (text.length > (pageText.get(page)?.length ?? 0)) pageText.set(page, text);
      start = match.index! + match[0].length;
    }
  }
  const meaningful = [...pageText.values()].filter(t => t.length >= 20).length;
  return { page_count: total || null, pages_with_text: meaningful,
    state: !complete ? 'partial-chunks' : total >= 3 && meaningful / total < 0.3 ? 'sparse-page-text' : 'not-assessed',
    threshold: { minimum_page_characters: 20, sparse_ratio: 0.3 }, images_reviewed: false };
}
function primarySnapshot(p: PrimaryNasSnapshot) {
  return { id: String(p.id), drive: p.drive, path: p.path, type: p.type, size_bytes: p.size_bytes,
    modified_at: p.modified_at, scan_batch: p.scan_batch, importance: p.importance, marked_reason: p.marked_reason };
}
function derive(input: GroundingInput) {
  const source = primarySnapshot(input.primary), t = input.text;
  if (!source.id || !source.scan_batch || !/^[a-z]:?$/i.test(source.drive) || source.type !== 'file') throw new Error('Incomplete primary evidence');
  const chunks = [...input.chunks].sort((a, b) => a.seq - b.seq);
  const unique = new Set(chunks.map(c => c.id)).size === chunks.length && new Set(chunks.map(c => c.seq)).size === chunks.length;
  const complete = Boolean(t && unique && chunks.length === t.chunk_count && chunks.length > 0 && chunks.every((c, i) => c.seq === i && c.path === t.path));
  const currentText = Boolean(t && t.status === 'ok' && t.content_hash && t.extracted_at && input.path_owner_count === 1 &&
    sameDrive(source.drive, t.drive) && normalizeNasPath(source.path) === normalizeNasPath(t.path) && source.size_bytes !== null &&
    source.size_bytes === t.size_bytes && sameTime(source.modified_at, t.modified_at));
  const marks = input.marks.filter(m => sameDrive(source.drive, m.drive) && underNasPath(source.path, m.path))
    .map(m => ({ id: String(m.id), drive: m.drive, path: m.path, note: m.note, created_at: m.created_at })).sort((a, b) => a.id.localeCompare(b.id));
  const notion = selectedNotion(input.primary, input.notion).sort((a,b) => a.chain[0]!.page_id.localeCompare(b.chain[0]!.page_id));
  const hasCycle = notion.some(n => n.cycle);
  const labels = [...new Set([...seasonsIn(source.path), ...notion.flatMap(n => n.chain.flatMap(p => seasonsIn(p.title)))])];
  const first = chunks[0];
  const titleExcerpt = first?.content.split(/--\s*1\s+of\s+\d+\s*--/)[0]?.trim().slice(0, 500) ?? '';
  // Only an explicit heading of a complete, current extraction may support role.
  // Do not classify a whole document from incidental terms deep in its text.
  const headingRole = /제안서|제안(?:\s|$)|\bproposal\b/i.test(titleExcerpt)
    ? { role: 'proposal' as const, basis: 'filename' as const }
    : classifyDocumentRole(titleExcerpt.replace(/[/\\]/g, ' '));
  const roleSupported = currentText && complete && Boolean(first?.content.match(/--\s*1\s+of\s+\d+\s*--/)) &&
    headingRole.basis === 'filename' && headingRole.role !== 'other' && Boolean(titleExcerpt);
  const inputs = { primary: source, manual_marks: marks, notion, text: t ? { path:t.path,drive:t.drive,status:t.status,
    size_bytes:t.size_bytes,modified_at:t.modified_at,content_hash:t.content_hash,chunk_count:t.chunk_count,text_length:t.text_length,
    extracted_at:t.extracted_at,updated_at:t.updated_at } : null,
    path_owner_count: input.path_owner_count, chunks: chunks.map(c => ({id:c.id,path:c.path,seq:c.seq,created_at:c.created_at,content_sha256:hash(c.content)})) };
  return { inputs, checks: {
    manual_importance: { state: marks.length ? 'verified-path-ancestry' : 'not-marked', mark_ids: marks.map(m => m.id) },
    notion_association: { state: hasCycle ? 'conflict' : notion.length ? 'supported-path-association' : 'unavailable', canonical_project_verified: false },
    season: { state: hasCycle || labels.length > 1 ? 'conflict' : labels.length === 1 ? 'supported-label-chain' : 'unknown', value: !hasCycle && labels.length === 1 ? labels[0] : null },
    body: { state: !t ? 'unavailable' : !currentText ? 'stale-or-ambiguous' : !complete ? 'incomplete' : 'current-extraction',
      coverage: textCoverage(chunks, complete), full_document_verified: false },
    document_role: { state: roleSupported ? 'supported-heading' : 'insufficient-body-evidence', value: roleSupported ? headingRole.role : null,
      evidence: roleSupported ? { chunk_id: first!.id, excerpt: titleExcerpt, scope: 'first-page-heading' } : null },
  } };
}
export function buildDocumentGrounding(input: GroundingInput, generatorCommit: string, generatedAt: string) {
  if (!/^[a-f0-9]{40}$/.test(generatorCommit) || !Number.isFinite(Date.parse(generatedAt))) throw new Error('Missing generator provenance');
  const payload = { layer:2 as const, schema_version:1, policy:{ grounding:GROUNDING_RULE_VERSION,role:DOCUMENT_ROLE_RULE_VERSION },
    generator_commit:generatorCommit, ...derive(input), review_state:'candidate' as const };
  return {...payload, revision_key:hash(payload), generated_at:generatedAt};
}
export function groundingFreshness(saved: ReturnType<typeof buildDocumentGrounding>, current: GroundingInput | null) {
  if (!current) return 'unavailable';
  if (saved.layer!==2 || saved.schema_version!==1 || saved.policy.grounding!==GROUNDING_RULE_VERSION || saved.policy.role!==DOCUMENT_ROLE_RULE_VERSION) return 'stale';
  return hash(saved.inputs) === hash(derive(current).inputs) ? 'current' : 'stale';
}
