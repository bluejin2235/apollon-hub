export type LunaAdminMenu =
  | "dashboard"
  | "knowledge"
  | "talk"
  | "selfstudy"
  | "failures"
  | "candidates"
  | "brain";

export type LunaAdminKnowledgeSub = "primary" | "secondary";
export type LunaAdminTalkSub = "history" | "sources" | "metrics" | "personalization";
export type LunaAdminSelfstudySub =
  | "tonight"
  | "history"
  | "ask"
  | "learned"
  | "settings"
  | "review"
  | "links";
export type LunaAdminFailuresSub = "causes" | "analysis" | "sent";
export type LunaAdminCandidatesSub = "pending" | "mine" | "conflict" | "history";
export type LunaAdminBrainSub =
  | "prompts"
  | "types"
  | "upgrade"
  | "report"
  | "model"
  | "eval";

export type LunaAdminSub =
  | LunaAdminKnowledgeSub
  | LunaAdminTalkSub
  | LunaAdminSelfstudySub
  | LunaAdminFailuresSub
  | LunaAdminCandidatesSub
  | LunaAdminBrainSub;

export type LunaAdminPrimarySource =
  | "workserver"
  | "notion"
  | "image"
  | "wiki"
  | "glossary";

export type LunaAdminWorkKind = "folders" | "files" | "docs" | "images" | "unread";

export type LunaAdminSecondaryChip =
  | "all"
  | "same"
  | "belongs"
  | "follows"
  | "perspective"
  | "criteria";

export const PRIMARY_SOURCE_TABS: Array<{
  slug: Exclude<LunaAdminPrimarySource, "image">;
  label: string;
  tone: "work" | "notion" | "wiki" | "term";
}> = [
  { slug: "workserver", label: "Work서버", tone: "work" },
  { slug: "notion", label: "노션", tone: "notion" },
  { slug: "wiki", label: "위키", tone: "wiki" },
  { slug: "glossary", label: "용어사전", tone: "term" }
];

export const SECONDARY_CHIPS: Array<{
  slug: Exclude<LunaAdminSecondaryChip, "criteria">;
  label: string;
}> = [
  { slug: "all", label: "전체" },
  { slug: "same", label: "같은 것" },
  { slug: "belongs", label: "속한 것" },
  { slug: "follows", label: "이어진 것" },
  { slug: "perspective", label: "관점" }
];

export type LunaAdminSubDef = {
  slug: LunaAdminSub;
  label: string;
};

export type LunaAdminMenuDef = {
  slug: LunaAdminMenu;
  label: string;
  subs?: LunaAdminSubDef[];
};

/** 메뉴 순서 = 데이터가 도는 순서. 바꾸지 마라. */
export const LUNA_ADMIN_MENUS: LunaAdminMenuDef[] = [
  { slug: "dashboard", label: "대시보드" },
  {
    slug: "knowledge",
    label: "지식",
    subs: [
      { slug: "primary", label: "1차 데이터" },
      { slug: "secondary", label: "2차 데이터" }
    ]
  },
  {
    slug: "talk",
    label: "대화",
    subs: [
      { slug: "history", label: "대화 이력" },
      { slug: "sources", label: "구술·문서" },
      { slug: "metrics", label: "관측 지표" },
      { slug: "personalization", label: "개인화" }
    ]
  },
  {
    slug: "selfstudy",
    label: "자습",
    subs: [
      { slug: "tonight", label: "오늘 밤" },
      { slug: "history", label: "어젯밤" },
      { slug: "ask", label: "내가 답할 것" },
      { slug: "learned", label: "배운 것" },
      { slug: "settings", label: "설정" }
    ]
  },
  {
    slug: "failures",
    label: "실패 수집",
    subs: [
      { slug: "causes", label: "원인별" },
      { slug: "analysis", label: "루나의 분석" },
      { slug: "sent", label: "자습으로 보낸 것" }
    ]
  },
  {
    slug: "candidates",
    label: "지식후보",
    subs: [
      { slug: "pending", label: "대기 후보" },
      { slug: "mine", label: "내가 답할 차례" },
      { slug: "conflict", label: "충돌" },
      { slug: "history", label: "처리 이력" }
    ]
  },
  {
    slug: "brain",
    label: "두뇌",
    subs: [
      { slug: "prompts", label: "프롬프트" },
      { slug: "types", label: "유형" },
      { slug: "upgrade", label: "자기개선" },
      { slug: "report", label: "성장 루프" },
      { slug: "model", label: "모델·비용" },
      { slug: "eval", label: "정기 점검" }
    ]
  }
];

