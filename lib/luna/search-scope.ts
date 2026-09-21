/**
 * 질문 종류별 검색 범위.
 *
 * 새 LLM 분류를 만들지 않는다. 이미 도는 「유형」(알기·찾기·만들기·배우기·인사)에
 * 가벼운 규칙 서브타입만 얹어 1차 범위를 정하고, 결과가 부족하면 한 단계씩 넓힌다.
 */

import { hasNamedProject } from "@/lib/luna/ask-what";

export type SearchScopeKind =
  | "none"
  | "term"
  | "policy"
  | "project"
  | "person"
  | "reference"
  | "find_wide"
  | "wide";

export type SearchScopeFlags = {
  glossary: boolean;
  wiki: boolean;
  notion: boolean;
  nas: boolean;
  media: boolean;
  web: boolean;
  youtube: boolean;
};

export type SearchScope = {
  kind: SearchScopeKind;
  label: string;
  tier: 1 | 2 | 3;
  flags: SearchScopeFlags;
};

export type SearchHitCounts = {
  glossary: number;
  wiki: number;
  notion: number;
  nas: number;
  media: number;
  web?: number;
};

/** 일반 찾기·프로젝트: 이보다 적으면 넓힘. 용어·규정은 별도 판정. */
export const SCOPE_WIDEN_MIN_HITS = 3;

const NONE: SearchScopeFlags = {
  glossary: false,
  wiki: false,
  notion: false,
  nas: false,
  media: false,
  web: false,
  youtube: false
};

const WIKI_GLOSSARY: SearchScopeFlags = {
  ...NONE,
  glossary: true,
  wiki: true
};

const WIKI_ONLY: SearchScopeFlags = {
  ...NONE,
  wiki: true
};

const PROJECT_WIDE: SearchScopeFlags = {
  glossary: true,
  wiki: true,
  notion: true,
  nas: true,
  media: true,
  web: false,
  youtube: false
};

const PERSON: SearchScopeFlags = {
  glossary: false,
  wiki: true,
  notion: true,
  nas: false,
  media: false,
  web: false,
  youtube: false
};

const REFERENCE: SearchScopeFlags = {
  glossary: false,
  wiki: true,
  notion: true,
  nas: false,
  media: true,
  web: false,
  youtube: false
};

const FULL: SearchScopeFlags = {
  glossary: true,
  wiki: true,
  notion: true,
  nas: true,
  media: true,
  web: true,
  youtube: false
};

/** 용어·정의 — "X가 뭐야", "무슨 뜻" */
export const TERM_DEF_RE =
  /(?:이|가|은|는)?\s*(?:뭐야|무엇입니까|무엇이야|무엇인가요|뭔가요|뭔지)|무슨\s*뜻|뜻(?:이|은|야|인가요)?|의미(?:가|는|야)?|정의(?:가|는|야)?|(?:이란|라는\s*게)\s*(?:뭐|무엇)/i;

/** 규정·제도 */
export const POLICY_RE =
  /병가|연차|반차|휴가|규정|제도|복지|근무\s*시간|출퇴근|급여|수당|복리후생|며칠\s*(?:쓸|돼|가능)|몇\s*일\s*(?:쓸|돼|가능)|법인카드|법카|출장|경비|회의실|와이파이|wifi|근태|정보보안|임금|괴롭힘|원드라이브|onedrive|복합기|취업규칙|원격업무|쏘카|식대|운동\s*지원|지원금|전자계약|워크\s*서버|work\s*server|work\s*서버|외부접속/i;

/** 사람·발언 */
export const PERSON_SPEECH_RE =
  /(?:상무|이사|대표|팀장|실장|본부장|님).{0,16}(?:얘기|말한|말씀|했|한\s*내용|이야기)|누가\s*(?:뭐|무엇).{0,10}(?:했|말)|발언|미팅\s*(?:내용|기록)|회의록/i;

/** 프로젝트 현황 */
export const PROJECT_STATUS_RE =
  /어떻게\s*돼|진행\s*(?:상황|중|돼|어떠)|현황|어디까지|자료\s*(?:보여|줘|있)|최신\s*(?:상황|진행)|업데이트/i;

/** 사례·레퍼런스 */
export const REFERENCE_RE =
  /사례|레퍼런스|참고\s*(?:사례|작|예)|비슷한\s*(?:사례|작|프로젝트)/i;

/** 날짜·완료 예정 — 용어 정의가 아니라 프로젝트 문서 검색 */
export const DATED_PROJECT_FACT_RE =
  /\d{1,2}\s*월\s*\d{1,2}\s*일|(?<!\d)\d{6}(?!\d)|완료\s*예정|예정\s*항목/;

