/** Reserve bounded room for lexical evidence at every truncation boundary. */
export function selectEvidence<T>(items: T[], limit: number, score: (item: T) => number, lexical: (item: T) => number): T[] {
  const n = Math.max(0, Math.floor(limit));
  const ranked = [...items].sort((a, b) => score(b) - score(a));
  const exact = ranked.filter((item) => lexical(item) > 0).slice(0, Math.ceil(n / 2));
  const picked = new Set(exact);
  return [...exact, ...ranked.filter((item) => !picked.has(item))].slice(0, n);
}

/** Retain the matching passage instead of an unrelated beginning of a long chunk. */
export function queryExcerpt(text: string, keywords: string[], limit = 1200): string {
  const body = text.replace(/\s+/g, " ").trim();
  const lower = body.toLowerCase();
  const positions = keywords.filter((k) => k.length >= 2).map((k) => lower.indexOf(k.toLowerCase())).filter((p) => p >= 0);
  const hit = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, hit - 160);
  return `${start ? "…" : ""}${body.slice(start, start + limit)}${body.length > start + limit ? "…" : ""}`;
}
