/** 리뷰 키워드 — DB `reviews.keyword_tags`에 저장되는 값과 동일해야 합니다 */

export type ReviewKeywordGroupId = "taste" | "space" | "service";

export type ReviewKeywordDef = {
  id: string;
  label: string;
};

export const REVIEW_KEYWORD_GROUPS: {
  id: ReviewKeywordGroupId;
  emoji: string;
  title: string;
  keywords: ReviewKeywordDef[];
}[] = [
  {
    id: "taste",
    emoji: "😋",
    title: "맛&음식",
    keywords: [
      { id: "taste_delicious", label: "음식이 맛있어요" },
      { id: "taste_fresh", label: "재료가 신선해요" },
      { id: "taste_portion", label: "양이 많아요" },
      { id: "taste_special", label: "특별한 메뉴가 있어요" },
      { id: "taste_value", label: "가성비가 좋아요" }
    ]
  },
  {
    id: "space",
    emoji: "🏠",
    title: "공간&분위기",
    keywords: [
      { id: "space_interior", label: "인테리어가 멋져요" },
      { id: "space_wide", label: "매장이 넓어요" },
      { id: "space_clean", label: "매장이 청결해요" },
      { id: "space_photo", label: "사진이 잘 나와요" }
    ]
  },
  {
    id: "service",
    emoji: "👥",
    title: "서비스",
    keywords: [
      { id: "svc_kind", label: "친절해요" },
      { id: "svc_solo", label: "혼밥하기 좋아요" },
      { id: "svc_group", label: "단체모임 하기 좋아요" },
      { id: "svc_talk", label: "대화하기 좋아요" }
    ]
  }
];

export const ALL_REVIEW_KEYWORD_IDS: string[] = REVIEW_KEYWORD_GROUPS.flatMap((g) => g.keywords.map((k) => k.id));

export function keywordLabel(id: string): string {
  for (const g of REVIEW_KEYWORD_GROUPS) {
    const k = g.keywords.find((x) => x.id === id);
    if (k) return k.label;
  }
  return id;
}

export type RevisitIntent = "again" | "meh" | "never";

export const REVISIT_OPTIONS: { id: RevisitIntent; label: string; icon: string }[] = [
  { id: "again", label: "또 가고 싶다", icon: "✅" },
  { id: "meh", label: "글쎄", icon: "🤔" },
  { id: "never", label: "비추", icon: "❌" }
];
