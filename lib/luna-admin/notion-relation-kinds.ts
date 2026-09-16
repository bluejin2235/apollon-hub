/**
 * 노션 관계 속성 이름 → luna_links.kind 대응.
 * 새 속성이 생기면 이 파일만 고치면 된다.
 */
export type NotionRelationLinkKind = "belongs" | "follows" | "same";

/** forward: DB 저장 방향 그대로 / reverse: from↔to 뒤집기 (follows) */
export type NotionRelationDirection = "forward" | "reverse";

export type NotionRelationKindRule = {
  /** 노션 relation 속성 이름 (정확 일치) */
  property: string;
  kind: NotionRelationLinkKind;
  /**
   * follows 전용.
   * - forward: from=앞선 것(사업개발), to=뒤따르는 것(프로젝트) 로 이미 저장됨
   * - reverse: from 쪽이 뒤(프로젝트 등)에서 앞(사업개발)을 가리킴 → 뒤집어 저장
   */
  direction?: NotionRelationDirection;
};

/**
 * 속성 이름 → 종류 대응표
 *
 * belongs — 하위·관련 문서가 프로젝트(또는 사업개발)에 속함
 * follows — 사업개발 → 프로젝트 전환(이어진 것). 방향 있음
 * same   — 노션 관계에는 없음 (예약)
 */
export const NOTION_RELATION_KIND_RULES: readonly NotionRelationKindRule[] = [
  // —— belongs (속한 것) ——
  { property: "아이데이션", kind: "belongs" },
  { property: "일정 없는 회의록 작성", kind: "belongs" },
  { property: "관련 일정", kind: "belongs" },
  { property: "사업개발 자료", kind: "belongs" },
  { property: "제안서", kind: "belongs" },
  { property: "예산 관리", kind: "belongs" },
  { property: "회의록", kind: "belongs" },
  { property: "복제된 캘린더 일정", kind: "belongs" },
  { property: "면접 일정", kind: "belongs" },
  { property: "채용", kind: "belongs" },
  { property: "R&D 자료", kind: "belongs" },
  { property: "홍보 및 마케팅 자료", kind: "belongs" },
  { property: "관련 홍보마케팅", kind: "belongs" },
  { property: "관련 홍보 및 마케팅", kind: "belongs" },
  { property: "관련 R&D", kind: "belongs" },
  { property: "연결(리더방)", kind: "belongs" },
  { property: "연결(홍보 및 마케팅)", kind: "belongs" },
  { property: "연결(R&D)", kind: "belongs" },
  { property: "연결(프로젝트)", kind: "belongs" },
  { property: "관련 사업개발", kind: "belongs" },

  // —— follows (이어진 것) ——
  {
    property: "전환된 프로젝트",
    kind: "follows",
    direction: "forward"
  },
  {
    property: "연결(사업개발)",
    kind: "follows",
    direction: "reverse"
  },

  // —— same: 노션 관계에는 동일성 표현이 없음 ——
  // { property: "…", kind: "same" },

  // 「관련 프로젝트」는 BD→프로젝트일 수 있으나, 명시 목록 외라 기본 belongs.
  { property: "관련 프로젝트", kind: "belongs" }
] as const;

export type ClassifiedNotionRelation = {
  kind: NotionRelationLinkKind;
  direction: NotionRelationDirection;
  /** 규칙표에 있었는지 (없으면 기본 belongs) */
  known: boolean;
};

export function classifyNotionRelationProperty(
  propertyName: string
): ClassifiedNotionRelation {
  const name = propertyName.trim();
  const rule = NOTION_RELATION_KIND_RULES.find((r) => r.property === name);
  if (!rule) {
    return { kind: "belongs", direction: "forward", known: false };
  }
  return {
    kind: rule.kind,
    direction: rule.direction ?? "forward",
    known: true
  };
}

/** 페이지 루트/경로로 사업개발·프로젝트 쪽인지 판별 */
export function notionPageLineage(page: {
  root_title?: string | null;
  path_titles?: string[] | null;
  title?: string | null;
}): "bd" | "project" | "other" {
  const root = String(page.root_title ?? "").trim();
  const path0 = String(page.path_titles?.[0] ?? "").trim();
  const blob = `${root} ${path0}`;
  if (/사업개발/.test(blob) || /영업\s*및\s*사업개발/.test(blob)) return "bd";
  if (/프로젝트/.test(blob) && !/사업개발/.test(blob)) return "project";
  if (/\[진행\s*중\]\s*사업개발/.test(blob)) return "bd";
  if (/\[진행\s*중\]\s*프로젝트/.test(blob)) return "project";
  return "other";
}

/**
 * follows 후보가 진짜 「사업개발 → 프로젝트」인지.
 * 캘린더→사업개발 같은 연결(사업개발)은 follows 가 아니라 belongs 로 둔다.
 */
export function isBdToProjectFollowPair(
  fromPage: {
    root_title?: string | null;
    path_titles?: string[] | null;
  },
  toPage: {
    root_title?: string | null;
    path_titles?: string[] | null;
  }
): boolean {
  return (
    notionPageLineage(fromPage) === "bd" &&
    notionPageLineage(toPage) === "project"
  );
}
