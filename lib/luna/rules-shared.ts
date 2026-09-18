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

/** rejected_reason → 사람이 읽는 규칙 문장 */
export const REJECT_REASON_RULE_TEXT: Record<string, string> = {
  same_client_diff_job: "발주처만 같고 대상이 다르면 다른 건이다",
  same_client_diff_target: "발주처만 같고 대상이 다르면 다른 건이다",
  similar_name: "이름만 비슷하면 다른 건이다",
  different_year: "연도가 다르면 다른 건이다"
};

const DONE_MARKER_RE =
  /[(\[]?\s*(?:TJ|EB|BL)\s*완료\s*[)\]]?/gi;

/** 조사·어미로 끝나는 조각은 버린다 */
const PARTICLE_TAIL_RE =
  /(가|이|은|는|을|를|의|에|에서|으로|로|과|와|이랑|랑|야|이야|줘|세요|요|다|네|지|까|면|며|고|도|만|부터|까지|한테|께)$/;

const CHATTY_ENDINGS = ["줘", "야", "이랑", "가"];

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
    return {
      client: parts[0]!.toLowerCase(),
      target: parts.slice(1).join(" ").toLowerCase()
    };
  }
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

/** 프로젝트명에서 비교용 토큰 추출. 조사·어미·서술어 끝은 버린다. */
export function projectNameTokens(name: string): string[] {
  const raw = stripDoneMarkers(name)
    .replace(/^\d{6}\s*/, "")
    .replace(/^0?\d{1,2}\s+/, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[_/\\]+/g, " ")
    .trim()
    .toLowerCase();
  if (!raw) return [];
  const chunks = raw.match(/[가-힣a-z0-9]{2,20}/g) ?? [];
  const out: string[] = [];
  for (const chunk of chunks) {
    if (/^\d+$/.test(chunk)) continue;
    if (looksLikeChattyToken(chunk)) continue;
    const cleaned = stripParticleTail(chunk);
    if (!cleaned || cleaned.length < 2) continue;
    if (looksLikeChattyToken(cleaned)) continue;
    out.push(cleaned);
  }
  return [...new Set(out)];
}

export function stripParticleTail(token: string): string {
  let t = token;
  // 긴 복합어(디스플레이 등)는 한 글자 조사로 자르지 않는다
  if (t.length >= 5) {
    const longParticle = /(이랑|에서|으로|부터|까지|한테|께|이야)$/;
    const m = t.match(longParticle);
    if (m && t.length - m[1]!.length >= 2) {
      return t.slice(0, -m[1]!.length);
    }
    return t;
  }
  const m = t.match(PARTICLE_TAIL_RE);
  if (m && t.length - m[1]!.length >= 2) {
    t = t.slice(0, -m[1]!.length);
  }
  return t;
}

export function looksLikeChattyToken(token: string): boolean {
  if (CHATTY_ENDINGS.some((end) => token.endsWith(end) && token.length <= 6)) {
    return true;
  }
  // 찾아줘 / 보여줘 / 알려줘 / 모아줘
  if (/(찾아|보여|알려|모아|해)줘$/.test(token)) return true;
  if (/(이랑|랑)$/.test(token) && token.length <= 6) return true;
  return false;
}

export function overlappingTokens(left: string, right: string): string[] {
  const a = new Set(projectNameTokens(left));
  const b = projectNameTokens(right);
  return b.filter((w) => a.has(w));
}

/**
 * 발주처 vs 프로젝트명.
 * - 여러 쌍에서 앞말로 반복되고, 문서유형을 뺀 뒷말(장소·대상)이 다르면 발주처
 * - 시즌/시리즈·중간에만 등장하면 프로젝트명 (빼면 구분 안 됨)
 */
