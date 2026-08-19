/** 위키 매칭과 같이 공백 제거 + 소문자. 표시 원문은 건드리지 않는다. */
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

export type HighlightNeedle = {
  termId: string;
  compact: string;
  length: number;
};

export type HighlightSpan = {
  start: number;
  end: number;
  termId: string;
};

function compactIndexMap(text: string): { compact: string; map: number[] } {
  let compact = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    compact += ch.toLowerCase();
    map.push(i);
  }
  return { compact, map };
}

export function buildHighlightNeedles(terms: GlossaryHighlightTerm[]): HighlightNeedle[] {
  const needles: HighlightNeedle[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const parts = [term.term_ko, term.term_en, ...(term.synonyms ?? [])];
    for (const part of parts) {
      const raw = (part ?? "").trim();
      const compact = compactKey(raw);
      if (compact.length < 2) continue;
      const key = `${term.id}:${compact}`;
      if (seen.has(key)) continue;
      seen.add(key);
      needles.push({ termId: term.id, compact, length: compact.length });
    }
  }
  needles.sort((a, b) => b.length - a.length || a.compact.localeCompare(b.compact));
  return needles;
}

const SENTENCE_RE = /[^.!?。？！\n]+(?:[.!?。？！\n]+|$)/g;

export function findTermSpans(text: string, needles: HighlightNeedle[]): HighlightSpan[] {
  if (!text || needles.length === 0) return [];
  const spans: HighlightSpan[] = [];
  const chunks = text.match(SENTENCE_RE);
  if (!chunks) {
    return findTermSpansInChunk(text, 0, needles);
  }
  let offset = 0;
  for (const chunk of chunks) {
    const at = text.indexOf(chunk, offset);
    const start = at < 0 ? offset : at;
    spans.push(...findTermSpansInChunk(chunk, start, needles));
    offset = start + chunk.length;
  }
  return spans.sort((a, b) => a.start - b.start);
}

function findTermSpansInChunk(
  chunk: string,
  base: number,
  needles: HighlightNeedle[]
): HighlightSpan[] {
  const { compact, map } = compactIndexMap(chunk);
  if (!compact) return [];
  const occupied = new Uint8Array(compact.length);
  const used = new Set<string>();
  const spans: HighlightSpan[] = [];

  for (const needle of needles) {
    if (used.has(needle.termId)) continue;
    if (needle.length > compact.length) continue;
    let from = 0;
    while (from <= compact.length - needle.length) {
      const at = compact.indexOf(needle.compact, from);
      if (at < 0) break;
      let free = true;
      for (let i = 0; i < needle.length; i += 1) {
        if (occupied[at + i]) {
          free = false;
          break;
        }
      }
      if (free) {
        const origStart = map[at];
        const origEnd = map[at + needle.length - 1];
        if (origStart == null || origEnd == null) break;
        spans.push({
          start: base + origStart,
          end: base + origEnd + 1,
          termId: needle.termId
        });
        used.add(needle.termId);
        occupied.fill(1, at, at + needle.length);
        break;
      }
      from = at + 1;
    }
  }
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