const KIND_LABEL: Record<SearchScopeKind, string> = {
  none: "검색 없음",
  term: "용어·정의",
  policy: "규정·제도",
  project: "프로젝트 현황",
  person: "사람·발언",
  reference: "사례·레퍼런스",
  find_wide: "찾기(넓음)",
  wide: "넓게(애매)"
};

function flagsForKind(kind: SearchScopeKind, tier: 1 | 2 | 3): SearchScopeFlags {
  if (kind === "none") return { ...NONE };

  if (kind === "term") {
    if (tier === 1) return { ...WIKI_GLOSSARY };
    if (tier === 2) return { ...WIKI_GLOSSARY, notion: true };
    return { ...FULL, web: false };
  }

  if (kind === "policy") {
    if (tier === 1) return { ...WIKI_ONLY };
    if (tier === 2) return { ...WIKI_GLOSSARY, notion: true };
    return { ...FULL, web: false };
  }

  if (kind === "person") {
    if (tier === 1) return { ...PERSON };
    if (tier === 2) return { ...PERSON, nas: true, glossary: true };
    return { ...FULL, web: false };
  }

  if (kind === "reference") {
    if (tier === 1) return { ...REFERENCE };
    if (tier === 2) return { ...REFERENCE, nas: true, glossary: true };
    return { ...FULL, web: false };
  }

  // project / find_wide / wide — 처음부터 넓음
  if (kind === "wide") return { ...FULL };
  return { ...PROJECT_WIDE };
}

/**
 * 규칙만으로 유형·범위를 확정할 수 있으면 LLM classify 를 생략한다.
 * 애매하면 null → 기존 classify LLM.
 */
export function inferRuleClassification(question: string): {
  kind: SearchScopeKind;
  types: string[];
  reason: string;
} | null {
  const t = question.replace(/\s+/g, " ").trim();
  if (!t) return null;

  if (/^(안녕|고마워|감사|ㅎㅎ|ㅋㅋ|네$|응$|ok$|okay$)/i.test(t)) {
    return { kind: "none", types: ["smalltalk"], reason: "규칙: 인사" };
  }
  if (POLICY_RE.test(t)) {
    return { kind: "policy", types: ["know"], reason: "규칙: 규정·제도" };
  }
  if (PERSON_SPEECH_RE.test(t)) {
    return { kind: "person", types: ["find"], reason: "규칙: 사람·발언" };
  }
  if (hasNamedProject(t)) {
    return { kind: "project", types: ["find"], reason: "규칙: 지정 프로젝트" };
  }
  if (REFERENCE_RE.test(t)) {
    return { kind: "reference", types: ["find"], reason: "규칙: 사례·레퍼런스" };
  }
  if (PROJECT_STATUS_RE.test(t)) {
    return { kind: "project", types: ["find"], reason: "규칙: 프로젝트 현황" };
  }
  if (DATED_PROJECT_FACT_RE.test(t)) {
    return { kind: "project", types: ["find"], reason: "규칙: 날짜·예정 항목" };
  }
  if (TERM_DEF_RE.test(t)) {
    return { kind: "term", types: ["know"], reason: "규칙: 용어·정의" };
  }
  return null;
}

/** 용어·규정은 키워드 매칭만으로 충분 — 질문 임베딩 RPC 생략 */
export function scopeSkipsQueryEmbedding(kind: SearchScopeKind): boolean {
  return kind === "term" || kind === "policy" || kind === "none";
}

/**
 * 「어떻게」가 들어가도 프로젝트·용어는 종합 에세이가 아님.
 * 주입량·답변 토큰을 simple 로 고정한다.
 */
export function forceSimpleDepthForScope(kind: SearchScopeKind): boolean {
  return (
    kind === "term" ||
    kind === "policy" ||
    kind === "project" ||
    kind === "person"
  );
}

/**
 * 기존 유형 + 규칙 서브타입 → 검색 종류.
 * 애매·저신뢰면 wide. LLM 추가 호출 없음.
 */
