export type LunaMenuSlug =
  | "dashboard"
  | "knowledge"
  | "talk"
  | "candidates"
  | "selfstudy"
  | "brain";

export type LunaKnowledgeSub =
  | "confirmed"
  | "glossary"
  | "conflict"
  | "workserver"
  | "notion";

export type LunaTalkSub = "history" | "metrics";

export type LunaCandidatesSub = "pending" | "mine" | "history";

export type LunaSelfstudySub = "history" | "stuck" | "settings";

export type LunaBrainSub =
  | "prompts"
  | "upgrade"
  | "report"
  | "model"
  | "eval";

export type LunaSubSlug =
  | LunaKnowledgeSub
  | LunaTalkSub
  | LunaCandidatesSub
  | LunaSelfstudySub
  | LunaBrainSub;

export type LunaSubDef = {
  slug: LunaSubSlug;
  label: string;
};

export type LunaMenuDef = {
  slug: LunaMenuSlug;
  label: string;
  subs?: LunaSubDef[];
};

export const LUNA_MENUS: LunaMenuDef[] = [
  { slug: "dashboard", label: "대시보드" },
  {
    slug: "knowledge",
    label: "지식",
    subs: [
      { slug: "confirmed", label: "확정 지식" },
      { slug: "glossary", label: "용어사전" },
      { slug: "conflict", label: "충돌 보류함" },
      { slug: "workserver", label: "Work서버" },
      { slug: "notion", label: "노션" }
    ]
  },
  {
    slug: "talk",
    label: "대화",
    subs: [
      { slug: "history", label: "대화 이력" },
      { slug: "metrics", label: "관측 지표" }
    ]
  },
  {
    slug: "candidates",
    label: "지식후보",
    subs: [
      { slug: "pending", label: "대기 후보" },
      { slug: "mine", label: "내가 답할 차례" },
      { slug: "history", label: "처리 이력" }
    ]
  },
  {
    slug: "selfstudy",
    label: "자습",
    subs: [
      { slug: "history", label: "자습 이력" },
      { slug: "stuck", label: "막힌 순간" },
      { slug: "settings", label: "자습 설정" }
    ]
  },
  {
    slug: "brain",
    label: "두뇌",
    subs: [
      { slug: "prompts", label: "프롬프트" },
      { slug: "upgrade", label: "자기개선" },
      { slug: "report", label: "성장 보고" },
      { slug: "model", label: "모델·비용" },
      { slug: "eval", label: "회귀 시험" }
    ]
  }
];

const LUNA_MENU_SLUGS = LUNA_MENUS.map((m) => m.slug);

const SUBS_BY_MENU: Record<LunaMenuSlug, LunaSubSlug[] | undefined> =
  Object.fromEntries(
    LUNA_MENUS.map((m) => [m.slug, m.subs?.map((s) => s.slug)])
  ) as Record<LunaMenuSlug, LunaSubSlug[] | undefined>;

type LegacyLunaParam =
  | "home"
  | "brain"
  | "memory"
  | "talk"
  | "study"
  | "teach"
  | "prompts"
  | "eval"
  | "engine"
  | "knowledge"
  | "nas"
  | "trace"
  | "exam";

const LEGACY_LUNA_MAP: Record<
  LegacyLunaParam,
  { menu: LunaMenuSlug; sub?: LunaSubSlug }
> = {
  home: { menu: "dashboard" },
  brain: { menu: "brain", sub: "prompts" },
  memory: { menu: "knowledge", sub: "confirmed" },
  talk: { menu: "talk", sub: "history" },
  study: { menu: "selfstudy", sub: "settings" },
  teach: { menu: "candidates", sub: "pending" },
  prompts: { menu: "brain", sub: "prompts" },
  eval: { menu: "brain", sub: "eval" },
  engine: { menu: "brain", sub: "model" },
  knowledge: { menu: "knowledge", sub: "confirmed" },
  nas: { menu: "knowledge", sub: "workserver" },
  trace: { menu: "selfstudy", sub: "history" },
  exam: { menu: "brain", sub: "eval" }
};

export function isLunaMenuSlug(value: string): value is LunaMenuSlug {
  return (LUNA_MENU_SLUGS as string[]).includes(value);
}

