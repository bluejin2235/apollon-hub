"use client";

/**
 * 홈페이지 인사이트 카드 중 가장 작은 카드(가로형, PC 1440)에 넘치지 않는 길이.
 * 공백 포함 글자 수. 넘어도 저장·공개는 막지 않고 알리기만 한다.
 *   제목 — 평소 카드에 2줄 · 요약 — 마우스오버 때 카드 안 4줄
 */
export const INSIGHT_CARD_LIMITS = {
  title: { ko: 24, en: 32 },
  summary: { ko: 70, en: 80 }
} as const;

type Field = keyof typeof INSIGHT_CARD_LIMITS;
type Loc = { ko: string; en: string };

function overOf(field: Field, value: Loc) {
  const limit = INSIGHT_CARD_LIMITS[field];
  return { ko: value.ko.length > limit.ko, en: value.en.length > limit.en };
}

/** 「국문 12 / 24 · 영문 30 / 32」. 넘은 숫자만 경고색 */
export function CardLengthCount({ field, value }: { field: Field; value: Loc }) {
  const limit = INSIGHT_CARD_LIMITS[field];
  const over = overOf(field, value);
  return (
    <span className="cc">
      국문 <b className={over.ko ? "over" : undefined}>{value.ko.length}</b> / {limit.ko} · 영문{" "}
      <b className={over.en ? "over" : undefined}>{value.en.length}</b> / {limit.en}
    </span>
  );
}

/** 넘은 언어가 있을 때만 한 줄 */
export function CardLengthWarn({ field, value }: { field: Field; value: Loc }) {
  const over = overOf(field, value);
  if (!over.ko && !over.en) return null;
  const langs = [over.ko ? "국문" : null, over.en ? "영문" : null].filter(Boolean).join("·");
  return (
    <p className="hint-line warn" role="status">
      {langs} 권장 길이를 넘었습니다. 카드에서 잘릴 수 있습니다
    </p>
  );
}