export function classifyClientOrProject(
  word: string,
  pairs: Array<{ left: string; right: string }>
): "client" | "project" | "unknown" {
  if (isSeasonMarker(word)) return "project";

  const tails = new Set<string>();
  let asPrefix = 0;
  let asNonPrefix = 0;
  let seasonish = 0;
  for (const pair of pairs) {
    for (const title of [pair.left, pair.right]) {
      const tokens = projectNameTokens(title);
      const idx = tokens.indexOf(word);
      if (idx < 0) continue;
      if (idx === 0) {
        asPrefix += 1;
        const meaningful = meaningfulTarget(
          tokens.slice(1).join(" "),
          tokens.slice(1)
        );
        if (meaningful) tails.add(meaningful);
        if (tokens.some((t) => isSeasonMarker(t)) || /시즌/.test(title)) {
          seasonish += 1;
        }
      } else {
        asNonPrefix += 1;
      }
    }
  }
  // 문서유형 단어는 앞/중간 위치와 무관하게 unknown
  if (isDocTypeStopwordCandidate(word) && pairs.length >= 3) {
    return "unknown";
  }
  // 제목 중간에 붙는 시리즈명 (예: 현대퓨처넷 인스파이어 …)
  if (asNonPrefix >= 1) return "project";
  // 시즌 표기가 같이 있으면 시리즈/프로젝트
  if (seasonish >= 2) return "project";

  if (asPrefix >= 3 && tails.size >= 2) return "client";
  if (asPrefix >= 1 && tails.size <= 1) return "project";
  // 앞말은 아닌데 여러 쌍에 겹침 → 문서 유형 불용어 후보
  if (pairs.length >= 3) return "unknown";
  return "project";
}

export function isSeasonMarker(token: string): boolean {
  return /^시즌\s*\d*$/i.test(token) || /^season\s*\d*$/i.test(token);
}

/** 문서·완료 표기만 남은 뒷말은 시리즈 구분용으로 보지 않는다 */
const DOC_TYPE_NOISE = new Set([
  "콘텐츠",
  "컨텐츠",
  "제안서",
  "프로젝트",
  "리뉴얼",
  "제작",
  "구축",
  "최종",
  "미디어아트",
  "미디어파사드",
  "미디어아키텍처",
  "미디어아키텍쳐",
  "컨셉디자인",
  "수행계획서",
  "tj",
  "eb",
  "bl",
  "tj완료",
  "eb완료",
  "bl완료",
  "보안",
  "1차",
  "2차",
  "3차",
  "project"
]);

/** unknown(문서유형) 후보로 허용할 말 */
export function isDocTypeStopwordCandidate(word: string): boolean {
  if (DOC_TYPE_NOISE.has(word)) return true;
  if (
    /^(미디어아키텍처|미디어아키텍쳐|미디어파사드|미디어아트|컨셉디자인|수행계획서|제안서|콘텐츠|컨텐츠)$/.test(
      word
    )
  ) {
    return true;
  }
  return false;
}

function meaningfulTarget(target: string, restTokens: string[]): string {
  const parts = (target ? target.split(/\s+/) : restTokens)
    .map((t) => t.toLowerCase().replace(/[()[\]]/g, ""))
    .filter(
      (t) =>
        t.length >= 2 &&
        !DOC_TYPE_NOISE.has(t) &&
        !/^\d+$/.test(t) &&
        !isSeasonMarker(t)
    );
  return parts.join(" ").trim();
}

export function rejectReasonKey(evidence: Record<string, unknown> | null | undefined): string | null {
  if (!evidence) return null;
  const reject =
    typeof evidence.reject_reason === "string" ? evidence.reject_reason.trim() : "";
  if (reject && reject !== "other") return reject;
  const auto =
    typeof evidence.auto_rule === "string" ? evidence.auto_rule.trim() : "";
  if (auto === "same_client_diff_target") return "same_client_diff_target";
  return null;
}

export function humanRuleFromRejectReason(reason: string): string | null {
  return REJECT_REASON_RULE_TEXT[reason] ?? null;
}

