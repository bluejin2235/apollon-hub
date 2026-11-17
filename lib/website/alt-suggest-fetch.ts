import "server-only";

import sharp from "sharp";
import {
  exceedsAltImageByteLimit,
  isImageContentType,
  MAX_ALT_IMAGE_BYTES
} from "@/lib/website/alt-suggest-fetch-limits";
import { isRedirectStatus } from "@/lib/website/alt-suggest-url";

export { exceedsAltImageByteLimit, isImageContentType, MAX_ALT_IMAGE_BYTES };

const VISION_MAX_PX = 800;
const TIMEOUT_MS = 20_000;

/** Content-Length 또는 본문 스트리밍으로 10MB 상한 */
export async function readResponseBodyLimited(
  res: Response,
  maxBytes: number
): Promise<Buffer | null> {
  if (exceedsAltImageByteLimit(res.headers.get("content-length"), maxBytes)) return null;

  if (!res.body) {
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) return null;
    return Buffer.from(ab);
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}

/** 허용된 이미지 URL → 비전용 JPEG base64. 실패 시 null. */
export async function fetchImageAsJpegBase64(imageUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      redirect: "manual",
      headers: { Accept: "image/*" }
    });
    if (isRedirectStatus(res.status)) return null;
    if (!res.ok) return null;
    if (!isImageContentType(res.headers.get("content-type"))) return null;

    const buf = await readResponseBodyLimited(res, MAX_ALT_IMAGE_BYTES);
    if (!buf || buf.byteLength < 32) return null;

    const jpeg = await sharp(buf)
      .rotate()
      .resize({
        width: VISION_MAX_PX,
        height: VISION_MAX_PX,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    return jpeg.toString("base64");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
