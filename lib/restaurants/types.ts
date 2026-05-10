/** 카테고리 탭 (DB `restaurants.category`와 일치시키세요) */
export type RestaurantCategory =
  | "점심"
  | "카페·디저트"
  | "회식·저녁"
  | "배달"
  | "비즈니스";

export const RESTAURANT_CATEGORY_META: { key: RestaurantCategory; label: string; markerColor: string; badgeClass: string }[] = [
  { key: "점심", label: "점심", markerColor: "#2563eb", badgeClass: "bg-blue-600 text-white" },
  { key: "카페·디저트", label: "카페·디저트", markerColor: "#7c3aed", badgeClass: "bg-violet-600 text-white" },
  { key: "회식·저녁", label: "회식·저녁", markerColor: "#059669", badgeClass: "bg-emerald-600 text-white" },
  { key: "배달", label: "배달", markerColor: "#d97706", badgeClass: "bg-amber-600 text-white" },
  { key: "비즈니스", label: "비즈니스", markerColor: "#db2777", badgeClass: "bg-pink-600 text-white" }
];

/** 예전 DB/코드 값 → 현재 카테고리 */
const LEGACY_CATEGORY_TO_CURRENT: Record<string, RestaurantCategory> = {
  "접대·비즈니스": "비즈니스"
};

export function normalizeRestaurantCategory(category: string): RestaurantCategory {
  if (RESTAURANT_CATEGORY_META.some((c) => c.key === category)) {
    return category as RestaurantCategory;
  }
  const mapped = LEGACY_CATEGORY_TO_CURRENT[category];
  if (mapped) return mapped;
  return "점심";
}

export function categoryMarkerColor(category: string): string {
  const row = RESTAURANT_CATEGORY_META.find((c) => c.key === normalizeRestaurantCategory(category));
  return row?.markerColor ?? "#64748b";
}

export function categoryBadgeClass(category: string): string {
  const row = RESTAURANT_CATEGORY_META.find((c) => c.key === normalizeRestaurantCategory(category));
  return row?.badgeClass ?? "bg-slate-500 text-white";
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
export const ATMOSPHERE_TAG_OPTIONS = ["분위기좋은", "조용한", "단체석", "주차", "애견"] as const;

export type AtmosphereTagOption = (typeof ATMOSPHERE_TAG_OPTIONS)[number];

export type Restaurant = {
  id: string;
  name: string;
  category: string;
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
