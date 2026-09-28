/** Reserve bounded room for lexical evidence at every truncation boundary. */
export function selectEvidence<T>(items: T[], limit: number, score: (item: T) => number, lexical: (item: T) => number): T[] {
  const n = Math.max(0, Math.floor(limit));
  const ranked = [...items].sort((a, b) => score(b) - score(a));
  const exact = ranked.filter((item) => lexical(item) > 0).slice(0, Math.ceil(n / 2));
  const picked = new Set(exact);
  return [...exact, ...ranked.filter((item) => !picked.has(item))].slice(0, n);
}

/** These cues select evidence to read; they never establish who made a work. */
export function asksForProvenance(query: string): boolean {
  return /우리.*제작|자사|외부.*참고|제작.*(?:주체|회사)|제작사|누가.*(?:제작|만들)/i.test(query);
}

/** Categorising existing sources is retrieval; only explicit authoring needs a template. */
export function provenanceSearchTypes(types: string[], query: string): string[] {
  if (!asksForProvenance(query) || /(?:초안|양식|템플릿|보고서|제안서|체크리스트).*(?:작성|만들)/.test(query)) return types;
  return ['find'];
}

const provenanceCue = /(?:기획|연출|제작|개발|설계)(?:했|하였|한\s|을\s*(?:담당|총괄))|만들었|(?:produced|created|directed|designed)\s+by/i;
const referenceCue = /벤치마킹|레퍼런스|참고|reference|benchmark/i;
const topicNoise = /^(?:우리|우리가|저희|자사|외부|내부|참고자료|자료|제작|제작한|활용한|것|것과|중|나눠줘|구분|구분해줘|알려줘|찾아줘|보여줘|프로젝트|이미지|문서|누가|제작사|회사|주체)$/;

function topicTerms(terms: string[]): string[] {
  return terms.flatMap(t => t.split(/\s+/)).filter(t => !topicNoise.test(t))
    .map(t => t.length > 2 ? t.replace(/(?:에서|으로|은|는|을|를|의|와|과)$/, '') : t)
    .filter(t => t.length >= 2 && !topicNoise.test(t)).map(t => t.toLowerCase());
}

function evidenceWindows(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  const windows: string[] = [];
  for (const term of topicTerms(terms)) {
    let start = 0;
    for (let i = 0; i < 20; i++) {
      const hit = lower.indexOf(term, start);
      if (hit < 0) break;
      windows.push(text.slice(Math.max(0, hit - 240), hit + term.length + 400));
      start = hit + term.length;
    }
  }
  return windows;
}

/** Keep both production and reference evidence within the existing prompt budget. */
export function selectQuestionEvidence<T>(items: T[], limit: number, query: string, text: (item: T) => string,
  score: (item: T) => number, lexical: (item: T) => number): T[] {
  const baseline = selectEvidence(items, limit, score, lexical);
  if (!asksForProvenance(query) || limit < 1) return baseline;
  const ranked = [...items].sort((a, b) => score(b) - score(a));
  const windows = new Map(ranked.map(item => [item, evidenceWindows(text(item), query.split(/\s+/))]));
  const reserved: T[] = [];
  for (const cue of [provenanceCue, referenceCue]) {
    const item = ranked.find(item => !reserved.includes(item) && windows.get(item)?.some(w => cue.test(w)));
    if (item !== undefined) reserved.push(item);
  }
  return [...reserved, ...baseline.filter(item => !reserved.includes(item))].slice(0, Math.max(0, Math.floor(limit)));
}

/** Retain the matching passage instead of an unrelated beginning of a long chunk. */
export function queryExcerpt(text: string, keywords: string[], limit = 1200, query = ''): string {
  const body = text.replace(/\s+/g, " ").trim();
  if (asksForProvenance(query)) {
    const windows = evidenceWindows(body, keywords);
    const useful = windows.find(w => provenanceCue.test(w)) ?? windows.find(w => referenceCue.test(w));
    if (useful) return `…${useful.slice(0, limit)}…`;
  }
  const lower = body.toLowerCase();
  const positions = keywords.filter((k) => k.length >= 2).map((k) => lower.indexOf(k.toLowerCase())).filter((p) => p >= 0);
  const hit = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, hit - 160);
  return `${start ? "…" : ""}${body.slice(start, start + limit)}${body.length > start + limit ? "…" : ""}`;
}