export function isLegacyLunaParam(value: string): value is LegacyLunaParam {
  return value in LEGACY_LUNA_MAP;
}

export function defaultSubForMenu(menu: LunaMenuSlug): LunaSubSlug | null {
  const subs = SUBS_BY_MENU[menu];
  return subs?.[0] ?? null;
}

export function resolveLunaSubForMenu(
  menu: LunaMenuSlug,
  rawSub: string | null
): LunaSubSlug | null {
  const subs = SUBS_BY_MENU[menu];
  if (!subs?.length) return null;
  if (rawSub && (subs as string[]).includes(rawSub)) {
    return rawSub as LunaSubSlug;
  }
  return subs[0];
}

export function resolveLunaRoute(
  rawMenu: string | null,
  rawSub: string | null
): { menu: LunaMenuSlug; sub: LunaSubSlug | null } {
  if (!rawMenu || rawMenu === "home") {
    return { menu: "dashboard", sub: null };
  }

  if (isLegacyLunaParam(rawMenu)) {
    const mapped = LEGACY_LUNA_MAP[rawMenu];
    return {
      menu: mapped.menu,
      sub: mapped.sub ?? defaultSubForMenu(mapped.menu)
    };
  }

  if (!isLunaMenuSlug(rawMenu)) {
    return { menu: "dashboard", sub: null };
  }

  return {
    menu: rawMenu,
    sub: resolveLunaSubForMenu(rawMenu, rawSub)
  };
}

export function menuDef(menu: LunaMenuSlug): LunaMenuDef {
  return LUNA_MENUS.find((m) => m.slug === menu) ?? LUNA_MENUS[0];
}

export function subLabel(menu: LunaMenuSlug, sub: LunaSubSlug | null): string {
  if (!sub) return menuDef(menu).label;
  const found = menuDef(menu).subs?.find((s) => s.slug === sub);
  return found?.label ?? sub;
}

export function buildLunaSettingsUrl(
  menu: LunaMenuSlug,
  sub?: LunaSubSlug | null,
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams({ tab: "luna", luna: menu });
  const resolvedSub = sub ?? defaultSubForMenu(menu);
  if (resolvedSub) {
    params.set("sub", resolvedSub);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      params.set(key, value);
    }
  }
  return `/settings?${params.toString()}`;
}

export function legacyFilterToSub(
  menu: LunaMenuSlug,
  filter: string | null
): LunaSubSlug | null {
  if (menu === "candidates" && filter === "mine") return "mine";
  return null;
}

export function canonicalLunaSettingsUrl(
  searchParams: URLSearchParams
): string | null {
  const rawMenu = searchParams.get("luna");
  const rawSub = searchParams.get("sub");
  const filter = searchParams.get("filter");

  if (!rawMenu) {
    if (searchParams.get("tab") === "luna") {
      return buildLunaSettingsUrl("dashboard");
    }
    return null;
  }

  if (isLegacyLunaParam(rawMenu) || rawMenu === "home") {
    const mapped = resolveLunaRoute(rawMenu, rawSub);
    const sub =
      legacyFilterToSub(mapped.menu, filter) ?? mapped.sub ?? undefined;
    return buildLunaSettingsUrl(mapped.menu, sub);
  }

  if (!isLunaMenuSlug(rawMenu)) {
    return buildLunaSettingsUrl("dashboard");
  }

  const filterSub = legacyFilterToSub(rawMenu, filter);
  const sub =
    filterSub ?? resolveLunaSubForMenu(rawMenu, rawSub) ?? undefined;
  const canonical = buildLunaSettingsUrl(rawMenu, sub);

  const currentTab = searchParams.get("tab");
  const currentSub = searchParams.get("sub");
  const hasLegacyFilter = Boolean(filter);

  if (
    currentTab !== "luna" ||
    hasLegacyFilter ||
    (rawMenu !== "dashboard" &&
      SUBS_BY_MENU[rawMenu]?.length &&
      currentSub !== (sub ?? null))
  ) {
    return canonical;
  }

  if (rawMenu === "dashboard" && (currentSub || filter)) {
    return buildLunaSettingsUrl("dashboard");
  }

  return null;
}
