import { IMAGE_MIN_LONG_EDGE, imageLongEdgeRejectMessage, isLongEdgeTooSmall } from "@/lib/website/image-long-edge";

export const KEY_IMAGE_MIN_WIDTH = IMAGE_MIN_LONG_EDGE;
export const KEY_IMAGE_MIN_HEIGHT = IMAGE_MIN_LONG_EDGE;

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

export const INSIGHT_KEY_IMAGE_MIN_LONG_SIDE = IMAGE_MIN_LONG_EDGE;

export function insightKeyImageTooSmall(
  width: number,
  height: number,
  opts?: { mime?: string | null; src?: string | null }
): boolean {
  return isLongEdgeTooSmall(width, height, opts);
}

export function insightKeyImageWarnMessage(width: number, height: number): string {
  return imageLongEdgeRejectMessage(width, height);
}
