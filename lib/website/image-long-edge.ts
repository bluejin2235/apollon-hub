export const IMAGE_MIN_LONG_EDGE = 1600;
export const BODY_STORE_LONG_EDGE = 3200;
export const KEY_STORE_LONG_EDGE = 2560;

export function imageLongEdgeRejectMessage(width: number, height: number) {
  return `긴 변이 1600 이상이어야 합니다. 지금 ${width}×${height} 입니다`;
}

export function isLongEdgeTooSmall(
  width: number | null | undefined,
  height: number | null | undefined
) {
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
    return false;
  }
  return Math.max(width, height) < IMAGE_MIN_LONG_EDGE;
}

export function formatBytes(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatShrinkLine(
  from: { width: number; height: number; bytes: number },
  to: { width: number; height: number; bytes: number }
) {
  return `${from.width}×${from.height} · ${formatBytes(from.bytes)} → ${to.width}×${to.height} · ${formatBytes(to.bytes)}`;
}
