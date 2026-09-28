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
  if (asked?.projectPhrases.length) return cards;
  const match = question.trim().match(/^([가-힣A-Za-z0-9]{2,30})(?:\s+(?:전체|모든|전부|자료|문서|파일|이미지|사진|관련))*\s*(?:찾아\s*줘|보여\s*줘|찾아\s*주세요|보여\s*주세요)[.!?]*$/i);
  const subject = match?.[1];
  if (!subject || /^(?:전체|전부|모두|자료|문서|파일|이미지|사진)$/.test(subject)) return cards;
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
