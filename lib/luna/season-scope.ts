import type { NotionSource } from '@/lib/luna/notion';
import { projectPathRoot, normalizeNasPath } from '@/lib/luna/nas-priority';

const seasonPattern = () => /(?:시즌\s*|\bseason[\s_-]*|\bs[\s_-]*)(\d{1,2})(?!\d)/gi;
const compact = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, '');
const idKey = (id?: string | null) => (id ?? '').replace(/-/g, '').toLowerCase();
export function seasonsIn(text: string): number[] {
  return [...new Set([...text.matchAll(seasonPattern())].map(m => Number(m[1])))];
}
/** Multi-season comparison questions must keep their broader scope. */
export function requestedSeason(query: string): number | null {
  const seasons = seasonsIn(query);
  return seasons.length === 1 ? seasons[0]! : null;
}
export function conflictsWithSeason(text: string, season: number): boolean {
  return seasonsIn(text).some(n => n !== season);
}
export function matchesSeasonSubject(text: string, subject: string): boolean {
  const season = requestedSeason(subject);
  if (season === null) return compact(text).includes(compact(subject));
  const name = compact(subject.replace(seasonPattern(), ''));
  return name.length >= 2 && compact(text).includes(name) &&
    seasonsIn(text).includes(season) && !conflictsWithSeason(text, season);
}
const sourcePaths = (s: NotionSource) => [...(s.paths ?? []), ...(s.nas_path ? [s.nas_path] : [])];
function pathKey(path: string): string | null {
  const root = projectPathRoot(path), drive = path.match(/^([a-z]):/i)?.[1]?.toUpperCase();
  return root && drive ? drive + ':' + normalizeNasPath(root) : null;
}
/** Seasonless documents inherit scope only through an exact project parent or root.
 * Incidental body mentions and dates cannot establish season ownership.
 */
export function groundedSeasonSources(subject: string, sources: NotionSource[]): NotionSource[] {
  const season = requestedSeason(subject);
  if (season === null) return sources;
  const clean = sources.filter(s => !conflictsWithSeason([s.title, ...sourcePaths(s)].join('\n'), season));
  const anchors = clean.filter(s => matchesSeasonSubject(s.title, subject));
  const allowedIds = new Set(anchors.map(s => idKey(s.id)));
  // Bound propagation to the returned source set; archive siblings never inherit.
  for (let i = 0; i < clean.length; i++) {
    let added = false;
    for (const s of clean) {
      if (s.parent_id && allowedIds.has(idKey(s.parent_id)) && !allowedIds.has(idKey(s.id))) {
        allowedIds.add(idKey(s.id)); added = true;
      }
    }
    if (!added) break;
  }
  const roots = new Set(clean.filter(s => allowedIds.has(idKey(s.id))).flatMap(sourcePaths).map(pathKey).filter(Boolean));
  return clean.filter(s => allowedIds.has(idKey(s.id)) || sourcePaths(s).some(path => roots.has(pathKey(path))));
}
