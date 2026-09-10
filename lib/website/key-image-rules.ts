import {
  IMAGE_MIN_LONG_EDGE,
  INSIGHT_KEY_MIN_LONG_EDGE,
  KEY_STORE_LONG_EDGE,
  imageLongEdgeRejectMessage,
  insightKeyCropTooSmallMessage,
  isLongEdgeTooSmall
} from "@/lib/website/image-long-edge";

export const KEY_IMAGE_MIN_WIDTH = IMAGE_MIN_LONG_EDGE;
export const KEY_IMAGE_MIN_HEIGHT = IMAGE_MIN_LONG_EDGE;

/** 워크 대표 — 자른 뒤 최소·저장 목표 */
export const WORK_KEY_STORE_WIDTH = KEY_STORE_LONG_EDGE;
export const WORK_KEY_STORE_HEIGHT = Math.round((KEY_STORE_LONG_EDGE * 9) / 16); // 1440
export const WORK_KEY_RATIO = 16 / 9;
/** ±1.8% */
export const WORK_KEY_RATIO_TOLERANCE = 0.018;

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
  const a = width / height;
  const known: [string, number][] = [
    ["16:9", 16 / 9],
    ["3:2", 3 / 2],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16]
  ];
  for (const [label, target] of known) {
    if (Math.abs(a - target) / target <= WORK_KEY_RATIO_TOLERANCE) return label;
  }
  const g = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width) / g}:${Math.round(height) / g}`;
}

export function isNearWorkKeyRatio(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const a = width / height;
  return Math.abs(a - WORK_KEY_RATIO) / WORK_KEY_RATIO <= WORK_KEY_RATIO_TOLERANCE;
}

/** 원본 안에 넣을 수 있는 최대 16:9 크기 */
export function maxWorkKeyCropSize(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const imgAspect = width / height;
  if (imgAspect >= WORK_KEY_RATIO) {
    const h = height;
    const w = Math.round(h * WORK_KEY_RATIO);
    return { width: Math.min(w, width), height: h };
  }
  const w = width;
  const h = Math.round(w / WORK_KEY_RATIO);
  return { width: w, height: Math.min(h, height) };
}

export function workKeyCropFitsMin(width: number, height: number): boolean {
  const max = maxWorkKeyCropSize(width, height);
  return max.width >= WORK_KEY_STORE_WIDTH && max.height >= WORK_KEY_STORE_HEIGHT;
}

export function workKeyCropResultSize(width: number, height: number): { width: number; height: number } {
  const max = maxWorkKeyCropSize(width, height);
  const long = Math.max(max.width, max.height);
  if (long <= 0) return { width: 0, height: 0 };
  if (long >= KEY_STORE_LONG_EDGE) {
    const scale = KEY_STORE_LONG_EDGE / long;
    return {
      width: Math.max(1, Math.round(max.width * scale)),
      height: Math.max(1, Math.round(max.height * scale))
    };
  }
  return { width: max.width, height: max.height };
}

export function workKeyTooSmallAfterCropMessage(width: number, height: number): string {
  const result = workKeyCropResultSize(width, height);
  return (
    `이미지가 작습니다.\n` +
    `16:9 로 자르면 ${result.width} × ${result.height} 이 되어\n` +
    `최소 크기(${WORK_KEY_STORE_WIDTH} × ${WORK_KEY_STORE_HEIGHT})에 못 미칩니다.\n` +
    `더 큰 이미지를 올려주세요.`
  );
}

export function workKeyWrongRatioMessage(width: number, height: number): string {
  const label = formatImageRatioLabel(width, height);
  return (
    `16:9 가 아닙니다. 지금은 ${label} 입니다.\n` +
    `이대로는 저장할 수 없습니다. 16:9 로 잘라주세요.`
  );
}

export type KeyImageReject = { kind: "size"; width: number; height: number };

export function validateKeyImageDimensions(
  width: number,
  height: number,
  opts?: { mime?: string | null; src?: string | null }
): KeyImageReject | null {
  if (isLongEdgeTooSmall(width, height, opts)) {
    return { kind: "size", width, height };
  }
  return null;
}

export function keyImageRejectMessage(reject: KeyImageReject): string {
  return imageLongEdgeRejectMessage(reject.width, reject.height);
}

export const INSIGHT_KEY_IMAGE_MIN_LONG_SIDE = INSIGHT_KEY_MIN_LONG_EDGE;

export function insightKeyImageTooSmall(
  width: number,
  height: number,
  opts?: { mime?: string | null; src?: string | null }
): boolean {
  return isLongEdgeTooSmall(width, height, { ...opts, minLong: INSIGHT_KEY_MIN_LONG_EDGE });
}

export function insightKeyImageWarnMessage(width: number, height: number): string {
  return imageLongEdgeRejectMessage(width, height, INSIGHT_KEY_MIN_LONG_EDGE);
}

export function insightKeyCropRejectMessage() {
  return insightKeyCropTooSmallMessage();
}
