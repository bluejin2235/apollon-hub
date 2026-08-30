import { SPEC } from "@/lib/website/spec";

/** 본문 가로 이미지 — 16:9 ±1.8%, 긴 변 최소 1600 · 권장 3200 */
export const BODY_LANDSCAPE_ASPECT = 16 / 9;
export const BODY_LANDSCAPE_ASPECT_TOLERANCE = 0.018;
export const BODY_LANDSCAPE_MIN_LONG = SPEC.bodyImage.minLong;
export const BODY_LANDSCAPE_RECOMMEND_LONG = SPEC.bodyImage.recommendLong;
export const PORTRAIT_TEXT_WARN_LONG = 2000;

export function isLandscapeBodyImage(width: number, height: number): boolean {
  return width > 0 && height > 0 && width >= height;
}

export function isBodyLandscape16x9(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const ratio = width / height;
  const delta = Math.abs(ratio - BODY_LANDSCAPE_ASPECT) / BODY_LANDSCAPE_ASPECT;
  return delta <= BODY_LANDSCAPE_ASPECT_TOLERANCE;
}

export function isPortraitTextPreset(preset: string | undefined): boolean {
  return preset === "portrait-text";
}

export type BodyImageReject =
  | { kind: "aspect"; width: number; height: number }
  | { kind: "size"; width: number; height: number };

export function validateBodyImageDimensions(
  preset: string | undefined,
  width: number,
  height: number
): BodyImageReject | null {
  if (isPortraitTextPreset(preset)) return null;
  if (!isLandscapeBodyImage(width, height)) return null;
  if (!isBodyLandscape16x9(width, height)) {
    return { kind: "aspect", width, height };
  }
  if (Math.max(width, height) < BODY_LANDSCAPE_MIN_LONG) {
    return { kind: "size", width, height };
  }
  return null;
}

export function bodyImageRejectMessage(reject: BodyImageReject): string {
  if (reject.kind === "aspect") {
    return `16:9 로 잘라서 올려주세요. 지금 이미지는 ${reject.width}×${reject.height} 입니다.`;
  }
  return (
    `긴 변 ${BODY_LANDSCAPE_MIN_LONG}px 이상이 필요합니다. ` +
    `지금 ${reject.width}×${reject.height} 입니다.`
  );
}

export function bodyImageWarnMessage(
  preset: string | undefined,
  width: number,
  height: number
): string | null {
  if (width <= 0 || height <= 0) return null;
  const longSide = Math.max(width, height);
  if (isPortraitTextPreset(preset)) {
    if (longSide < PORTRAIT_TEXT_WARN_LONG) {
      return (
        `긴 변 ${PORTRAIT_TEXT_WARN_LONG}px 이상을 권장합니다. ` +
        `지금 ${width}×${height} 입니다.`
      );
    }
    return null;
  }
  if (
    isLandscapeBodyImage(width, height) &&
    isBodyLandscape16x9(width, height) &&
    longSide < BODY_LANDSCAPE_RECOMMEND_LONG
  ) {
    return (
      `긴 변 ${BODY_LANDSCAPE_RECOMMEND_LONG}px 이상을 권장합니다. ` +
      `지금 ${width}×${height} 입니다.`
    );
  }
  return null;
}