export function resolveSearchScopeKind(opts: {
  types: string[];
  question: string;
  classifyConfidence?: number;
}): SearchScopeKind {
  const types = opts.types;
  const t = opts.question.replace(/\s+/g, " ").trim();
  if (!t) return "none";

  const only = (slug: string) =>
    types.includes(slug) &&
    !types.some((x) => x !== slug && x !== "learn");

  if (types.includes("smalltalk") && !types.includes("find") && !types.includes("know")) {
    return "none";
  }
  if (only("learn") || (types.includes("learn") && !types.includes("find") && !types.includes("know"))) {
    return "none";
  }
  if (types.includes("make") && !types.includes("find") && !types.includes("know")) {
    return "none";
  }

  // 규칙 서브타입이 분명하면 저신뢰 wide 보다 우선 (분류가 애매해도 패턴이 확실할 때)
  if (POLICY_RE.test(t)) return "policy";
  if (PERSON_SPEECH_RE.test(t)) return "person";
  if (hasNamedProject(t)) return "project";
  if (REFERENCE_RE.test(t)) return "reference";
  if (PROJECT_STATUS_RE.test(t)) return "project";
  if (DATED_PROJECT_FACT_RE.test(t)) return "project";
  if (TERM_DEF_RE.test(t)) return "term";

  const conf = opts.classifyConfidence;
  if (typeof conf === "number" && conf > 0 && conf < 0.55) {
    return "wide";
  }

  if (types.includes("find")) return "find_wide";
  if (types.includes("know")) return "term"; // 알기는 좁게 시작(위키·용어사전)
  return "wide";
}

export function resolveSearchScope(opts: {
  types: string[];
  question: string;
  classifyConfidence?: number;
  tier?: 1 | 2 | 3;
}): SearchScope {
  const kind = resolveSearchScopeKind(opts);
  const tier = opts.tier ?? 1;
  return {
    kind,
    label: KIND_LABEL[kind],
    tier,
    flags: flagsForKind(kind, tier)
  };
}

export function widenSearchScope(scope: SearchScope): SearchScope | null {
  if (scope.kind === "none") return null;
  if (scope.tier >= 3) return null;
  if (
    scope.kind === "project" ||
    scope.kind === "find_wide" ||
    scope.kind === "wide"
  ) {
    // 이미 넓음 — 더 넓힐 단계 없음(wide의 web만 tier3에 이미 포함)
    if (scope.kind === "wide" && scope.tier === 1) {
      return {
        kind: scope.kind,
        label: scope.label,
        tier: 3,
        flags: flagsForKind(scope.kind, 3)
      };
    }
    return null;
  }
  const nextTier = (scope.tier + 1) as 2 | 3;
  return {
    kind: scope.kind,
    label: scope.label,
    tier: nextTier,
    flags: flagsForKind(scope.kind, nextTier)
  };
}

/**
 * 결과가 부족한지.
 * 용어·규정: 위키/용어사전 1건만 있어도 충분(노션에 묻히지 않음).
 * 그 외: 합계 < 3 이면 부족.
 */
export function scopeHitsInsufficient(
  kind: SearchScopeKind,
  counts: SearchHitCounts
): boolean {
  if (kind === "none") return false;
  if (kind === "term" || kind === "policy") {
    return counts.glossary + counts.wiki < 1;
  }
  const total =
    counts.glossary +
    counts.wiki +
    counts.notion +
    counts.nas +
    counts.media +
    (counts.web ?? 0);
  return total < SCOPE_WIDEN_MIN_HITS;
}

/**
 * 목록형 사례·레퍼런스 — Work(NAS) 검색을 끈다.
 * 노션·이미지만으로 나열하고, widen 으로 NAS 가 켜지지 않게 한다.
 */
export function listingReferenceDisablesNas(
  kind: SearchScopeKind,
  listing: boolean
): boolean {
  return listing && kind === "reference";
}

/** listing+reference 이면 flags.nas 를 강제로 끈다 (tier 확대 후에도). */
export function applyListingReferenceFlags(
  scope: SearchScope,
  listing: boolean
): SearchScope {
  if (!listingReferenceDisablesNas(scope.kind, listing)) return scope;
  if (!scope.flags.nas && !scope.flags.glossary) return scope;
  return {
    ...scope,
    flags: {
      ...scope.flags,
      nas: false,
      // 목록형 사례는 용어사전 확대도 프롬프트만 키운다
      glossary: false
    }
  };
}

export function totalSearchHits(counts: SearchHitCounts): number {
  return (
    counts.glossary +
    counts.wiki +
    counts.notion +
    counts.nas +
    counts.media +
    (counts.web ?? 0)
  );
}

/** 커넥터 플래그에 범위 적용. 수동 지정은 그대로. */
export function applyScopeToConnectorFlags(
  flags: SearchScopeFlags,
  current: { notion: boolean; web: boolean; nas: boolean },
  manual: boolean
): { notion: boolean; web: boolean; nas: boolean } {
  if (manual) return current;
  return {
    notion: flags.notion,
    web: flags.web && current.web ? true : flags.web,
    nas: flags.nas
  };
}

export function scopeReasonLabel(scope: SearchScope): string {
  return `범위: ${scope.label} (${scope.tier}차)`;
}
