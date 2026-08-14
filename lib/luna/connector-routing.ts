import type { LunaPromptRow } from "@/lib/luna/prompts";

export type ConnectorFlags = {
  notion: boolean;
  web: boolean;
  nas: boolean;
};

export type ConnectorRoutingReason =
  | "attachment"
  | "manual"
  | "memory_only"
  | "internal_rules"
  | "no_search_intent"
  | "project_deliverable"
  | "trend_reference"
  | "external_latest"
  | "file_project"
  | "ambiguous_wide";

export type ConnectorRoutingResult = {
  connectors: ConnectorFlags;
  reason: ConnectorRoutingReason;
  reasonLabel: string;
};

const SEARCH_INTENT_RE =
  /찾아|찾아줘|검색|알려줘|어디|위치|레퍼런스|사례|자료|파일|폴더|경로|보고서|견적|제안|트렌드|최신|뉴스|시장|외부|노션|Work/i;

const PROJECT_DELIVERABLE_RE =
  /제안서|견적서|보고서|기획안|도면|착수|수행계획|계약서|발주/i;

const TREND_REFERENCE_RE =
  /트렌드|레퍼런스|인사이트|벤치|동향|리서치|아카이브/i;

const EXTERNAL_LATEST_RE =
  /외부|최신|뉴스|시장|경쟁|글로벌|해외|업계/i;

const NAS_HINT_RE =
  /견적|보고서|착수|제안|폴더|파일|위치|Work|프로젝트|자료|경로|T:|P:|nas|견적서|사업/i;

const MEMORY_ONLY_RE =
  /^(안녕|고마워|감사|ㅎㅎ|ㅋㅋ|네$|응$|ok$|okay$)/i;

const INTERNAL_RULES_RE =
  /규칙|용어|판단\s*기준|우리\s*(팀|회사|의)?\s*(규칙|기준|원칙)/i;

const NONE: ConnectorFlags = { notion: false, web: false, nas: false };

export function formatConnectorRoutingSummary(
  result: ConnectorRoutingResult
): string {
  const parts: string[] = [];
  const { connectors } = result;
  if (connectors.nas) parts.push("Work서버");
  if (connectors.notion) parts.push("노션");
  if (connectors.web) parts.push("웹");
  if (parts.length === 0) {
    return `자동 선택: 검색 없음 — ${result.reasonLabel}로 판단`;
  }
  return `자동 선택: ${parts.join(" · ")} — ${result.reasonLabel}로 판단`;
}

/** L3-03 talk.search v4 규칙에 따른 커넥터 자동 선택 (수동 지정이 없을 때) */
export function resolveConnectorsAuto(
  message: string,
  opts: { hasAttachments: boolean; manual?: ConnectorFlags | null }
): ConnectorRoutingResult {
  if (opts.hasAttachments) {
    return {
      connectors: NONE,
      reason: "attachment",
      reasonLabel: "첨부 파일 분석"
    };
  }
  if (
    opts.manual &&
    (opts.manual.notion || opts.manual.web || opts.manual.nas)
  ) {
    return {
      connectors: opts.manual,
      reason: "manual",
      reasonLabel: "직접 지정"
    };
  }

  const text = message.trim();
  if (!text || MEMORY_ONLY_RE.test(text)) {
    return {
      connectors: NONE,
      reason: "memory_only",
      reasonLabel: "일반 대화"
    };
  }

  if (INTERNAL_RULES_RE.test(text) && !SEARCH_INTENT_RE.test(text)) {
    return {
      connectors: NONE,
      reason: "internal_rules",
      reasonLabel: "내부 규칙·용어"
    };
  }

  if (!SEARCH_INTENT_RE.test(text)) {
    return {
      connectors: NONE,
      reason: "no_search_intent",
      reasonLabel: "검색 불필요"
    };
  }

  if (PROJECT_DELIVERABLE_RE.test(text)) {
    return {
      connectors: { nas: true, notion: true, web: false },
      reason: "project_deliverable",
      reasonLabel: "프로젝트 산출물"
    };
  }

  if (EXTERNAL_LATEST_RE.test(text) && !TREND_REFERENCE_RE.test(text)) {
    return {
      connectors: { nas: false, notion: false, web: true },
      reason: "external_latest",
      reasonLabel: "외부·최신 정보"
    };
  }

  if (TREND_REFERENCE_RE.test(text)) {
    return {
      connectors: {
        nas: false,
        notion: true,
        web: EXTERNAL_LATEST_RE.test(text)
      },
      reason: "trend_reference",
      reasonLabel: "트렌드·레퍼런스"
    };
  }

  if (NAS_HINT_RE.test(text)) {
    return {
      connectors: { nas: true, notion: true, web: false },
      reason: "file_project",
      reasonLabel: "파일·프로젝트 자료"
    };
  }

  return {
    connectors: {
      nas: true,
      notion: true,
      web: EXTERNAL_LATEST_RE.test(text)
    },
    reason: "ambiguous_wide",
    reasonLabel: "넓게 검색"
  };
}

export function hasManualConnectors(c?: ConnectorFlags | null): boolean {
  return Boolean(c && (c.notion || c.web || c.nas));
}

export function hasManualSkills(ids: {
  perspective_ids: string[];
  role_ids: string[];
  task_ids: string[];
}): boolean {
  return (
    ids.perspective_ids.length +
      ids.role_ids.length +
      ids.task_ids.length >
    0
  );
}

/** profiles.department → L2 관점 prompt id (제목 부분 일치) */
export function matchPerspectiveIdByDepartment(
  department: string | null | undefined,
  perspectives: Pick<LunaPromptRow, "id" | "title">[]
): string | null {
  const d = (department ?? "").trim();
  if (!d || perspectives.length === 0) return null;

  const exact = perspectives.find((p) => p.title === d);
  if (exact) return exact.id;

  const byInclude = perspectives.find(
    (p) => d.includes(p.title) || p.title.includes(d)
  );
  if (byInclude) return byInclude.id;

  const normalized = d.replace(/\s+/g, "");
  for (const p of perspectives) {
    const t = p.title.replace(/\s+/g, "");
    if (normalized.includes(t) || t.includes(normalized)) return p.id;
  }
  return null;
}