/** 쓰레기 후보인지 — 정리용 */
export function isGarbageRuleCandidate(rule: {
  pattern_type: string;
  pattern_value: string;
}): boolean {
  if (rule.pattern_type === "rule") {
    if (rule.pattern_value.startsWith("reason:")) {
      const code = rule.pattern_value.slice("reason:".length);
      // 실패 원인 코드·통계는 규칙이 아님
      if (!humanRuleFromRejectReason(code) && !REJECT_REASON_RULE_TEXT[code]) {
        return true;
      }
      // reason:same_client_diff_job 형태는 OK if mapped
      if (humanRuleFromRejectReason(code)) return false;
      return true;
    }
    return false;
  }
  if (rule.pattern_type === "stopword") {
    const w = rule.pattern_value;
    if (looksLikeChattyToken(w)) return true;
    // 짧은 토큰만 조사 꼬리로 쓰레기 판정 (디스플레이 등 복합어 보호)
    if (w.length <= 4 && PARTICLE_TAIL_RE.test(w)) return true;
    if (isSeasonMarker(w)) return true;
    return false;
  }
  return false;
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
    return `「${rule.pattern_value}」이 겹쳐 잘못 연결된 것이 ${n || "여러"}건 있었습니다. 프로젝트 비교에서 빼도 될까요?`;
  }
  if (rule.pattern_value === "same_date_done_marker") {
    return "날짜코드가 같고 (TJ완료)·(EB완료)·(BL완료)만 다르면 같은 건으로 확정해도 될까요?";
  }
  if (
    rule.pattern_value === "same_client_diff_target" ||
    rule.pattern_value === "same_client_diff_job"
  ) {
    return "발주처(앞말)만 같고 뒷말(대상)이 다르면 다른 건으로 기각해도 될까요?";
  }
  const mapped = humanRuleFromRejectReason(
    rule.pattern_value.replace(/^reason:/, "")
  );
  if (mapped) {
    return `${mapped} (${n}건에서 같은 이유로 기각됐습니다. 규칙으로 쓸까요?)`;
  }
  if (sample) return sample;
  return `규칙 「${rule.pattern_value}」을 적용해도 될까요? (근거 ${n}건)`;
}

/** 하루에 사람에게 물을 상한 */
export const QA_DAILY_LIMIT = 20;

export function answerFlagIdFromRule(patternValue: string): string | null {
  const m = /^answer_flag:(.+)$/.exec(patternValue);
  return m?.[1] ?? null;
}

/**
 * 물어볼 만한 규칙 후보.
 * 링크 후보는 「규칙 후보 정제」(겹친 토큰 3건+, 쓰레기·시즌·고유명사 제외)와 같고,
 * 답 모순은 종류당 하나(개별 질문 80건을 그대로 물지 않음).
 */
export function isAskableRuleCandidate(rule: {
  pattern_type: string;
  pattern_value: string;
  signal_count?: number;
  evidence?: Record<string, unknown>;
}): boolean {
  if (isGarbageRuleCandidate(rule)) return false;
  const n = rule.signal_count ?? 0;
  if (n < 3) return false;
  if (answerFlagIdFromRule(rule.pattern_value)) return true;
  if (rule.pattern_type === "stopword") {
    const classify =
      typeof rule.evidence?.classify === "string" ? rule.evidence.classify : "";
    if (classify === "project") return false;
    return true;
  }
  if (rule.pattern_type === "rule") {
    const v = rule.pattern_value.replace(/^reason:/, "");
    if (humanRuleFromRejectReason(v) || REJECT_REASON_RULE_TEXT[v]) return true;
    if (
      v === "same_client_diff_target" ||
      v === "same_client_diff_job" ||
      v === "same_date_done_marker"
    ) {
      return true;
    }
    return false;
  }
  return false;
}

/** 사람이 읽고 고를 수 있는 문장. 엉뚱한 질문 예시는 붙이지 않는다. */
export function qaRuleQuestion(rule: {
  pattern_type: string;
  pattern_value: string;
  signal_count?: number;
  evidence?: Record<string, unknown>;
}): string {
  const flag = answerFlagIdFromRule(rule.pattern_value);
  if (flag === "source_skew") {
    return "답의 대부분이 노션에서만 나왔습니다. Work서버 자료를 더 봐야 할까요?";
  }
  if (flag === "slow") {
    return "답이 너무 오래 걸렸습니다. 검색을 먼저 줄일까요?";
  }
  if (flag === "scope_excess") {
    return "짧은 질문에도 자료를 너무 많이 찾았습니다. 용어 질문은 위키·용어사전만 보게 할까요?";
  }
  if (flag === "unused_sources") {
    return "찾아 놓고 안 쓴 자료가 많았습니다. 검색 범위를 줄일까요?";
  }
  if (flag === "low_confidence") {
    return "쉬운 질문인데 확신이 낮았습니다. 검색 범위를 줄일까요?";
  }
  if (flag === "intent_conf_gap") {
    return "질문은 알아들었는데 답을 못 한 적이 있습니다. 되묻기를 손볼까요?";
  }
  return ruleQuestionText({
    ...rule,
    evidence: { ...(rule.evidence ?? {}), sample: undefined }
  });
}
