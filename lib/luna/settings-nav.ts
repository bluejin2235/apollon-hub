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
  | "wiki"
  | "conflict"
  | "workserver"
  | "notion";

export type LunaTalkSub = "history" | "thumbs" | "sources" | "metrics";

export type LunaCandidatesSub = "pending" | "mine" | "history";

export type LunaSelfstudySub = "history" | "stuck" | "settings";

export type LunaBrainSub =
  | "prompts"
  | "types"
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
      { slug: "confirmed", label: "아폴론 지식" },
      { slug: "glossary", label: "용어사전" },
      { slug: "wiki", label: "위키" },
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
      { slug: "thumbs", label: "싫어요" },
      { slug: "sources", label: "구술·문서" },
      { slug: "metrics", label: "관측 지표" }
    ]
  },
  // 대화·자습에서 나온 것이 지식후보로 모이는 흐름 순서
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
    slug: "candidates",
    label: "지식후보",
    subs: [
      { slug: "pending", label: "대기 후보" },
      { slug: "mine", label: "내가 답할 차례" },
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

  // Canonical menu slugs take precedence over legacy aliases (knowledge, talk, brain, …).
  if (isLunaMenuSlug(rawMenu)) {
    return {
      menu: rawMenu,
      sub: resolveLunaSubForMenu(rawMenu, rawSub)
    };
  }

  if (isLegacyLunaParam(rawMenu)) {
    const mapped = LEGACY_LUNA_MAP[rawMenu];
    return {
      menu: mapped.menu,
      sub: mapped.sub ?? defaultSubForMenu(mapped.menu)
    };
  }

  return { menu: "dashboard", sub: null };
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

  if (rawMenu === "home") {
    return buildLunaSettingsUrl("dashboard");
  }

  // 구 지식>원문 → 대화>구술·문서
  if (rawMenu === "knowledge" && rawSub === "sources") {
    return buildLunaSettingsUrl("talk", "sources");
  }

  // 구 두뇌>라이브러리 → 지식>위키
  if (rawMenu === "brain" && rawSub === "library") {
    return buildLunaSettingsUrl("knowledge", "wiki");
  }

  // Legacy-only params (memory, nas, teach, …) — not canonical menu slugs.
  if (isLegacyLunaParam(rawMenu) && !isLunaMenuSlug(rawMenu)) {
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
