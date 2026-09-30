import { conflictsWithSeason, groundedSeasonSources, matchesSeasonSubject, requestedSeason } from '@/lib/luna/season-scope';
import { broadProjectSubject, underNasPath, projectPathRoot, sameDrive } from '@/lib/luna/nas-priority';
import type { LunaCard } from "@/lib/luna/tavily";
import type { NotionSource } from "@/lib/luna/notion";
import type { AskedWhat } from "@/lib/luna/ask-what";

const compact = (text: string) => text.toLowerCase().replace(/\s+/g, '');
const pathText = (text: string) => text.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();

/** Keep the year and complete project folder: an extension is a different scope. */
function projectRoot(path: string): string | null {
  const match = pathText(path).match(/(?:^|\/)((?:\d+\s+)?(?:project|사업개발)\/\d{4}\/[^/]+)/i);
  return match ? compact(match[1]!) : null;
}

/** A single requested subject needs literal evidence or a source-backed project path.
 * Known project/date queries retain their existing stricter AskedWhat filter.
 * Source titles, not incidental mentions inside reference text, can establish roots.
 */
export function scopeMediaToEvidence(cards: LunaCard[], question: string, sources: NotionSource[], asked?: AskedWhat): LunaCard[] {
  const season = requestedSeason(question);
  if (season !== null) {
    const subject = broadProjectSubject(question) ?? question.replace(/(?:전체|자료|문서|파일|이미지|사진|찾아\s*줘|보여\s*줘)[.!?]*/g, '').trim();
    const roots = groundedSeasonSources(subject, sources).flatMap(s => [...(s.paths ?? []), ...(s.nas_path ? [s.nas_path] : [])])
      .map(path => ({ root: projectPathRoot(path), drive: path.match(/^([a-z]):/i)?.[1] }));
    return cards.filter(card => {
      if (card.type !== 'image') return true;
      const identity = [card.title, card.raw_path, card.project].filter(Boolean).join(' ');
      if (conflictsWithSeason(identity, season)) return false;
      return matchesSeasonSubject(identity, subject) || Boolean(card.raw_path && roots.some(r => r.root &&
        sameDrive(card.drive ?? card.raw_path?.match(/^([a-z]):/i)?.[1], r.drive) && underNasPath(card.raw_path!, r.root)));
    });
  }
  if (asked?.projectPhrases.length) return cards;
  // The internal clarification suffix adds constraints without erasing the subject.
  const rootQuestion = question.trim().split(/\r?\n조건:/, 1)[0]!;
  // Quantity words can precede or follow the material noun. A bare subject is
  // also a search request; neither form may disable the evidence boundary.
  const subjectPhrase = rootQuestion.replace(/(?:찾아|보여|검색해)\s*(?:줘|주세요)[.!?]*$/i, '').trim().replace(/[.!?]+$/, '');
  const match = subjectPhrase.match(/^([가-힣A-Za-z0-9_-]{2,30})(?:\s+(?:전체|모든|전부|모두|주요|핵심|자료|문서|파일|이미지|사진|관련))*$/i);
  const subject = match?.[1];
  if (!subject || /^(?:전체|모든|전부|모두|주요|핵심|관련|자료|문서|파일|이미지|사진)$/.test(subject)) return cards;
  const roots = sources.filter(s => compact(s.title).includes(compact(subject)))
    .flatMap(s => [...(s.paths ?? []), ...(s.nas_path ? [s.nas_path] : [])])
    .map(path => ({root: projectRoot(path), drive: path.match(/^([a-z]):/i)?.[1]?.toUpperCase()}))
    .filter(p => Boolean(p.root));
  return cards.filter(card => {
    if (card.type !== 'image') return true;
    if (roots.length) {
      const root = projectRoot(card.raw_path ?? '');
      const drive = (card.drive ?? card.raw_path?.match(/^([a-z]):/i)?.[1] ?? '').replace(':', '').toUpperCase();
      return Boolean(root && roots.some(p => p.root === root && (!p.drive || p.drive === drive)));
    }
    return compact([card.title, card.description, card.image_description, card.raw_path].filter(Boolean).join(' ')).includes(compact(subject));
  });
}
