/**
 * Hub LUNA 대화 응답 후처리 파서 (트렌드 레이더 P1 과 무관).
 */

export type ParsedNumberedChoices = {
  /** 선택지 위 본문(질문 포함) */
  body: string;
  options: string[];
  /** 기타 행 인덱스 (없으면 -1) */
  otherIndex: number;
};

const OTHER_PATTERN = /기타/;

/**
 * 응답 끝의 "1. … 2. … N. 기타" 번호 목록을 파싱.
 * 실패 시 null → 원문 그대로 표시.
 */
export function parseNumberedChoices(text: string): ParsedNumberedChoices | null {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return null;

  // 끝에서부터 연속 번호 목록 블록 찾기
  const lines = raw.split("\n");
  const optionLines: { index: number; n: number; text: string }[] = [];
  let i = lines.length - 1;

  // trailing blank
  while (i >= 0 && lines[i]!.trim() === "") i -= 1;

  while (i >= 0) {
    const line = lines[i]!.trim();
    const m = line.match(/^(\d+)[.\u3001)]\s*(.+)$/);
    if (!m) break;
    optionLines.unshift({
      index: i,
      n: Number(m[1]),
      text: m[2]!.trim()
    });
    i -= 1;
  }

  if (optionLines.length < 2) return null;

  // 번호가 1..N 순인지 (느슨: 시작이 1이고 증가)
  if (optionLines[0]!.n !== 1) return null;
  for (let k = 1; k < optionLines.length; k += 1) {
    if (optionLines[k]!.n !== optionLines[k - 1]!.n + 1) return null;
  }

  const last = optionLines[optionLines.length - 1]!;
  if (!OTHER_PATTERN.test(last.text)) return null;

  const startLine = optionLines[0]!.index;
  const body = lines.slice(0, startLine).join("\n").trim();
  const options = optionLines.map((o) => o.text);
  return {
    body,
    options,
    otherIndex: options.length - 1
  };
}

/**
 * "3" / "3." / "3번" 등 → 선택지 인덱스를 찾아 텍스트 치환.
 * 매칭 실패 시 원문 반환.
 */
export function resolveChoiceInput(
  input: string,
  options: string[]
): { kind: "option"; text: string } | { kind: "other" } | { kind: "plain"; text: string } {
  const t = input.trim();
  if (!t || options.length === 0) return { kind: "plain", text: input };

  const m = t.match(/^(\d+)\s*[.번)]?\s*$/);
  if (!m) return { kind: "plain", text: input };
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > options.length) {
    return { kind: "plain", text: input };
  }
  const opt = options[n - 1]!;
  if (OTHER_PATTERN.test(opt) && n === options.length) {
    return { kind: "other" };
  }
  return { kind: "option", text: opt };
}

export type ParsedAssume = {
  body: string;
  assumptions: string[];
};

function isAssumeColon(ch: string | undefined): boolean {
  return ch === ":" || ch === "：";
}

function skipWs(s: string, from: number): number {
  let i = from;
  while (i < s.length && (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r")) {
    i += 1;
  }
  return i;
}

/**
 * [[가정: …]] 마커를 본문에서 분리. 정규식 대신 indexOf — 번들러가 유니코드 리터럴을 깨도 동작.
 */
export function parseAssumeMarkers(text: string): ParsedAssume {
  const assumptions: string[] = [];
  const parts: string[] = [];
  const keyword = "가정";
  let i = 0;

  while (i < text.length) {
    const openAscii = text[i] === "[" && text[i + 1] === "[";
    const openFull = text[i] === "［" && text[i + 1] === "［";
    if (!openAscii && !openFull) {
      parts.push(text[i] ?? "");
      i += 1;
      continue;
    }

    const closeAscii = text.indexOf("]]", i + 2);
    const closeFull = text.indexOf("］］", i + 2);
    let close = -1;
    if (closeAscii >= 0 && closeFull >= 0) close = Math.min(closeAscii, closeFull);
    else close = closeAscii >= 0 ? closeAscii : closeFull;
    if (close < 0) {
      parts.push(text[i] ?? "");
      i += 1;
      continue;
    }

    const inner = text.slice(i + 2, close);
    const kw = inner.indexOf(keyword);
    if (kw < 0 || inner.slice(0, kw).trim() !== "") {
      parts.push(text[i] ?? "");
      i += 1;
      continue;
    }

    const afterKw = skipWs(inner, kw + keyword.length);
    if (!isAssumeColon(inner[afterKw])) {
      parts.push(text[i] ?? "");
      i += 1;
      continue;
    }

    const value = inner.slice(afterKw + 1).trim();
    if (value) assumptions.push(value);
    i = close + 2;
  }

  const body = parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, assumptions };
}

export type SourceBadgeCounts = {
  memory: number;
  nas: number;
  notion: number;
  web: number;
};

export type UsedPromptRef = {
  key: string;
  step: string;
  number: string;
  title: string;
};

/** meta.used_prompts / metadata.used_prompts 정규화. */
export function normalizeUsedPrompts(raw: unknown): UsedPromptRef[] | null {
  if (!Array.isArray(raw)) return null;
  const items: UsedPromptRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const number =
      typeof row.number === "string"
        ? row.number.trim()
        : typeof row.prompt_number === "string"
          ? row.prompt_number.trim()
          : "";
    const title =
      typeof row.title === "string"
        ? row.title.trim()
        : typeof row.prompt_title === "string"
          ? row.prompt_title.trim()
          : "";
    const key =
      typeof row.key === "string"
        ? row.key.trim()
        : typeof row.prompt_key === "string"
          ? row.prompt_key.trim()
          : "";
    const step = typeof row.step === "string" ? row.step.trim() : "";
    if (!title) continue;
    items.push({ key, step, number, title });
  }
  return items.length > 0 ? items : null;
}

export function countSourceBadges(opts: {
  cards?: Array<{ type: string }> | null;
  notionSources?: unknown[] | null;
  memoryCount?: number | null;
}): SourceBadgeCounts {
  const cards = opts.cards ?? [];
  let nas = 0;
  let notion = 0;
  let web = 0;
  for (const c of cards) {
    if (c.type === "nas") nas += 1;
    else if (c.type === "notion") notion += 1;
    else if (c.type === "web" || c.type === "youtube") web += 1;
  }
  if (notion === 0 && Array.isArray(opts.notionSources)) {
    notion = opts.notionSources.length;
  }
  return {
    memory: Math.max(0, opts.memoryCount ?? 0),
    nas,
    notion,
    web
  };
}
