export function parseYoutubeId(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const watch = t.match(
    /(?:youtube\.com\/watch\?[^#]*v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (watch?.[1]) return watch[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  return null;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youtubeThumbUrl(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

const IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const YT_RE = /\{\{youtube:([A-Za-z0-9_-]{11})(?:\|([^}]*))?\}\}/g;

export type WikiBodyBlock =
  | { type: "md"; text: string }
  | { type: "image"; url: string; caption: string }
  | { type: "youtube"; id: string; title: string };

/** 본문을 문단·이미지·유튜브 블록으로 나눈다. 위치는 body 문자열 순서를 따른다. */
export function parseWikiBody(body: string): WikiBodyBlock[] {
  const src = body.replace(/\r\n/g, "\n");
  if (!src.trim()) return [];
  const hits: Array<{ start: number; end: number; block: WikiBodyBlock }> = [];
  let m: RegExpExecArray | null;
  const imageRe = new RegExp(IMAGE_RE.source, "g");
  while ((m = imageRe.exec(src))) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      block: { type: "image", url: m[2]!, caption: m[1] ?? "" }
    });
  }
  const ytRe = new RegExp(YT_RE.source, "g");
  while ((m = ytRe.exec(src))) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      block: { type: "youtube", id: m[1]!, title: (m[2] ?? "").trim() }
    });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: WikiBodyBlock[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue;
    const before = src.slice(cursor, hit.start);
    if (before) out.push({ type: "md", text: before });
    out.push(hit.block);
    cursor = hit.end;
  }
  const rest = src.slice(cursor);
  if (rest) out.push({ type: "md", text: rest });
  return out;
}

export function wikiImageToken(url: string, caption: string): string {
  const cap = caption.replace(/]/g, "").trim();
  return `![${cap}](${url})`;
}

export function wikiYoutubeToken(id: string, title: string): string {
  const t = title.replace(/}/g, "").trim();
  return t ? `{{youtube:${id}|${t}}}` : `{{youtube:${id}}}`;
}

export function isExternalHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}
