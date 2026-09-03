import {
  BODY_STORE_LONG_EDGE,
  IMAGE_MIN_LONG_EDGE,
  INSIGHT_KEY_MIN_LONG_EDGE,
  KEY_STORE_LONG_EDGE,
  formatBytes,
  formatShrinkLine,
  imageLongEdgeRejectMessage
} from "@/lib/website/image-long-edge";

export type PrepareKind = "body" | "key" | "insight-key";

export type PreparedImage = {
  file: File;
  from: { width: number; height: number; bytes: number };
  to: { width: number; height: number; bytes: number };
  skipped: boolean;
  line: string;
};

function isGifFile(file: File) {
  if (file.type === "image/gif") return true;
  return /\.gif$/i.test(file.name);
}

function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function fitLongEdge(width: number, height: number, maxLong: number) {
  const long = Math.max(width, height);
  if (long <= maxLong) return { width, height };
  const scale = maxLong / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("toBlob_failed"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

export async function prepareImageForUpload(
  file: File,
  kind: PrepareKind
): Promise<{ ok: true; data: PreparedImage } | { ok: false; error: string }> {
  const size = await readImageSize(file);
  if (!size?.width || !size.height) {
    return { ok: false, error: "이미지 크기를 읽지 못했습니다" };
  }

  const from = { width: size.width, height: size.height, bytes: file.size };

  if (isGifFile(file)) {
    const to = from;
    return {
      ok: true,
      data: {
        file,
        from,
        to,
        skipped: true,
        line: `${from.width}×${from.height} · ${formatBytes(from.bytes)}`
      }
    };
  }

  const minLong = kind === "insight-key" ? INSIGHT_KEY_MIN_LONG_EDGE : IMAGE_MIN_LONG_EDGE;
  if (Math.max(size.width, size.height) < minLong) {
    return { ok: false, error: imageLongEdgeRejectMessage(size.width, size.height, minLong) };
  }

  const maxLong = kind === "body" ? BODY_STORE_LONG_EDGE : KEY_STORE_LONG_EDGE;
  const next = fitLongEdge(size.width, size.height, maxLong);
  const canvas = document.createElement("canvas");
  canvas.width = next.width;
  canvas.height = next.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { ok: false, error: "이미지를 줄이지 못했습니다" };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode_failed"));
      el.src = url;
    });
    ctx.drawImage(img, 0, 0, next.width, next.height);
    const blob = await canvasToJpeg(canvas, 0.9);
    const out = new File([blob], "prepared.jpg", { type: "image/jpeg" });
    const to = { width: next.width, height: next.height, bytes: out.size };
    return {
      ok: true,
      data: {
        file: out,
        from,
        to,
        skipped: false,
        line: formatShrinkLine(from, to)
      }
    };
  } catch {
    return { ok: false, error: "이미지를 줄이지 못했습니다" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
