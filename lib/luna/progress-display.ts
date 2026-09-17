/**
 * 대화 대기 중 진행 표시 · 「자세히」 단계 시간
 * — 실제로 돌린 검색만 한 줄씩. 가짜 단계 없음.
 */

import type { SearchScopeKind } from "@/lib/luna/search-scope";

export type ProgressStepLite = {
  key: string;
  label: string;
  status: "running" | "done" | "skip";
  ms?: number;
  right?: string;
};

export type ProgressDisplayRow = {
  key: string;
  state: "done" | "now" | "wait";
  label: string;
  right?: string;
  ms?: number;
};

/** 진행 패널에 그릴 단계 키 (내부 classify/search 등은 제외) */
export const UI_PROGRESS_KEYS = new Set([
  "ui_read",
  "ui_glossary",
  "ui_wiki",
  "ui_notion",
  "ui_link",
  "ui_work",
  "ui_image",
  "ui_nas_text",
  "ui_web",
  "answer"
]);

export function isUiProgressKey(key: string): boolean {
  return UI_PROGRESS_KEYS.has(key);
}

/** 라벨용 짧은 검색어 힌트 */
export function progressQueryHint(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const stop = new Set([
    "이",
    "그",
    "저",
    "뭐",
    "무엇",
    "어떻게",
    "어디",
    "얼마",
    "어느",
    "대한",
    "대해",
    "알려",
    "보여",
    "찾아",
    "관련",
    "있는",
    "있나",
    "있어",
    "주세요",
    "해줘",
    "현황",
    "진행",
    "상황",
    "자료",
    "최신",
    "사례",
    "레퍼런스",
    "뜻",
    "의미",
    "정의",
    "뭐야",
    "인가요"
  ]);
  const tokens = cleaned
    .split(/[\s,/·|]+/)
    .map((t) => t.replace(/[?？!！.。,，]+$/g, ""))
    .filter((t) => t.length >= 2 && !stop.has(t));
  return (tokens[0] ?? cleaned.slice(0, 12)).slice(0, 18);
}

export function formatCountRight(n: number, opts?: { plus?: boolean }): string {
  const v = Math.max(0, Math.round(n));
  return opts?.plus ? `+${v}건` : `${v}건`;
}

export function formatSecRight(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  return `${(ms / 1000).toFixed(1)}초`;
}

export function notionFoundLabel(hint: string): string {
  if (!hint) return "노션에서 찾았습니다";
  return `노션에서 「${hint}」를 찾았습니다`;
}

export function workFoundLabel(hint: string): string {
  if (!hint) return "Work서버 폴더를 찾았습니다";
  return `Work서버에서 「${hint}」를 찾았습니다`;
}

/** 질문 종류별 — 진행 패널에 어떤 검색 줄을 허용할지 */
export function uiChannelsForScope(kind: SearchScopeKind): {
  glossary: boolean;
  wiki: boolean;
  notion: boolean;
  link: boolean;
  work: boolean;
  image: boolean;
  nasText: boolean;
  web: boolean;
} {
  if (kind === "term") {
    return {
      glossary: true,
      wiki: false,
      notion: false,
      link: false,
      work: false,
      image: false,
      nasText: false,
      web: false
    };
  }
  if (kind === "policy") {
    return {
      glossary: false,
      wiki: true,
      notion: false,
      link: false,
      work: false,
      image: false,
      nasText: false,
      web: false
    };
  }
  if (kind === "reference") {
    return {
      glossary: false,
      wiki: true,
      notion: true,
      link: false,
      work: false,
      image: true,
      nasText: false,
      web: false
    };
  }
  if (kind === "none") {
    return {
      glossary: false,
      wiki: false,
      notion: false,
      link: false,
      work: false,
      image: false,
      nasText: false,
      web: false
    };
  }
  // project / person / find_wide / wide
  return {
    glossary: false,
    wiki: false,
    notion: true,
    link: true,
    work: true,
    image: kind === "wide" || kind === "find_wide",
    nasText: true,
    web: kind === "wide"
  };
}

export function buildProgressDisplayRows(opts: {
  steps: ProgressStepLite[];
  isComplete: boolean;
}): ProgressDisplayRow[] {
  const { steps, isComplete } = opts;
  const uiSteps = steps.filter(
    (s) => isUiProgressKey(s.key) && s.status !== "skip"
  );
  if (uiSteps.length === 0) return [];

  return uiSteps.map((s) => {
    let state: ProgressDisplayRow["state"] = "wait";
    if (s.status === "done" || (s.key === "answer" && isComplete)) {
      state = "done";
    } else if (s.status === "running") {
      state = "now";
    }
    const label =
      s.key === "answer" && state === "now"
        ? s.label.includes("…") || s.label.includes("중")
          ? s.label
          : "정리하는 중…"
        : s.key === "answer" && state === "done"
          ? s.label === "정리 완료"
            ? "정리했습니다"
            : s.label
          : s.label;
    return {
      key: s.key,
      state,
      label,
      right: s.right,
      ms: s.ms
    };
  });
}

/** 모바일: 진행 중이면 최근 N줄, 완료면 접기용 전체 */
export const PROGRESS_MOBILE_MAX_VISIBLE = 3;

export type DetailTimingRow = {
  key: string;
  label: string;
  right: string;
};

export type ResponseTimingsLite = {
  embed_ms?: number | null;
  search_ms?: number | null;
  link_ms?: number | null;
  llm_ms?: number | null;
  total_ms?: number | null;
  candidates_found?: number | null;
  candidates_added?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  model?: string | null;
  cost_krw?: number | null;
};

