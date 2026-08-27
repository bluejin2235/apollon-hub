/**
 * 브라우저 video + canvas 로 로컬 영상에서 장면 프레임을 뽑는다.
 * 길이의 고정 비율 지점 5장만 뽑는다. 품질 점수는 쓰지 않는다.
 */

export type ExtractedFrame = {
  at: number;
  blob: Blob;
  url: string;
};

export type VideoFrameMeta = {
  width: number;
  height: number;
  duration: number;
};

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.85;
const LOG = "[extractFrames]";

const PRIMARY_RATIOS = [0, 0.2, 0.4, 0.6, 0.8];
const ALT_RATIOS = [0.1, 0.3, 0.5, 0.7, 0.9];

function waitEvent(target: EventTarget, type: string, timeoutMs = 20_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${type}_timeout`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`${type}_error`));
    };
    function cleanup() {
      window.clearTimeout(timer);
      target.removeEventListener(type, onOk);
      target.removeEventListener("error", onErr);
    }
    target.addEventListener(type, onOk, { once: true });
    target.addEventListener("error", onErr, { once: true });
  });
}

function whenReady(video: HTMLVideoElement, event: string, minReadyState: number) {
  if (video.readyState >= minReadyState) return Promise.resolve();
  return waitEvent(video, event);
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function seekTo(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      console.warn(LOG, "seek skipped: duration 이 NaN 또는 0", { time, duration });
      reject(new Error("seek_nan"));
      return;
    }
    const target = Math.min(Math.max(0, time), Math.max(0, duration - 0.05));
    const timer = window.setTimeout(() => {
      cleanup();
      console.warn(LOG, "seeked 이벤트 없음", { target, currentTime: video.currentTime });
      reject(new Error("seek_timeout"));
    }, 15_000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      console.warn(LOG, "seek error", video.error);
      reject(new Error("seek_error"));
    };
    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
    }
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onErr, { once: true });
    if (Math.abs(video.currentTime - target) < 0.01) {
      video.currentTime = target < 0.05 ? Math.min(duration, target + 0.05) : Math.max(0, target - 0.05);
    }
    video.currentTime = target;
  });
}

function timeAt(duration: number, ratio: number) {
  if (ratio <= 0) {
    return Math.min(0.1, Math.max(0, duration - 0.05));
  }
  return Math.min(Math.max(0, duration * ratio), Math.max(0, duration - 0.05));
}

function attachVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.preload = "auto";
  video.controls = false;
  video.style.cssText =
    "position:fixed;left:-9999px;top:0;width:160px;height:90px;opacity:0;pointer-events:none;";
  document.body.appendChild(video);
  return video;
}

async function extractAtRatios(
  file: File,
  ratios: number[],
  onMeta?: (meta: VideoFrameMeta) => void,
  onProgress?: (done: number, total: number) => void
): Promise<ExtractedFrame[]> {
  const objectUrl = URL.createObjectURL(file);
  const video = attachVideo();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  try {
    const metaWait = whenReady(video, "loadedmetadata", HTMLMediaElement.HAVE_METADATA);
    video.src = objectUrl;
    video.load();
    await metaWait;

    const duration = video.duration;
    if (!duration || Number.isNaN(duration) || duration <= 0) {
      console.warn(LOG, "duration 이 NaN 또는 0", {
        duration,
        error: video.error,
        readyState: video.readyState
      });
      return [];
    }

    try {
      await video.play();
      video.pause();
    } catch (err) {
      console.warn(LOG, "play/pause 실패 (muted·playsInline 확인)", err, video.error);
    }

    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (width > 0 && height > 0) {
      onMeta?.({ width, height, duration });
    } else {
      console.warn(LOG, "해상도를 읽지 못함", { width, height, duration });
    }

    if (!ctx) {
      console.warn(LOG, "canvas context null");
      return [];
    }

    const frames: ExtractedFrame[] = [];

    for (let i = 0; i < ratios.length; i++) {
      const at = timeAt(duration, ratios[i]!);
      onProgress?.(i, ratios.length);
      try {
        await seekTo(video, at);
        await nextPaint();
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) {
          console.warn(LOG, "videoWidth/Height empty", { at, vw, vh });
          continue;
        }

        const scale = vw > MAX_WIDTH ? MAX_WIDTH / vw : 1;
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((next) => resolve(next), "image/jpeg", JPEG_QUALITY);
        });
        if (!blob) {
          console.warn(LOG, "toBlob 이 null", { at });
          continue;
        }
        frames.push({
          at,
          blob,
          url: URL.createObjectURL(blob)
        });
      } catch (err) {
        console.warn(LOG, "프레임 실패", { at, err });
      }
    }
    onProgress?.(ratios.length, ratios.length);

    if (frames.length === 0) {
      console.warn(LOG, "프레임 0장", {
        duration,
        error: video.error,
        readyState: video.readyState,
        file: { name: file.name, type: file.type, size: file.size }
      });
    }

    return frames;
  } catch (err) {
    console.warn(LOG, "코덱 또는 로드 실패", err, video.error, {
      file: { name: file.name, type: file.type, size: file.size }
    });
    return [];
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function extractFrames(
  file: File,
  _count = 5,
  onMeta?: (meta: VideoFrameMeta) => void,
  onProgress?: (done: number, total: number) => void
): Promise<ExtractedFrame[]> {
  return extractAtRatios(file, PRIMARY_RATIOS, onMeta, onProgress);
}

export async function extractFramesAlt(
  file: File,
  _count = 5,
  onMeta?: (meta: VideoFrameMeta) => void,
  onProgress?: (done: number, total: number) => void
): Promise<ExtractedFrame[]> {
  return extractAtRatios(file, ALT_RATIOS, onMeta, onProgress);
}

export function revokeFrameUrls(frames: ExtractedFrame[]) {
  for (const frame of frames) {
    URL.revokeObjectURL(frame.url);
  }
}

export function formatTimecode(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
