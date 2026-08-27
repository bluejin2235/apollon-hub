import { getPreviewUrl } from "@/lib/website/api";

export type PreviewTarget = {
  workId: string;
  sectionId?: string;
  blockId?: string;
  locale?: "ko" | "en";
};

export const PREVIEW_POPUP_BLOCKED =
  "팝업이 차단되었습니다. 주소창 오른쪽에서 허용해 주세요.";

const PREVIEW_WINDOW_NAME = "apollon-preview";
const PREVIEW_FEATURES = "width=1440,height=900";
const REFRESH_DEBOUNCE_MS = 300;

let previewWin: Window | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function websiteOrigin() {
  const raw = process.env.NEXT_PUBLIC_WEBSITE_ORIGIN?.trim() || "http://localhost:3100";
  return raw.replace(/\/$/, "");
}

export function isPreviewOpen() {
  return Boolean(previewWin && !previewWin.closed);
}

export async function openPreview(target: PreviewTarget): Promise<boolean> {
  const res = await getPreviewUrl(target);
  if (!res.ok) {
    throw new Error(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
  }

  const url = res.data.url;
  if (previewWin && !previewWin.closed) {
    previewWin.location.href = url;
    previewWin.focus();
    return true;
  }

  previewWin = window.open(url, PREVIEW_WINDOW_NAME, PREVIEW_FEATURES);
  if (!previewWin) {
    return false;
  }
  previewWin.focus();
  return true;
}

export function refreshPreview() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (!previewWin || previewWin.closed) return;
    previewWin.postMessage({ type: "apollon-preview-refresh" }, websiteOrigin());
  }, REFRESH_DEBOUNCE_MS);
}
