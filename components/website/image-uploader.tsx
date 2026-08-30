"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Film, ImageIcon, X } from "lucide-react";
import { uploadFile } from "@/lib/website/api";
import { showToast } from "@/components/website/toast";
import {
  sanitizeUploadFilename,
  uploadObjectPath,
  type UploadBucket
} from "@/lib/website/upload-path";
import {
  insightKeyImageTooSmall,
  insightKeyImageWarnMessage,
  keyImageRejectMessage,
  validateKeyImageDimensions
} from "@/lib/website/key-image-rules";
import {
  bodyImageRejectMessage,
  bodyImageWarnMessage,
  validateBodyImageDimensions
} from "@/lib/website/body-image-rules";
import {
  formatImageUploadGuide,
  formatVideoUploadGuide,
  SPEC,
  SPEC_BYTES
} from "@/lib/website/spec";
import type { UploadNotice } from "@/lib/website/types";
import { fileName, mediaUrl } from "@/lib/website/work-detail";
import "@/components/website/ui/work-admin.css";

export type UploadedMedia = {
  src: string;
  width: number | null;
  height: number | null;
  size: number;
  mime: string;
  name: string;
};

type Kind = "gallery" | "poster" | "loop-lg" | "loop-sm" | "key" | "insight-key" | "body";

type Props = {
  bucket: UploadBucket;
  folder: string;
  accept: "image" | "video" | "both";
  multiple?: boolean;
  disabled?: boolean;
  maxFiles?: number;
  kind?: Kind;
  /** kind === "body" 일 때 블록 preset. portrait-text 만 비율 검사를 건너뛴다. */
  bodyPreset?: string;
  guide?: ReactNode;
  siteUrl?: string;
  value?: string | null;
  existingNames?: string[];
  onUploaded: (files: UploadedMedia[]) => void;
  /** 업로드 직전, 로컬에서 통과한 파일 (장면 추출 등) */
  onLocalFiles?: (files: File[]) => void;
  onClear?: () => void;
  /** 워크 어드민 목업 파일카드 / 점선 업로드 */
  appearance?: "default" | "filecard";
  emptyHint?: string;
};

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif"
]);
const VIDEO_TYPES = new Set(["video/mp4"]);
const IMAGE_MAX_BYTES = SPEC_BYTES.image;
const GIF_MAX_BYTES = SPEC_BYTES.gif;
const VIDEO_MAX_BYTES = SPEC_BYTES.video;

const IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.avif,.gif,image/jpeg,image/png,image/webp,image/avif,image/gif";
const VIDEO_ACCEPT = ".mp4,video/mp4";
function formatGuideText(accept: Props["accept"]) {
  if (accept === "video") return formatVideoUploadGuide();
  if (accept === "image") return formatImageUploadGuide();
  return `${formatImageUploadGuide()}. ${formatVideoUploadGuide()}`;
}
const VIDEO_TOO_LARGE = {
  message: "홈페이지에 직접 올리기에는 큽니다.",
  advice: [
    `D-M · 프리미어에서 ${SPEC.detailMovie.w} × ${SPEC.detailMovie.h} · VBR 2패스 · 목표 8 Mbps · 최대 14 Mbps 로 다시내면 화질을 거의 유지하면서 용량이 크게 줄어듭니다.`,
    "인코딩은 소프트웨어(CPU)를 쓰세요. 하드웨어보다 같은 용량에서 화질이 좋습니다.",
    "10분이 넘는 영상이라면 유튜브에 올리고 주소를 붙여넣는 편이 낫습니다."
  ]
};
const IMAGE_TOO_LARGE = {
  message: `이미지는 ${SPEC.limits.image}MB 까지 올릴 수 있습니다.`,
  advice: [
    "원본이 너무 크면 포토샵 등으로 줄여 주세요.",
    "올리면 서버에서 자동으로 맞춰 저장합니다."
  ]
};
const GIF_TOO_LARGE = {
  message: "GIF 가 너무 큽니다.",
  advice: ["MP4 로 바꾸면 보통 10분의 1 이하가 됩니다. 위 안내를 참고하세요."]
};

type UploadError = { fileName: string; message: string; advice: string[] };

type ProgressState = {
  fileName: string;
  percent: number;
  loaded: number;
  total: number;
  index: number;
  count: number;
  overallPercent: number;
};

