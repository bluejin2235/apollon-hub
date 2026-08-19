/** 위키 제목·절 제목 등 짧은 대상 매칭용. 본문 하이라이트에는 쓰지 않는다. */
export function compactKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

export type GlossaryHighlightTerm = {
  id: string;
  term_ko: string | null;
  term_en: string | null;
  term_zh: string | null;
  categories: string[];
  synonyms: string[];
  definition: string | null;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
};

/** pattern 은 본문 원문에서 그대로 찾는 후보(대소문자 무시). */
export type HighlightNeedle = {
  termId: string;
  pattern: string;
  length: number;
};

export type HighlightSpan = {
  start: number;
  end: number;
  termId: string;
};

const HANGUL_RE = /[가-힣]/;
const ALNUM_RE = /[A-Za-z0-9]/;
/** 긴 조사 우선 */
const PARTICLES = [
  "에서",
  "으로",
  "부터",
  "까지",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "로",
  "와",
  "과",
  "도",
  "만"
] as const;

function isHangul(ch: string): boolean {
  return HANGUL_RE.test(ch);
}

function isAlnum(ch: string): boolean {
  return ALNUM_RE.test(ch);
}

function isBoundaryMark(ch: string): boolean {
  if (!ch) return true;
  if (ch === "\u200b") return true;
  if (/\s/.test(ch)) return true;
  // 문장부호·괄호·따옴표 등 (한글·영숫자 제외)
  return !isHangul(ch) && !isAlnum(ch);
}

function startsWithParticle(rest: string): boolean {
  for (const p of PARTICLES) {
    if (rest.startsWith(p)) return true;
  }
  return false;
}

/** 매칭 구간이 단어 경계인지. */
export function isTermBoundary(text: string, start: number, end: number): boolean {
  if (start < 0 || end > text.length || start >= end) return false;
  const before = start > 0 ? text[start - 1]! : "";
  const after = end < text.length ? text[end]! : "";
  const rest = text.slice(end);

  if (before && isAlnum(before)) return false;
  if (after && isAlnum(after)) return false;

  if (before && isHangul(before)) return false;

  if (after && isHangul(after) && !startsWithParticle(rest)) return false;

  return true;
}

/** 2글자 용어: 앞뒤가 공백·부호·문장 끝/시작(또는 뒤 조사)일 때만. */
export function isShortTermBoundary(text: string, start: number, end: number): boolean {
  if (!isTermBoundary(text, start, end)) return false;
  const before = start > 0 ? text[start - 1]! : "";
  const after = end < text.length ? text[end]! : "";
  const rest = text.slice(end);
  if (before && !isBoundaryMark(before)) return false;
  if (after && !isBoundaryMark(after) && !startsWithParticle(rest)) return false;
  return true;
}

function patternCharLen(pattern: string): number {
  return pattern.replace(/\s+/g, "").length;
}

export function hasDefinition(term: { definition?: string | null }): boolean {
  return Boolean((term.definition ?? "").trim());
}

function needleVariants(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const out: string[] = [trimmed];
  const nospace = trimmed.replace(/\s+/g, "");
  if (nospace !== trimmed) out.push(nospace);
  return out;
}

export function buildHighlightNeedles(terms: GlossaryHighlightTerm[]): HighlightNeedle[] {
  const needles: HighlightNeedle[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    if (!hasDefinition(term)) continue;
    const parts = [term.term_ko, term.term_en, ...(term.synonyms ?? [])];
    for (const part of parts) {
      for (const pattern of needleVariants(part ?? "")) {
        if (patternCharLen(pattern) < 2) continue;
        const key = `${term.id}:${pattern.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        needles.push({
          termId: term.id,
          pattern,
          length: pattern.length
        });
      }
    }
  }
  needles.sort(
    (a, b) => b.length - a.length || a.pattern.localeCompare(b.pattern)
  );
  return needles;
}

export function isSourceLine(line: string): boolean {
  return /^\s*출처\s*[:：]/.test(line);
}

export function isSourceBlock(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isSourceLine(t)) return true;
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(isSourceLine);
}

function indexOfIgnoreCase(haystack: string, needle: string, from: number): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/** 렌더 단위 전체에서 용어당 첫 번째만. alreadyUsed 는 앞 노드에서 이미 표시한 용어. */
export function findTermSpans(
  text: string,
  needles: HighlightNeedle[],
  alreadyUsed?: ReadonlySet<string>
): HighlightSpan[] {
  if (!text || needles.length === 0) return [];
  return findTermSpansInChunk(text, 0, needles, alreadyUsed);
}

function rangeFree(occupied: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (occupied[i]) return false;
  }
  return true;
}

function firstValidMatch(
  chunk: string,
  pattern: string,
  occupied: Uint8Array
): { start: number; end: number } | null {
  if (pattern.length > chunk.length) return null;
  const short = patternCharLen(pattern) <= 2;
  let from = 0;
  while (from <= chunk.length - pattern.length) {
    const at = indexOfIgnoreCase(chunk, pattern, from);
    if (at < 0) return null;
    const end = at + pattern.length;
    const boundaryOk = short
      ? isShortTermBoundary(chunk, at, end)
      : isTermBoundary(chunk, at, end);
    if (boundaryOk && rangeFree(occupied, at, end)) {
      return { start: at, end };
    }
    from = at + 1;
  }
  return null;
}

function findTermSpansInChunk(
  chunk: string,
  base: number,
  needles: HighlightNeedle[],
  alreadyUsed?: ReadonlySet<string>
): HighlightSpan[] {
  const occupied = new Uint8Array(chunk.length);
  const used = new Set<string>(alreadyUsed);
  const spans: HighlightSpan[] = [];

  // 용어별 후보(공백/붙여쓰기)를 묶고, 본문에서 가장 앞선 매칭을 고른다.
  const byTerm = new Map<string, HighlightNeedle[]>();
  const termOrder: string[] = [];
  for (const needle of needles) {
    const list = byTerm.get(needle.termId);
    if (!list) {
      byTerm.set(needle.termId, [needle]);
      termOrder.push(needle.termId);
    } else {
      list.push(needle);
    }
  }
  // needles 는 이미 최장패턴 순 → termOrder 도 최장 용어 우선

  for (const termId of termOrder) {
    if (used.has(termId)) continue;
    const list = byTerm.get(termId);
    if (!list) continue;
    let best: { start: number; end: number } | null = null;
    for (const needle of list) {
      const hit = firstValidMatch(chunk, needle.pattern, occupied);
      if (!hit) continue;
      if (!best || hit.start < best.start || (hit.start === best.start && hit.end > best.end)) {
        best = hit;
      }
    }
    if (!best) continue;
    spans.push({
      start: base + best.start,
      end: base + best.end,
      termId
    });
    used.add(termId);
    occupied.fill(1, best.start, best.end);
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return spans;
}

/** CJK·따옴표 옆 ** 가 CommonMark에서 무시되는 것을 보정 */
export function prepareMarkdownEmphasis(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, (full, inner: string, offset: number) => {
    const after = text[offset + full.length] ?? "";
    const last = inner[inner.length - 1] ?? "";
    const prefix = /[」』"'”’)\]}>.,!?]/.test(last) ? "\u200b" : "";
    const suffix = /[\w가-힣]/.test(after) ? "\u200b" : "";
    return `**${inner}${prefix}**${suffix}`;
  });
}
