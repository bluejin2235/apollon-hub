export const MAX_ALT_IMAGE_BYTES = 10 * 1024 * 1024;

export function isImageContentType(value: string | null): boolean {
  const ctype = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return ctype.startsWith("image/");
}

/** Content-Length 가 상한을 넘으면 받지 않음 */
export function exceedsAltImageByteLimit(
  contentLengthHeader: string | null,
  maxBytes = MAX_ALT_IMAGE_BYTES
): boolean {
  const n = Number(contentLengthHeader || 0);
  return Number.isFinite(n) && n > maxBytes;
}
