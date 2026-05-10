/** 카테고리 탭 (DB `restaurants.category`와 일치시키세요) */
export type RestaurantCategory =
  | "점심"
  | "카페·디저트"
  | "회식·저녁"
  | "배달"
  | "접대·비즈니스";

export const RESTAURANT_CATEGORY_META: { key: RestaurantCategory; label: string; markerColor: string; badgeClass: string }[] = [
  { key: "점심", label: "점심", markerColor: "#2563eb", badgeClass: "bg-blue-600 text-white" },
  { key: "카페·디저트", label: "카페·디저트", markerColor: "#7c3aed", badgeClass: "bg-violet-600 text-white" },
  { key: "회식·저녁", label: "회식·저녁", markerColor: "#059669", badgeClass: "bg-emerald-600 text-white" },
  { key: "배달", label: "배달", markerColor: "#d97706", badgeClass: "bg-amber-600 text-white" },
  { key: "접대·비즈니스", label: "접대·비즈니스", markerColor: "#db2777", badgeClass: "bg-pink-600 text-white" }
];

export function categoryMarkerColor(category: string): string {
  const row = RESTAURANT_CATEGORY_META.find((c) => c.key === category);
  return row?.markerColor ?? "#64748b";
}

export function categoryBadgeClass(category: string): string {
  const row = RESTAURANT_CATEGORY_META.find((c) => c.key === category);
  return row?.badgeClass ?? "bg-slate-500 text-white";
}

/** 음식 종류 필터 (다중 선택) */
export const FOOD_TYPE_OPTIONS = [
  "고깃집",
  "일식",
  "횟집",
  "중식",
  "양식",
  "이탈리안",
  "프렌치",
  "태국음식",
  "베트남음식",
  "국물요리",
  "해산물",
  "면요리",
  "브런치",
  "분식",
  "부페",
  "패스트푸드",
  "기타"
] as const;

export type FoodTypeOption = (typeof FOOD_TYPE_OPTIONS)[number];

/** 분위기 & 특징 (다중 선택) */
export const ATMOSPHERE_TAG_OPTIONS = ["분위기좋은", "조용한", "단체석", "주차", "접대가능"] as const;

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
  if (sr != null && sr >= 2 && sr <= 10) {
    return sr / 2;
  }
  return rv.rating;
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
