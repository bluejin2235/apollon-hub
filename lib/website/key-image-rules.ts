import { SPEC } from "@/lib/website/spec";

/** 대표 이미지 — 16:9 ±1%, 가로 최소 2560px */
export const KEY_IMAGE_MIN_WIDTH = SPEC.keyImage.minWidth;
export const KEY_IMAGE_MIN_HEIGHT = SPEC.keyImage.minHeight;
export const KEY_IMAGE_ASPECT = 16 / 9;
export const KEY_IMAGE_ASPECT_TOLERANCE = 0.01;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function formatImageRatioLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "—";
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

export function isKeyImageAspectRatio(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const ratio = width / height;
  const delta = Math.abs(ratio - KEY_IMAGE_ASPECT) / KEY_IMAGE_ASPECT;
  return delta <= KEY_IMAGE_ASPECT_TOLERANCE;
}

export function isKeyImageWideEnough(width: number): boolean {
  return width >= KEY_IMAGE_MIN_WIDTH;
}

export type KeyImageReject =
  | { kind: "aspect"; width: number; height: number }
  | { kind: "size"; width: number; height: number };

export function validateKeyImageDimensions(
  width: number,
  height: number
): KeyImageReject | null {
  if (!isKeyImageAspectRatio(width, height)) {
    return { kind: "aspect", width, height };
  }
  if (!isKeyImageWideEnough(width)) {
    return { kind: "size", width, height };
  }
  return null;
}

export function keyImageRejectMessage(reject: KeyImageReject): string {
  const ratio = formatImageRatioLabel(reject.width, reject.height);
  if (reject.kind === "aspect") {
    return (
      `대표 이미지는 ${SPEC.keyImage.ratio} 여야 합니다. 지금 ${reject.width}×${reject.height} (${ratio}) 입니다. ` +
      "목록 카드와 카톡 공유에서 위아래가 잘립니다"
    );
  }
  return (
    `최소 ${KEY_IMAGE_MIN_WIDTH}×${KEY_IMAGE_MIN_HEIGHT} 이 필요합니다. ` +
    `지금 ${reject.width}×${reject.height} 입니다. 고해상도 화면에서 흐리게 보입니다`
  );
}
