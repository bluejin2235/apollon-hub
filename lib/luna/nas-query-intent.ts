/** Broader coverage overrides a sufficiency shortcut, never a disabled connector. */
export function requestsNasBodyCoverage(query: string): boolean {
  return /(?:전체|모든)\s*(?:자료|문서|파일|소스|출처)|(?:자료|문서|파일)[^\n]{0,24}전부|전부\s*(?:다\s*)?(?:찾|보여|검색)|(?:NAS|나스|Work)\s*(?:의\s*)?본문|본문\s*(?:까지|도)\s*(?:찾|검색)/i.test(query);
}

/** Keep subjects ahead of request verbs; no extra model call or candidate expansion. */
export function nasBodyQueryTerms(query: string): string[] {
  const noise = /^(?:전체|모든|전부|자료|문서|파일|소스|출처|본문|까지|에서도|함께|모두|찾아줘|보여줘|알려줘|검색해줘|찾아주세요|보여주세요|검색해주세요|관련|프로젝트|NAS|나스|Work)$/i;
  return [...new Set(query.split(/[\s,/|?!。]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !noise.test(t))
    .map(t => t.length > 2 ? t.replace(/(?:에서|으로|까지|의|은|는|을|를)$/, '') : t)
    .filter(t => t.length >= 2 && !noise.test(t)))].slice(0, 8);
}
