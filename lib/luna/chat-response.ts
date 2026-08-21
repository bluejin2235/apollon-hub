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

/** meta 이후 섞인 step/meta JSON · 빈 출처 표기 제거 */
export function scrubLunaAnswerText(text: string): string {
  let out = text.replace(/\r\n/g, "\n");
  // 줄 단위 내부 이벤트 JSON
  out = out
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t.startsWith("{") || !t.endsWith("}")) return true;
      try {
        const v = JSON.parse(t) as { type?: unknown };
        if (
          v &&
          typeof v === "object" &&
          (v.type === "step" ||
            v.type === "meta" ||
            v.type === "ids" ||
            v.type === "clarify" ||
            v.type === "team")
        ) {
          return false;
        }
      } catch {
        /* keep */
      }
      return true;
    })
    .join("\n");

  // 본문 끝에 붙은 JSON (개행 없이 이어진 경우)
  out = out.replace(
    /\s*\{"type":"(?:step|meta|ids|clarify|team)"[^]*\}\s*$/g,
    ""
  );

  // 빈 근거·출처
  out = out.replace(/—\s*근거\s*:\s*(?=\n|$)/g, "");
  out = out.replace(/-\s*근거\s*:\s*(?=\n|$)/g, "");
  out = out.replace(/근거\s*:\s*(?=\n|$)/g, "");
  out = out.replace(/출처\s*:\s*노션\s*「」\s*(?:의\s*「[^」]*」)?/g, "");
  out = out.replace(/출처\s*:\s*Notion\s*「」/gi, "");
  out = out.replace(/노션\s*「」\s*의\s*「([^」]*)」/g, "「$1」");
  out = out.replace(/·\s*\*{2,}\s*—/g, "· (제목 없음) —");
  out = out.replace(/\*{4,}/g, "");

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

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
  wiki: number;
  internal: number;
  nas: number;
  notion: number;
  web: number;
  /** 노션·Work 묶음 자료 건수 (표시용) */
  materials: number;
};

export type UsedPromptRef = {
  key: string;
  step: string;
  number: string;
  title: string;
};

export type LunaClassificationMeta = {
  types: string[];
  labels: string[];
  reason: string;
  confidence: number;
  switched: boolean;
  switch_reason: string | null;
};

export function normalizeClassification(raw: unknown): LunaClassificationMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const types = Array.isArray(row.types)
    ? row.types.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  const labels = Array.isArray(row.labels)
    ? row.labels.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  const reason = typeof row.reason === "string" ? row.reason.trim() : "";
  const confidence =
    typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? row.confidence
      : 0;
  if (types.length === 0 && !reason && labels.length === 0) return null;
  return {
    types,
    labels,
    reason,
    confidence,
    switched: row.switched === true,
    switch_reason:
      typeof row.switch_reason === "string"
        ? row.switch_reason
        : typeof row.switchReason === "string"
          ? row.switchReason
          : null
  };
}

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

function isPublicWikiSource(row: unknown): boolean {
  if (!row || typeof row !== "object" || Array.isArray(row)) return true;
  const cite = (row as { cite_publicly?: unknown }).cite_publicly;
  return cite !== false;
}

export function countSourceBadges(opts: {
  cards?: Array<{ type: string }> | null;
  notionSources?: unknown[] | null;
  wikiSources?: unknown[] | null;
  privateWikiRefs?: unknown[] | null;
  memoryCount?: number | null;
  materialsCount?: number | null;
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
  const wikiFromMeta = Array.isArray(opts.wikiSources)
    ? opts.wikiSources.filter(isPublicWikiSource).length
    : 0;
  const internalFromMeta = Array.isArray(opts.privateWikiRefs)
    ? opts.privateWikiRefs.length
    : Array.isArray(opts.wikiSources)
      ? opts.wikiSources.filter((row) => !isPublicWikiSource(row)).length
      : 0;
  const materials =
    typeof opts.materialsCount === "number"
      ? Math.max(0, opts.materialsCount)
      : 0;
  return {
    memory: Math.max(0, opts.memoryCount ?? 0),
    wiki: wikiFromMeta,
    internal: internalFromMeta,
    nas,
    notion,
    web,
    materials
  };
}
