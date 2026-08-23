import { extname } from "node:path";
import sharp from "sharp";
import {
  LARGE_MAX_PX,
  THUMB_MAX_PX,
  VISION_MAX_PX
} from "@/lib/luna/media-index-rules";

export type ImageDims = { width: number; height: number };

function sharpInput(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  const density = ext === ".psd" || ext === ".ai" ? 72 : undefined;
  return sharp(filePath, { failOn: "none", density });
}

const insideResize = (maxPx: number) => ({
  width: maxPx,
  height: maxPx,
  fit: "inside" as const,
  withoutEnlargement: true
});

export async function loadImageMeta(filePath: string): Promise<ImageDims | null> {
  try {
    const meta = await sharpInput(filePath).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

export type MediaImageVariants = {
  dims: ImageDims | null;
  visionJpegBase64: string | null;
  thumbWebp: Buffer | null;
  largeWebp: Buffer | null;
};

/** 원본 1회 디코드 후 800(AI)·400(썸)·1200(확대) 동시 생성 */
export async function renderMediaVariants(
  filePath: string
): Promise<MediaImageVariants> {
  const empty: MediaImageVariants = {
    dims: null,
    visionJpegBase64: null,
    thumbWebp: null,
    largeWebp: null
  };
  try {
    const base = sharpInput(filePath).rotate();
    const meta = await base.metadata();
    const dims =
      meta.width && meta.height
        ? { width: meta.width, height: meta.height }
        : null;

    const [visionBuf, thumbWebp, largeWebp] = await Promise.all([
      base
        .clone()
        .resize(insideResize(VISION_MAX_PX))
        .jpeg({ quality: 82 })
        .toBuffer(),
      base
        .clone()
        .resize(insideResize(THUMB_MAX_PX))
        .webp({ quality: 80 })
        .toBuffer(),
      base
        .clone()
        .resize(insideResize(LARGE_MAX_PX))
        .webp({ quality: 85 })
        .toBuffer()
    ]);

    return {
      dims,
      visionJpegBase64: visionBuf.toString("base64"),
      thumbWebp,
      largeWebp
    };
  } catch {
    return empty;
  }
}

/** 비전 API용 JPEG base64 (~800px). PSD/AI 는 libvips 지원 시만 성공 */
export async function resizeForVision(filePath: string): Promise<string | null> {
  try {
    const buf = await sharpInput(filePath)
      .rotate()
      .resize(insideResize(VISION_MAX_PX))
      .jpeg({ quality: 82 })
      .toBuffer();
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/** 썸네일 webp (~400px, fit inside) */
export async function makeThumbnail(filePath: string): Promise<Buffer | null> {
  try {
    return await sharpInput(filePath)
      .rotate()
      .resize(insideResize(THUMB_MAX_PX))
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** 확대 보기 webp (~1200px, fit inside) */
export async function makeLargeWebp(filePath: string): Promise<Buffer | null> {
  try {
    return await sharpInput(filePath)
      .rotate()
      .resize(insideResize(LARGE_MAX_PX))
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    return null;
  }
}
