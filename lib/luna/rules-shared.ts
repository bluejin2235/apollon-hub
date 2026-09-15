/** luna_rules — 링크·검색·답변에 쓰는 학습 규칙 (순수 헬퍼) */

export type LunaRuleScope = "link" | "search" | "answer" | "term";
export type LunaRulePatternType = "stopword" | "rule" | "threshold";
export type LunaRuleStatus = "candidate" | "active" | "dropped";

export type LunaRuleRow = {
  id: string;
  scope: LunaRuleScope;
  pattern_type: LunaRulePatternType;
  pattern_value: string;
  signal_count: number;
  status: LunaRuleStatus;
  evidence: Record<string, unknown>;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  applied_count?: number;
};

export const BUILTIN_LINK_RULES = [
  {
    pattern_type: "rule" as const,
    pattern_value: "same_date_done_marker",
    question:
      "날짜코드가 같고 (TJ완료)·(EB완료)·(BL완료)만 다르면 같은 건으로 확정해도 될까요?",
    auto: true
  },
  {
    pattern_type: "rule" as const,
    pattern_value: "same_client_diff_target",
    question:
      "발주처(앞말)만 같고 뒷말(대상)이 다르면 다른 건으로 기각해도 될까요?",
    auto: true
  }
] as const;

const DONE_MARKER_RE =
  /[(\[]?\s*(?:TJ|EB|BL)\s*완료\s*[)\]]?/gi;

export function stripDoneMarkers(name: string): string {
  return name
    .replace(DONE_MARKER_RE, " ")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDateCodeLoose(name: string): string | null {
  const m = name.trim().match(/(?:^|[^\d])(\d{6})(?:\s|$)/);
  if (m) return m[1]!;
  const head = name.trim().match(/^(\d{6})/);
  return head ? head[1]! : null;
}

/** 날짜코드 같음 + 완료 표기만 다름 → 자동 확정 */
export function isSameDateDoneMarkerOnly(left: string, right: string): boolean {
  const da = extractDateCodeLoose(left);
  const db = extractDateCodeLoose(right);
  if (!da || !db || da !== db) return false;
  const a = stripDoneMarkers(left)
    .replace(/^\d{6}\s*/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const b = stripDoneMarkers(right)
    .replace(/^\d{6}\s*/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (!a || !b) return false;
  return a === b;
}

/**
 * 앞말(발주처)만 같고 뒷말(대상)이 다름 → 자동 기각.
 * 날짜코드를 뺀 뒤 첫 토큰(또는 연속 한글 고유명)을 앞말로 본다.
 */
export function splitClientTarget(name: string): {
  client: string;
  target: string;
} {
  const raw = stripDoneMarkers(name)
    .replace(/^\d{6}\s*/, "")
    .replace(/^0?\d{1,2}\s+/, "")
    .trim();
  if (!raw) return { client: "", target: "" };
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { client: parts[0]!.toLowerCase(), target: parts.slice(1).join(" ").toLowerCase() };
  }
  // 띄어쓰기 없으면 앞 2~6글자를 발주처 후보로
  const hangul = raw.replace(/[^가-힣A-Za-z0-9]/g, "");
  if (hangul.length < 6) return { client: hangul.toLowerCase(), target: "" };
  const cut = Math.min(6, Math.max(2, Math.floor(hangul.length / 2)));
  return {
    client: hangul.slice(0, cut).toLowerCase(),
    target: hangul.slice(cut).toLowerCase()
  };
}

export function isSameClientDiffTarget(left: string, right: string): boolean {
  const a = splitClientTarget(left);
  const b = splitClientTarget(right);
  if (!a.client || !b.client || a.client !== b.client) return false;
  if (!a.target || !b.target) return false;
  if (a.target === b.target) return false;
  // 대상이 한쪽을 포함하면(확장명) 같은 건으로 본다
  if (a.target.includes(b.target) || b.target.includes(a.target)) return false;
  return true;
}

export type LinkAutoVerdict = "confirm" | "reject" | null;

export function autoVerdictForSamePair(
  left: string,
  right: string
): LinkAutoVerdict {
  if (isSameDateDoneMarkerOnly(left, right)) return "confirm";
  if (isSameClientDiffTarget(left, right)) return "reject";
  return null;
}

export function ruleQuestionText(rule: {
  pattern_type: string;
  pattern_value: string;
  signal_count?: number;
  evidence?: Record<string, unknown>;
}): string {
  const n = rule.signal_count ?? 0;
  const sample =
    typeof rule.evidence?.sample === "string" ? rule.evidence.sample : "";
  if (rule.pattern_type === "stopword") {
    return `「${rule.pattern_value}」이 겹쳐 잘못 연결된 것이 ${n || "여러"}건 있었습니다. 발주처·공통어는 프로젝트 비교에서 빼도 될까요?`;
  }
  if (rule.pattern_value === "same_date_done_marker") {
    return "날짜코드가 같고 (TJ완료)·(EB완료)·(BL완료)만 다르면 같은 건으로 확정해도 될까요?";
  }
  if (rule.pattern_value === "same_client_diff_target") {
    return "발주처(앞말)만 같고 뒷말(대상)이 다르면 다른 건으로 기각해도 될까요?";
  }
  if (sample) {
    return `${sample} (근거 신호 ${n}건)`;
  }
  return `규칙 「${rule.pattern_value}」을 적용해도 될까요? (근거 ${n}건)`;
}