function acceptAttr(accept: Props["accept"]) {
  if (accept === "image") return IMAGE_ACCEPT;
  if (accept === "video") return VIDEO_ACCEPT;
  return `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;
}

function isImageFile(file: File) {
  if (IMAGE_TYPES.has(file.type)) return true;
  return /\.(jpe?g|png|webp|avif|gif)$/i.test(file.name);
}

function isVideoFile(file: File) {
  if (VIDEO_TYPES.has(file.type)) return true;
  return /\.mp4$/i.test(file.name);
}

function isGifFile(file: File) {
  if (file.type === "image/gif") return true;
  return /\.gif$/i.test(file.name);
}

function limitForFile(file: File): { limit: number; tooLarge: { message: string; advice: string[] } } {
  if (isVideoFile(file)) return { limit: VIDEO_MAX_BYTES, tooLarge: VIDEO_TOO_LARGE };
  if (isGifFile(file)) return { limit: GIF_MAX_BYTES, tooLarge: GIF_TOO_LARGE };
  return { limit: IMAGE_MAX_BYTES, tooLarge: IMAGE_TOO_LARGE };
}

function adviceFromDetails(details: unknown): { message: string; advice: string[] } | null {
  if (!details || typeof details !== "object") return null;
  const rec = details as Record<string, unknown>;
  const message = typeof rec.message === "string" ? rec.message : null;
  const advice = Array.isArray(rec.advice)
    ? rec.advice.filter((item): item is string => typeof item === "string")
    : [];
  if (!message && advice.length === 0) return null;
  return { message: message ?? "올릴 수 없습니다", advice };
}

function formatBytes(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function displayName(src: string | null | undefined): string {
  return fileName(src);
}

function isVideoSrc(src: string, accept: Props["accept"]) {
  if (accept === "video") return /\.mp4(?:$|\?)/i.test(src) || !/^https?:\/\//i.test(src);
  return /\.mp4(?:$|\?)/i.test(src);
}

function readSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|avif|gif)$/i.test(file.name)) {
    return Promise.resolve(null);
  }
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

function noticeKey(notice: UploadNotice, fileKey: string) {
  return `${notice.kind}:${fileKey}`;
}

function UploadNoticeBox({
  notice,
  onDismiss
}: {
  notice: UploadNotice;
  onDismiss: () => void;
}) {
  const [openHow, setOpenHow] = useState(false);
  const high = notice.severity === "high";
  const lines = notice.lines ?? [];
  const how = notice.how ?? [];

  return (
    <div
      className={`relative mt-2 rounded-lg border px-3 py-2.5 text-sm ${
        high
          ? "border-orange-300 bg-orange-50 text-orange-950"
          : "border-slate-200 bg-slate-50 text-slate-800"
      }`}
    >
      <button
        type="button"
        aria-label="닫기"
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded p-0.5 text-slate-500 hover:bg-black/5 hover:text-slate-800"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="pr-6 font-semibold">{notice.title}</p>
      {lines.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {how.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpenHow((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold underline decoration-slate-400"
          >
            MP4 로 만드는 법
            <ChevronDown className={`h-3.5 w-3.5 transition ${openHow ? "rotate-180" : ""}`} />
          </button>
          {openHow ? (
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed">
              {how.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ErrorBox({ error, onDismiss }: { error: UploadError; onDismiss: () => void }) {
  return (
    <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-900">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">
          ⚠ {error.fileName}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded border border-rose-200 bg-white px-2 py-0.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
        >
          닫기
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed">{error.message}</p>
      {error.advice.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs leading-relaxed">
          {error.advice.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ProgressBox({
  progress,
  onCancel
}: {
  progress: ProgressState;
  onCancel: () => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{progress.fileName}</p>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          취소
        </button>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-apollon-500 transition-[width] duration-150"
          style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        올리는 중 {progress.percent}% · {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
      </p>
      {progress.count > 1 ? (
        <p className="mt-0.5 text-xs text-slate-500">
          {progress.count}장 중 {progress.index}번째 · 전체 {progress.overallPercent}%
        </p>
      ) : null}
    </div>
  );
}

export function ImageUploader({
  bucket,
  folder,
  accept,
  multiple = false,
  disabled,
  maxFiles,
  kind = "gallery",
  bodyPreset,
  guide,
  siteUrl,
  value,
  existingNames,
  onUploaded,
  onLocalFiles,
  onClear,
  appearance = "default",
  emptyHint
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<UploadError | null>(null);
  const [notice, setNotice] = useState<{ payload: UploadNotice; key: string } | null>(null);
  const dismissedNotices = useRef(new Set<string>());
  const [meta, setMeta] = useState<{
    src: string;
    width: number | null;
    height: number | null;
    size: number | null;
    name: string;
  } | null>(null);

  const filled = Boolean(value) && !multiple;
  const previewSrc = value && siteUrl ? mediaUrl(siteUrl, value) : value || null;
  const video = Boolean(value && isVideoSrc(value, accept));

  useEffect(() => {
    if (!value) {
      setMeta(null);
      return;
    }
    setMeta((prev) => {
      if (prev?.src === value) return prev;
      return {
        src: value,
        width: null,
        height: null,
        size: null,
        name: displayName(value)
      };
    });
    if (!previewSrc || video) return;
    if (/^https?:\/\//i.test(value) && !/\.(jpe?g|png|webp|avif|gif)(?:$|\?)/i.test(value)) {
      return;
    }
    const img = new Image();
    img.onload = () => {
      setMeta((prev) =>
        prev && prev.src === value
          ? { ...prev, width: img.naturalWidth, height: img.naturalHeight }
          : prev
      );
    };
    img.src = previewSrc;
  }, [previewSrc, value, video]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function openPicker() {
    if (disabled || progress) return;
    inputRef.current?.click();
  }

  function cancelUpload() {
    abortRef.current?.abort();
  }

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list).slice(0, maxFiles ?? list.length);
    const ok: File[] = [];
    const nextWarnings: string[] = [];
    setError(null);
    setNotice(null);

    for (const file of files) {
      const isImage = isImageFile(file);
      const isVideo = isVideoFile(file);
      if (accept === "image" && !isImage) {
        setError({
          fileName: file.name,
          message: "jpeg/png/webp/avif/gif 만 올릴 수 있습니다",
          advice: []
        });
        continue;
      }
      if (accept === "video" && !isVideo) {
        setError({
          fileName: file.name,
          message: "mp4 만 올릴 수 있습니다",
          advice: []
        });
        continue;
      }
      if (accept === "both" && !isImage && !isVideo) {
        setError({
          fileName: file.name,
          message: "지원하지 않는 형식입니다",
          advice: []
        });
        continue;
      }
      const { limit, tooLarge } = limitForFile(file);
      if (file.size > limit) {
        setError({
          fileName: file.name,
          message: tooLarge.message,
          advice: tooLarge.advice
        });
        continue;
      }

      if (isVideo && kind === "loop-lg" && file.size > SPEC_BYTES.thumbLarge) {
        nextWarnings.push(
          `${file.name}: T-L 권장 ${SPEC.thumbLarge.maxMB}MB를 넘습니다.`
        );
      }
      if (isVideo && kind === "loop-sm" && file.size > SPEC_BYTES.thumbSmall) {
        nextWarnings.push(
          `${file.name}: T-S 권장 ${SPEC.thumbSmall.maxMB}MB를 넘습니다.`
        );
      }

      if (kind === "key" && isImage) {
        const dims = await readSize(file);
        if (!dims?.width || !dims.height) {
          setError({
            fileName: file.name,
            message: "이미지 크기를 읽지 못했습니다. 다른 파일로 다시 시도해 주세요.",
            advice: []
          });
          continue;
        }
        const reject = validateKeyImageDimensions(dims.width, dims.height);
        if (reject) {
          setError({
            fileName: file.name,
            message: keyImageRejectMessage(reject),
            advice: []
          });
          continue;
        }
      }

      if (kind === "insight-key" && isImage) {
        const dims = await readSize(file);
        if (dims?.width && dims.height && insightKeyImageTooSmall(dims.width, dims.height)) {
          nextWarnings.push(`${file.name}: ${insightKeyImageWarnMessage(dims.width, dims.height)}`);
        }
      }

      if (kind === "body" && isImage) {
        const dims = await readSize(file);
        if (!dims?.width || !dims.height) {
          setError({
            fileName: file.name,
            message: "이미지 크기를 읽지 못했습니다. 다른 파일로 다시 시도해 주세요.",
            advice: []
          });
          continue;
        }
        const reject = validateBodyImageDimensions(bodyPreset, dims.width, dims.height);
        if (reject) {
          setError({
            fileName: file.name,
            message: bodyImageRejectMessage(reject),
            advice: []
          });
          continue;
        }
        const warn = bodyImageWarnMessage(bodyPreset, dims.width, dims.height);
        if (warn) nextWarnings.push(`${file.name}: ${warn}`);
      }

      ok.push(file);
    }

    setWarnings(nextWarnings);
    if (ok.length === 0) return;

    onLocalFiles?.(ok);

    const used = new Set(
      [...(existingNames ?? []), ...(value ? [fileName(value)] : [])]
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
    );
    const uploaded: UploadedMedia[] = [];
    let latestNotice: { payload: UploadNotice; key: string } | null = null;
    const totalBytes = ok.reduce((sum, file) => sum + file.size, 0);
    let completedBytes = 0;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for (let i = 0; i < ok.length; i++) {
        if (controller.signal.aborted) break;
        const file = ok[i]!;
        setProgress({
          fileName: file.name,
          percent: 0,
          loaded: 0,
          total: file.size,
          index: i + 1,
          count: ok.length,
          overallPercent:
            totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : 0
        });
        const dims = await readSize(file);
        const filename = sanitizeUploadFilename(file.name, used);
        used.add(filename.toLowerCase());
        const path = uploadObjectPath(folder, filename);
        const res = await uploadFile(file, bucket, path, {
          signal: controller.signal,
          fields: kind === "key" || kind === "insight-key" ? { role: "key" } : undefined,
          onProgress: (p) => {
            const overall =
              totalBytes > 0
                ? Math.round(((completedBytes + p.loaded) / totalBytes) * 100)
                : p.percent;
            setProgress({
              fileName: file.name,
              percent: p.percent,
              loaded: p.loaded,
              total: p.total || file.size,
              index: i + 1,
              count: ok.length,
              overallPercent: overall
            });
          }
        });

        if (!res.ok) {
          if (res.error === "aborted") {
            setError({
              fileName: file.name,
              message: "업로드를 취소했습니다",
              advice: []
            });
            break;
          }
          const parsed = adviceFromDetails(res.details);
          setError({
            fileName: file.name,
            message: parsed?.message ?? res.error,
            advice: parsed?.advice ?? []
          });
          break;
        }

        completedBytes += file.size;
        uploaded.push({
          src: res.data.publicUrl || `/${res.data.path}`,
          width: res.data.width ?? dims?.width ?? null,
          height: res.data.height ?? dims?.height ?? null,
          size: res.data.size,
          mime: res.data.mime,
          name: filename
        });
        if (res.notice) {
          const key = noticeKey(res.notice, res.data.path || filename);
          if (!dismissedNotices.current.has(key)) {
            latestNotice = { payload: res.notice, key };
          }
        }
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }

    if (uploaded.length > 0) {
      const last = uploaded[uploaded.length - 1]!;
      setMeta({
        src: last.src,
        width: last.width,
        height: last.height,
        size: last.size,
        name: last.name
      });
      onUploaded(uploaded);
      if (latestNotice) {
        setNotice(latestNotice);
      } else {
        showToast({
          message: uploaded.length === 1 ? "올렸습니다" : `${uploaded.length}장을 올렸습니다`,
          tone: "ok",
          durationMs: 2000
        });
      }
    } else if (latestNotice) {
      setNotice(latestNotice);
    }
  }

  const formatGuide = (
    <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-400">
      {formatGuideText(accept)}
    </p>
  );

  const input = (
    <input
      ref={inputRef}
      type="file"
      className="sr-only"
      accept={acceptAttr(accept)}
      multiple={multiple}
      disabled={disabled || Boolean(progress)}
      onChange={(e) => {
        if (e.target.files?.length) void handleFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  const topAlerts = (
    <>
      {error ? <ErrorBox error={error} onDismiss={() => setError(null)} /> : null}
      {progress ? <ProgressBox progress={progress} onCancel={cancelUpload} /> : null}
      {notice ? (
        <UploadNoticeBox
          notice={notice.payload}
          onDismiss={() => {
            dismissedNotices.current.add(notice.key);
            setNotice(null);
          }}
        />
      ) : null}
    </>
  );

  const bottomNotes = (
    <>
      {warnings.map((w) => (
        <p key={w} className="mt-1 text-xs text-amber-700">
          {w}
        </p>
      ))}
    </>
  );

  const thumb =
    kind === "key"
      ? { width: 172, height: 97, video: false }
      : kind === "insight-key"
        ? { width: 150, height: meta?.height && meta.width ? Math.round((150 * meta.height) / meta.width) : 150, video: false }
        : { width: 106, height: 60, video: true };

  if (filled && value) {
    const dims =
      meta?.width && meta?.height ? `${meta.width}×${meta.height}` : "";
    const size = formatBytes(meta?.size);
    const name = meta?.name || displayName(value);
    const ext = name.split(".").pop()?.toUpperCase() ?? "";
    const info = [name, dims, size].filter(Boolean).join(" · ");
    const fm = appearance === "filecard" ? dims : [dims, size, ext].filter(Boolean).join(" · ");
    const preview = (
      <>
        {previewSrc && video ? (
          <video src={previewSrc} muted playsInline />
        ) : previewSrc && !/^https?:\/\//i.test(value) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="" />
        ) : previewSrc && /\.(jpe?g|png|webp|avif|gif)(?:$|\?)/i.test(value) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="" />
        ) : (
          dims || "미리보기"
        )}
      </>
    );

    if (appearance === "filecard") {
      const btn = video ? "btn xs" : "btn sm";
      return (
        <div className="wa">
          {input}
          {topAlerts}
          <div className="filecard">
            <div
              className={thumb.video || video ? "ph v" : "ph"}
              style={{ width: thumb.width, height: thumb.height }}
            >
              {preview}
            </div>
            <div className="meta">
              <div className="fn">
                {[name, dims].filter(Boolean).join(" · ") || "파일"}
              </div>
              <div className="acts">
                <button
                  type="button"
                  className={btn}
                  disabled={disabled || Boolean(progress)}
                  onClick={openPicker}
                >
                  바꾸기
                </button>
                {onClear ? (
                  <button
                    type="button"
                    className={`${btn} dg`}
                    disabled={disabled || Boolean(progress)}
                    onClick={onClear}
                  >
                    삭제
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          {bottomNotes}
        </div>
      );
    }

    return (
      <div>
        {input}
        {topAlerts}
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
          <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-[10px] text-slate-400">
            {previewSrc && video ? (
              <video src={previewSrc} muted playsInline className="h-full w-full object-cover" />
            ) : previewSrc && !/^https?:\/\//i.test(value) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="" className="h-full w-full object-cover" />
            ) : previewSrc && /\.(jpe?g|png|webp|avif|gif)(?:$|\?)/i.test(value) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              "미리보기"
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-800">{info || "파일"}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={disabled || Boolean(progress)}
                onClick={openPicker}
                className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                바꾸기
              </button>
              {onClear ? (
                <button
                  type="button"
                  disabled={disabled || Boolean(progress)}
                  onClick={onClear}
                  className="inline-flex items-center rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                >
                  삭제
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {bottomNotes}
      </div>
    );
  }

  const emptyBlock = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !progress) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!disabled && !progress && e.dataTransfer.files.length) {
          void handleFiles(e.dataTransfer.files);
        }
      }}
      onClick={() => {
        if (appearance === "filecard" && !disabled && !progress) openPicker();
      }}
      className={
        appearance === "filecard"
          ? `up${accept === "video" ? " sm" : ""}${disabled || progress ? " is-off" : ""}`
          : `flex flex-col items-center rounded-lg border border-dashed px-3 py-6 text-center ${
              drag ? "border-apollon-400 bg-apollon-50" : "border-slate-300 bg-slate-50"
            } ${disabled || progress ? "opacity-40" : ""}`
      }
      style={
        appearance === "filecard" && drag
          ? { borderColor: "var(--ap)", background: "var(--apbg)" }
          : undefined
      }
    >
      {appearance === "filecard" ? (
        <>
          <span className="ic">⬆</span>
          파일을 끌어다 놓거나
          <br />
          <span className="b">파일 선택</span>
          {emptyHint ? <div className="g">{emptyHint}</div> : null}
        </>
      ) : (
        <>
          {accept === "video" ? (
            <Film className="mb-2 h-6 w-6 text-slate-400" />
          ) : (
            <ImageIcon className="mb-2 h-6 w-6 text-slate-400" />
          )}
          <p className="mb-2 text-sm text-slate-600">파일을 끌어다 놓거나</p>
          <button
            type="button"
            disabled={disabled || Boolean(progress)}
            onClick={(e) => {
              e.stopPropagation();
              openPicker();
            }}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            파일 선택
          </button>
          {formatGuide}
          {guide ? <div className="mt-2 max-w-md text-xs leading-relaxed text-slate-400">{guide}</div> : null}
        </>
      )}
    </div>
  );

  return (
    <div className={appearance === "filecard" ? "wa" : undefined}>
      {input}
      {topAlerts}
      {emptyBlock}
      {bottomNotes}
    </div>
  );
}
