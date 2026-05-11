/** 카테고리 (다중 선택 저장, DB `restaurants.categories` + 호환용 `category`) */
export type RestaurantCategory = "성수점심" | "음식점" | "카페" | "기타";

export const RESTAURANT_CATEGORY_META: {
  key: RestaurantCategory;
  label: string;
  markerColor: string;
  badgeClass: string;
}[] = [
  { key: "성수점심", label: "성수/뚝섬", markerColor: "#2563eb", badgeClass: "bg-blue-600 text-white" },
  { key: "음식점", label: "음식점", markerColor: "#059669", badgeClass: "bg-emerald-600 text-white" },
  { key: "카페", label: "카페", markerColor: "#7c3aed", badgeClass: "bg-violet-600 text-white" },
  { key: "기타", label: "기타", markerColor: "#64748b", badgeClass: "bg-slate-600 text-white" }
];

/** 예전 단일 카테고리(DB `category` 문자열) → 현재 키 */
const LEGACY_CATEGORY_TO_CURRENT: Record<string, RestaurantCategory> = {
  점심: "성수점심",
  "카페·디저트": "카페",
  "회식·저녁": "음식점",
  배달: "기타",
  비즈니스: "음식점",
  "접대·비즈니스": "음식점"
};

export function normalizeRestaurantCategory(category: string): RestaurantCategory {
  const trimmed = category.trim();
  if (RESTAURANT_CATEGORY_META.some((c) => c.key === trimmed)) {
    return trimmed as RestaurantCategory;
  }
  const mapped = LEGACY_CATEGORY_TO_CURRENT[trimmed];
  if (mapped) return mapped;
  return "기타";
}

