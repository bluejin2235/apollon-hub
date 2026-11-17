/** AI 응답 적용 직전 판단. 사람이 쓴 문장은 언어별로 지킨다. */

import { isPlaceholderAlt } from "@/lib/website/placeholder-alt";

export type AltPair = { ko: string; en: string };

/** 요청 중 사람이 칸을 고쳤으면 덮어쓰지 않는다. */
export function shouldApplyAiAlt(opts: {
  koBefore: string;
  enBefore: string;
  koNow: string;
  enNow: string;
}): boolean {
  return opts.koBefore === opts.koNow && opts.enBefore === opts.enNow;
}

/** 국·영 어느 쪽이든 사람이 쓴 문장(빈칸·임시값 아님)이 있으면 참 — 「AI로 다시 쓰기」 확인용 */
export function hasExistingAlt(pair: AltPair): boolean {
  return !isPlaceholderAlt(pair.ko) || !isPlaceholderAlt(pair.en);
}

/**
 * 적용할 국·영 값. 적용하지 않으면 null.
 * - 요청 중 사람이 고쳤으면 null
 * - force(확인 창 통과): 두 언어 모두 교체
 * - 자동 채우기: 빈칸·임시값인 언어만 채우고 사람이 쓴 언어는 그대로
 */
export function mergeAiAlt(opts: {
  before: AltPair;
  now: AltPair;
  result: AltPair;
  force: boolean;
}): AltPair | null {
  const { before, now, result, force } = opts;
  if (
    !shouldApplyAiAlt({
      koBefore: before.ko,
      enBefore: before.en,
      koNow: now.ko,
      enNow: now.en
    })
  ) {
    return null;
  }
  if (force) return { ko: result.ko, en: result.en };
  const ko = isPlaceholderAlt(before.ko) ? result.ko : before.ko;
  const en = isPlaceholderAlt(before.en) ? result.en : before.en;
  if (ko === before.ko && en === before.en) return null;
  return { ko, en };
}

function normalizeSrc(src: string | null | undefined): string {
  return (src ?? "").trim().replace(/\/$/, "");
}

export type AltRequestTarget = { contentId: string; src: string; seq: number };

/**
 * 요청을 시작한 대상과 지금 대상이 같은지.
 * 콘텐츠 id · 이미지 주소 · 요청 순번이 모두 같아야 적용한다.
 */
export function isSameAltTarget(started: AltRequestTarget, current: AltRequestTarget): boolean {
  const src = normalizeSrc(started.src);
  return (
    started.contentId === current.contentId &&
    started.seq === current.seq &&
    src !== "" &&
    src === normalizeSrc(current.src)
  );
}
