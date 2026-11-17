import { isPlaceholderAlt } from "@/lib/website/placeholder-alt";

/**
 * 대표 이미지를 새 사진으로 바꿨을 때, 남아 있는 대체 텍스트를
 * 「이전 사진 설명 · 확인 필요」로 표시하기 위한 기록.
 *
 * - 문장은 지우지 않는다. 바꾼 순간의 문장과 새 사진 주소만 적어 둔다.
 * - 사람이 칸을 고치면(문장이 달라지면) 자동으로 풀린다. 「AI로 다시 쓰기」로 바뀌어도 같다.
 * - 「이 설명 그대로 쓰기」를 누르면 그 언어 기록을 지운다.
 * - 사진 주소가 기록과 다르면(저장 안 하고 새로고침 등) 표시하지 않는다.
 */
export type AltReviewRecord = {
  /** 바꾼 뒤 사진 주소 */
  src: string;
  /** 바꾼 순간의 국문 설명 — 이 문장 그대로면 확인 필요 */
  ko?: string;
  /** 바꾼 순간의 영문 설명 */
  en?: string;
};

/** 공개 점검 문구 */
export const KEY_ALT_REVIEW_TITLE = "대표 이미지 설명이 이전 사진 설명입니다 · 확인 필요";
export const KEY_ALT_REVIEW_WHERE =
  "사진을 바꾸기 전에 쓴 문장입니다. 새 사진에 맞게 고치거나 「이 설명 그대로 쓰기」를 눌러 주세요";
export const KEY_ALT_REVIEW_EN_TITLE = "영문 대표 이미지 설명이 이전 사진 설명입니다";
export const KEY_ALT_REVIEW_EN_WHERE =
  "사진을 바꾸기 전에 쓴 영문입니다. 확인하지 않아도 공개할 수 있습니다";

export type AltReviewLang = "ko" | "en";

export type AltReviewState = { ko: boolean; en: boolean };

export const NO_ALT_REVIEW: AltReviewState = { ko: false, en: false };

type AltPair = { ko?: string | null; en?: string | null };

function kept(text: string | null | undefined): string | undefined {
  const value = (text ?? "").trim();
  if (!value || isPlaceholderAlt(value)) return undefined;
  return value;
}

/**
 * 사진을 새로 올렸을 때의 기록. 이미 확인 필요였던 문장이 그대로면 이어서 표시한다.
 * 남길 설명이 없으면 null.
 */
export function markAltReviewOnReplace(
  alt: AltPair,
  newSrc: string | null | undefined
): AltReviewRecord | null {
  const src = (newSrc ?? "").trim();
  if (!src) return null;
  const ko = kept(alt.ko);
  const en = kept(alt.en);
  if (ko === undefined && en === undefined) return null;
  const record: AltReviewRecord = { src };
  if (ko !== undefined) record.ko = ko;
  if (en !== undefined) record.en = en;
  return record;
}

/** 지금 사진·문장 기준으로 언어별 확인 필요 여부 */
export function altReviewState(
  record: AltReviewRecord | null | undefined,
  currentSrc: string | null | undefined,
  alt: AltPair
): AltReviewState {
  const src = (currentSrc ?? "").trim();
  if (!record || !src || record.src !== src) return NO_ALT_REVIEW;
  const ko = record.ko !== undefined && (alt.ko ?? "").trim() === record.ko;
  const en = record.en !== undefined && (alt.en ?? "").trim() === record.en;
  if (!ko && !en) return NO_ALT_REVIEW;
  return { ko, en };
}

/** 「이 설명 그대로 쓰기」 — 그 언어만 풀고, 둘 다 풀리면 null */
export function confirmAltReview(
  record: AltReviewRecord | null | undefined,
  lang: AltReviewLang
): AltReviewRecord | null {
  if (!record) return null;
  const next: AltReviewRecord = { ...record };
  delete next[lang];
  if (next.ko === undefined && next.en === undefined) return null;
  return next;
}

/** 같은 사진을 다시 자른 경우 — 확인 필요 상태는 새 주소로 옮긴다 */
export function moveAltReviewSrc(
  record: AltReviewRecord | null | undefined,
  fromSrc: string | null | undefined,
  toSrc: string | null | undefined
): AltReviewRecord | null {
  if (!record) return null;
  const from = (fromSrc ?? "").trim();
  const to = (toSrc ?? "").trim();
  if (!to || record.src !== from) return record;
  return { ...record, src: to };
}

/** 저장한 값을 읽어 모양이 맞을 때만 돌려준다 */
export function parseAltReviewRecord(raw: string | null | undefined): AltReviewRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.src !== "string" || !obj.src.trim()) return null;
    const record: AltReviewRecord = { src: obj.src };
    if (typeof obj.ko === "string") record.ko = obj.ko;
    if (typeof obj.en === "string") record.en = obj.en;
    if (record.ko === undefined && record.en === undefined) return null;
    return record;
  } catch {
    return null;
  }
}

export function altReviewStorageKey(kind: "work" | "insight", contentId: string): string {
  return `hub.website.keyAltReview.v1:${kind}:${contentId}`;
}