const MENU_SLUGS = LUNA_ADMIN_MENUS.map((m) => m.slug);

const SUBS_BY_MENU: Record<LunaAdminMenu, LunaAdminSub[] | undefined> =
  Object.fromEntries(
    LUNA_ADMIN_MENUS.map((m) => [m.slug, m.subs?.map((s) => s.slug)])
  ) as Record<LunaAdminMenu, LunaAdminSub[] | undefined>;

/** 옛 자습 탭 — 답 점검·2차 데이터 만들기는 내가 답할 것·오늘 밤에 녹였다. */
const SELFSTUDY_SUB_ALIASES: Record<string, LunaAdminSelfstudySub> = {
  review: "ask",
  links: "tonight"
};

export function canonicalAdminSub(
  menu: LunaAdminMenu,
  sub: LunaAdminSub | null | undefined
): LunaAdminSub | null {
  if (!sub) return sub ?? null;
  if (menu === "selfstudy") {
    const aliased = SELFSTUDY_SUB_ALIASES[sub];
    if (aliased) return aliased;
  }
  return sub;
}

export function isLunaAdminMenu(value: string): value is LunaAdminMenu {
  return (MENU_SLUGS as string[]).includes(value);
}

export function defaultSubForAdminMenu(menu: LunaAdminMenu): LunaAdminSub | null {
  return SUBS_BY_MENU[menu]?.[0] ?? null;
}

export function resolveAdminSub(
  menu: LunaAdminMenu,
  rawSub: string | null
): LunaAdminSub | null {
  const subs = SUBS_BY_MENU[menu];
  if (!subs?.length) return null;
  const mapped =
    menu === "selfstudy" && rawSub && SELFSTUDY_SUB_ALIASES[rawSub]
      ? SELFSTUDY_SUB_ALIASES[rawSub]
      : rawSub;
  if (mapped && (subs as string[]).includes(mapped)) {
    return mapped as LunaAdminSub;
  }
  return subs[0];
}

export function resolveAdminRoute(
  rawMenu: string | null,
  rawSub: string | null
): { menu: LunaAdminMenu; sub: LunaAdminSub | null } {
  if (!rawMenu || !isLunaAdminMenu(rawMenu)) {
    return { menu: "dashboard", sub: null };
  }
  return { menu: rawMenu, sub: resolveAdminSub(rawMenu, rawSub) };
}

export function adminMenuDef(menu: LunaAdminMenu): LunaAdminMenuDef {
  return LUNA_ADMIN_MENUS.find((m) => m.slug === menu) ?? LUNA_ADMIN_MENUS[0];
}

export function isPrimarySource(value: string | null): value is LunaAdminPrimarySource {
  return (
    value === "workserver" ||
    value === "notion" ||
    value === "image" ||
    value === "wiki" ||
    value === "glossary"
  );
}

/** 옛 이미지 메뉴는 Work서버 이미지 칩으로. */
export function canonicalPrimarySource(
  value: string | null
): Exclude<LunaAdminPrimarySource, "image"> | null {
  if (value === "image") return "workserver";
  if (value === "workserver" || value === "notion" || value === "wiki" || value === "glossary") {
    return value;
  }
  return null;
}

export function isWorkKind(value: string | null): value is LunaAdminWorkKind {
  return (
    value === "folders" ||
    value === "files" ||
    value === "docs" ||
    value === "images" ||
    value === "unread"
  );
}

export function isSecondaryChip(value: string | null): value is LunaAdminSecondaryChip {
  return (
    value === "all" ||
    value === "same" ||
    value === "belongs" ||
    value === "follows" ||
    value === "perspective" ||
    value === "criteria"
  );
}

export function buildLunaAdminUrl(
  menu: LunaAdminMenu,
  sub?: LunaAdminSub | null,
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams();
  if (menu !== "dashboard") {
    params.set("menu", menu);
  }
  const resolved = canonicalAdminSub(menu, sub ?? defaultSubForAdminMenu(menu));
  if (resolved) {
    params.set("sub", resolved);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
  }
  const q = params.toString();
  return q ? `/settings?${q}` : "/settings";
}