/** 표시·필터·지도용: `categories` 배열 우선, 없으면 레거시 `category` */
export function getRestaurantCategories(r: Pick<Restaurant, "category" | "categories">): RestaurantCategory[] {
  const raw = r.categories;
  if (raw && raw.length > 0) {
    const out: RestaurantCategory[] = [];
    const seen = new Set<RestaurantCategory>();
    for (const x of raw) {
      const n = normalizeRestaurantCategory(String(x));
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    if (out.length > 0) return out;
  }
  return [normalizeRestaurantCategory(r.category)];
}

export function restaurantPrimaryCategory(r: Pick<Restaurant, "category" | "categories">): RestaurantCategory {
  const cats = getRestaurantCategories(r);
  return cats[0] ?? "기타";
}

/** 저장 시: `category`는 첫 태그(호환), `categories`는 전체 */
export function categoryFieldsForDb(categories: RestaurantCategory[]): { category: string; categories: string[] } {
  const list = categories.length > 0 ? categories : ["기타"];
  return { category: list[0], categories: [...list] };
}

export function categoryMarkerColor(categoryOrRestaurant: string | Pick<Restaurant, "category" | "categories">): string {
  const key =
    typeof categoryOrRestaurant === "string"
      ? normalizeRestaurantCategory(categoryOrRestaurant)
      : restaurantPrimaryCategory(categoryOrRestaurant);
  const row = RESTAURANT_CATEGORY_META.find((c) => c.key === key);
  return row?.markerColor ?? "#64748b";
}

export function categoryBadgeClass(category: string): string {
  const row = RESTAURANT_CATEGORY_META.find((c) => c.key === normalizeRestaurantCategory(category));
  return row?.badgeClass ?? "bg-slate-500 text-white";
}

/** UI 표시용 카테고리명 (DB·상태 값은 `RestaurantCategory` 키 유지) */
export function restaurantCategoryDisplayLabel(category: string): string {
  const k = normalizeRestaurantCategory(category);
  const row = RESTAURANT_CATEGORY_META.find((c) => c.key === k);
  return row?.label ?? k;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `created_at` 기준 `days`일 이내 등록(포함)이면 true — 신규등록 뱃지 등 */
export function isRestaurantNewWithinDays(created_at: string, days = 14, now: Date = new Date()): boolean {
  const t = new Date(created_at).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= days * MS_PER_DAY;
}

/** 음식 종류 필터 (다중 선택) */
export const FOOD_TYPE_OPTIONS = [
  "한식",
  "중식",
  "일식",
  "이탈리안",
  "태국식",
  "베트남식",
  "고깃집",
  "횟집",
  "양식",
  "국물요리",
  "면요리",
  "브런치",
  "디저트",
  "베이커리",
  "티룸",
  "분식",
  "부페",
  "패스트푸드",
  "기타"
] as const;

export type FoodTypeOption = (typeof FOOD_TYPE_OPTIONS)[number];

/** DB 등에 남아 있을 수 있는 예전 음식 종류 라벨 */
export const FOOD_TYPE_LEGACY_ALIASES: Record<string, FoodTypeOption> = {
  태국음식: "태국식",
  베트남음식: "베트남식"
};

export function normalizeFoodTypeValue(v: string): string {
  const trimmed = v.trim();
  if ((FOOD_TYPE_OPTIONS as readonly string[]).includes(trimmed)) return trimmed;
  return FOOD_TYPE_LEGACY_ALIASES[trimmed] ?? trimmed;
}

export function normalizeFoodTypeList(arr: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr ?? []) {
    const n = normalizeFoodTypeValue(raw);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** 분위기 & 특징 (다중 선택) */
export const ATMOSPHERE_TAG_OPTIONS = [
  "분위기좋은",
  "조용한",
  "단체석",
  "뷰맛집",
  "사진맛집",
  "넓은",
  "주차편리",
  "애견동반"
] as const;

export type AtmosphereTagOption = (typeof ATMOSPHERE_TAG_OPTIONS)[number];

const ATMOSPHERE_TAG_LEGACY: Record<string, AtmosphereTagOption> = {
  주차: "주차편리",
  애견: "애견동반"
};

export function normalizeAtmosphereTag(raw: string): string {
  const t = raw.trim();
  if ((ATMOSPHERE_TAG_OPTIONS as readonly string[]).includes(t)) return t;
  return ATMOSPHERE_TAG_LEGACY[t] ?? t;
}

export function normalizeAtmosphereTagList(arr: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr ?? []) {
    const n = normalizeAtmosphereTag(raw);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** 카드·상세 등 표시용 (띄어쓰기만 보정) */
export function atmosphereTagDisplayLabel(tag: string): string {
  if (tag === "분위기좋은") return "분위기 좋은";
  return tag;
}

export type Restaurant = {
  id: string;
  name: string;
  category: string;
  /** 다중 카테고리 (비어 있으면 `category`만 사용) */
  categories?: string[] | null;
  address: string;
  lat: number | null;
  lng: number | null;
  menu: string | null;
  price_range: string | null;
  description: string | null;
  is_entertainment: boolean;
  registered_by: string | null;
  created_at: string;
  food_type: string[] | null;
  atmosphere_tags: string[] | null;
  tagline?: string | null;
  menu_image_paths?: string[] | null;
};

export type Review = {
  id: string;
  restaurant_id: string;
  reviewer_id: string;
  rating: number;
  comment: string | null;
  visit_date: string | null;
  revisit: boolean;
  created_at: string;
  star_rating?: number | null;
  keyword_tags?: string[] | null;
  image_paths?: string[] | null;
  revisit_intent?: "again" | "meh" | "never" | null;
};

export type RestaurantImageRow = {
  id: string;
  restaurant_id: string;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
};

/** 표시용 별점 (0.5 단위), 레거시 정수 rating 호환 */
export function reviewStarsScore(rv: Review): number {
  const sr = rv.star_rating;
  if (typeof sr === "number" && Number.isFinite(sr) && sr >= 2 && sr <= 10) {
    return sr / 2;
  }
  const r = rv.rating;
  if (typeof r === "number" && Number.isFinite(r)) {
    return r;
  }
  return 0;
}

/** 재방문 긍정 여부 (목록·추천용) */
export function reviewRevisitPositive(rv: Review): boolean {
  if (rv.revisit_intent === "again") return true;
  if (rv.revisit_intent === "never" || rv.revisit_intent === "meh") return false;
  return Boolean(rv.revisit);
}

export type ProfileLite = {
  id: string;
  email: string;
  name: string;
  department: string;
};

export type LunchVoteRow = {
  id: string;
  week_start: string;
  restaurant_id: string;
  voter_id: string;
  created_at: string;
};