/**
 * 「자세히」 단계표 — steps + luna_response_timings 필드
 */
export function buildDetailTimingRows(opts: {
  steps: ProgressStepLite[];
  timings?: ResponseTimingsLite | null;
  classificationLabel?: string | null;
  classifySource?: "rule" | "llm" | null;
  keywords?: string | null;
}): DetailTimingRow[] {
  const { steps, timings, classificationLabel, classifySource, keywords } =
    opts;
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const rows: DetailTimingRow[] = [];

  const typeLabel =
    classificationLabel?.trim() ||
    byKey.get("ui_read")?.label.replace(/^질문을 읽었습니다\s*[—–-]\s*/, "") ||
    byKey.get("classify")?.label ||
    "";
  if (typeLabel) {
    rows.push({
      key: "type",
      label: `질문 유형 — ${typeLabel}`,
      right: classifySource === "llm" ? "LLM" : "규칙"
    });
  }

  const kwStep = byKey.get("kw");
  const kwText = keywords?.trim() || "";
  if (kwStep || kwText) {
    const short =
      kwText.length > 36 ? `${kwText.slice(0, 34)}…` : kwText || kwStep?.label || "";
    rows.push({
      key: "kw",
      label: short ? `검색어 — ${short}` : "검색어",
      right: formatSecRight(kwStep?.ms ?? timings?.embed_ms) || "—"
    });
  }

  const notionUi = byKey.get("ui_notion");
  const searchMs = timings?.search_ms ?? notionUi?.ms;
  const found = timings?.candidates_found;
  if (notionUi || (typeof searchMs === "number" && searchMs > 0)) {
    const countPart =
      typeof found === "number"
        ? `${found}건`
        : notionUi?.right || "";
    const sec = formatSecRight(searchMs);
    rows.push({
      key: "notion",
      label: "노션 벡터 검색",
      right: [countPart, sec].filter(Boolean).join(" · ") || "—"
    });
  }

  const linkUi = byKey.get("ui_link");
  const linkMs = timings?.link_ms ?? linkUi?.ms;
  const added = timings?.candidates_added;
  if (linkUi || (typeof linkMs === "number" && linkMs > 0)) {
    const countPart =
      typeof added === "number"
        ? formatCountRight(added, { plus: true })
        : linkUi?.right || "";
    const sec = formatSecRight(linkMs);
    rows.push({
      key: "link",
      label: "2차 데이터 연결",
      right: [countPart, sec].filter(Boolean).join(" · ") || "—"
    });
  }

  const workUi = byKey.get("ui_work");
  if (workUi) {
    rows.push({
      key: "work",
      label: "Work서버 폴더 매칭",
      right: [workUi.right, formatSecRight(workUi.ms)].filter(Boolean).join(" · ") || "—"
    });
  }

  const imageUi = byKey.get("ui_image");
  if (imageUi) {
    rows.push({
      key: "image",
      label: "이미지 검색",
      right: [imageUi.right, formatSecRight(imageUi.ms)].filter(Boolean).join(" · ") || "—"
    });
  }

  const nasText = byKey.get("ui_nas_text");
  if (nasText) {
    rows.push({
      key: "nas_text",
      label: "파일 본문 검색",
      right: [nasText.right, formatSecRight(nasText.ms)].filter(Boolean).join(" · ") || "—"
    });
  }

  const glossary = byKey.get("ui_glossary");
  if (glossary) {
    rows.push({
      key: "glossary",
      label: "용어사전",
      right: glossary.right || formatSecRight(glossary.ms) || "—"
    });
  }

  const wiki = byKey.get("ui_wiki");
  if (wiki) {
    rows.push({
      key: "wiki",
      label: "위키",
      right: wiki.right || formatSecRight(wiki.ms) || "—"
    });
  }

  const evalStep = byKey.get("eval");
  if (evalStep && evalStep.status !== "skip") {
    rows.push({
      key: "eval",
      label: `자체 평가 — ${evalStep.label}`,
      right: evalStep.status === "done" ? "통과" : evalStep.status
    });
  }

  const answer = byKey.get("answer");
  const llmMs = timings?.llm_ms ?? answer?.ms;
  if (answer || llmMs != null) {
    rows.push({
      key: "answer",
      label: "답변 생성",
      right: formatSecRight(llmMs) || "—"
    });
  }

  return rows;
}

export function formatDetailSummaryLine(opts: {
  modelLabel?: string | null;
  timings?: ResponseTimingsLite | null;
  durationMs?: number | null;
}): string {
  const parts: string[] = [];
  if (opts.modelLabel?.trim()) parts.push(opts.modelLabel.trim());
  const total = opts.timings?.total_ms ?? opts.durationMs;
  if (typeof total === "number" && Number.isFinite(total)) {
    parts.push(formatSecRight(total));
  }
  const tin = opts.timings?.prompt_tokens;
  const tout = opts.timings?.completion_tokens;
  if (typeof tin === "number" && tin > 0) {
    parts.push(`입력 ${tin.toLocaleString("ko-KR")}`);
  }
  if (typeof tout === "number" && tout > 0) {
    parts.push(`출력 ${tout.toLocaleString("ko-KR")} 토큰`);
  }
  const krw = opts.timings?.cost_krw;
  if (typeof krw === "number" && krw > 0) {
    parts.push(`₩${krw.toLocaleString("ko-KR")}`);
  }
  return parts.join(" · ");
}
