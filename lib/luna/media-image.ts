import { extname } from "node:path";
import sharp from "sharp";
import { THUMB_MAX_PX, VISION_MAX_PX } from "@/lib/luna/media-index-rules";

export type ImageDims = { width: number; height: number };

function sharpInput(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  const density = ext === ".psd" || ext === ".ai" ? 72 : undefined;
  return sharp(filePath, { failOn: "none", density });
}

export async function loadImageMeta(filePath: string): Promise<ImageDims | null> {
  try {
    const meta = await sharpInput(filePath).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/** 비전 API용 JPEG base64 (~640px). PSD/AI 는 libvips 지원 시만 성공 */
export async function resizeForVision(filePath: string): Promise<string | null> {
  try {
    const buf = await sharpInput(filePath)
      .rotate()
      .resize({
        width: VISION_MAX_PX,
        height: VISION_MAX_PX,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/** 썸네일 webp (~400px) */
export async function makeThumbnail(filePath: string): Promise<Buffer | null> {
  try {
    return await sharpInput(filePath)
      .rotate()
      .resize({
        width: THUMB_MAX_PX,
        height: THUMB_MAX_PX,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}
