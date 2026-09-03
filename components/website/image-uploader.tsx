"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Film, ImageIcon, X } from "lucide-react";
import { uploadFile, uploadGif, uploadVideo, type SignedUploadKind } from "@/lib/website/api";
import { showToast } from "@/components/website/toast";
import { formatBytes } from "@/lib/website/image-long-edge";
import { prepareImageForUpload } from "@/lib/website/prepare-upload-image";
import { describeUploadError } from "@/lib/website/upload-error";
import {
  newStoredFilename,
  uploadObjectPath,
  type UploadBucket
} from "@/lib/website/upload-path";
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
  /**
   * 영상·GIF 직접 업로드 대상.
   * contentType+contentId 권장. workId 는 워크 전용 예전 인자.
   */
  contentType?: "work" | "insight";
  contentId?: string;
  /** @deprecated contentType="work" + contentId 로 바꿔 주세요 */
  workId?: string;
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
  /** 파일카드 「바꾸기」 앞에 붙는 버튼 */
  extraActions?: ReactNode;
  /** 파일카드 미리보기를 숨기고 버튼만 */
  hideThumb?: boolean;
};

const VIDEO_TYPES = new Set(["video/mp4"]);
const VIDEO_MAX_BYTES = SPEC_BYTES.video;
const GIF_MAX_BYTES = 50 * 1024 * 1024;

const IMAGE_ACCEPT = "image/*,.heic,.heif,image/heic,image/heif";
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

type UploadError = { fileName: string; message: string; advice: string[] };

type ProgressState = {
  fileName: string;
  phase: "shrink" | "upload";
  percent: number;
  loaded: number;
  total: number;
  index: number;
  count: number;
  overallPercent: number;
  shrinkLine: string | null;
};

function acceptAttr(accept: Props["accept"]) {
  if (accept === "image") return IMAGE_ACCEPT;
  if (accept === "video") return VIDEO_ACCEPT;
  return `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;
}

function isVideoFile(file: File) {
  if (VIDEO_TYPES.has(file.type) || file.type.startsWith("video/")) return true;
  return /\.mp4$/i.test(file.name);
}

function isGifFile(file: File) {
  if (file.type === "image/gif") return true;
  return /\.gif$/i.test(file.name);
}

function isImageFile(file: File) {
  if (isVideoFile(file)) return false;
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|avif|gif|heic|heif|bmp|tif|tiff)$/i.test(file.name);
}

function extForUpload(file: File) {
  if (file.type === "image/gif" || /\.gif$/i.test(file.name)) return "gif";
  if (isVideoFile(file)) return "mp4";
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "jpg";
  const match = /\.([a-z0-9]+)$/i.exec(file.name);
  if (match?.[1]) return match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  return "jpg";
}

function displayName(src: string | null | undefined): string {
  return fileName(src);
}

function isVideoSrc(src: string, accept: Props["accept"]) {
  if (accept === "video") return /\.mp4(?:$|\?)/i.test(src) || !/^https?:\/\//i.test(src);
  return /\.mp4(?:$|\?)/i.test(src);
}

function signedKindFor(kind: Kind, accept: Props["accept"]): SignedUploadKind {
  if (kind === "loop-lg") return "loop_lg";
  if (kind === "loop-sm") return "loop_sm";
  if (accept === "video") return "video";
  return "video";
}

function resolveSignedTarget(props: {
  contentType?: "work" | "insight";
  contentId?: string;
  workId?: string;
}): { contentType: "work" | "insight"; contentId: string } | null {
  if (props.contentType && props.contentId) {
    return { contentType: props.contentType, contentId: props.contentId };
  }
  if (props.workId) {
    return { contentType: "work", contentId: props.workId };
  }
  return null;
}

function prepareKind(kind: Kind): "key" | "body" | "insight-key" {
  if (kind === "insight-key") return "insight-key";
  if (kind === "key" || kind === "poster") return "key";
  return "body";
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

function ErrorBox({
  error,
  onDismiss,
  onRetry
}: {
  error: UploadError;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
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
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
        >
          다시 시도
        </button>
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
  const label = progress.phase === "shrink" ? "줄이는 중" : "올리는 중";
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
          className={`h-full rounded-full bg-apollon-500 transition-[width] duration-150 ${
            progress.percent >= 100
              ? "w-full"
              : progress.percent >= 75
                ? "w-3/4"
                : progress.percent >= 50
                  ? "w-1/2"
                  : progress.percent >= 25
                    ? "w-1/4"
                    : progress.phase === "shrink"
                      ? "w-1/12"
                      : "w-0"
          }`}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {label}
        {progress.phase === "upload"
          ? ` ${progress.percent}% · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
          : ""}
      </p>
      {progress.shrinkLine ? (
        <p className="mt-0.5 text-xs text-slate-500">{progress.shrinkLine}</p>
      ) : null}
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
  contentType,
  contentId,
  workId,
  multiple = false,
  disabled,
  maxFiles,
  kind = "gallery",
  guide,
  siteUrl,
  value,
  existingNames,
  onUploaded,
  onLocalFiles,
  onClear,
  appearance = "default",
  emptyHint,
  extraActions,
  hideThumb
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryFilesRef = useRef<File[] | null>(null);
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
    retryFilesRef.current = files;
    const ok: File[] = [];
    const nextWarnings: string[] = [];
    setError(null);
    setNotice(null);

    for (const file of files) {
      const isImage = isImageFile(file);
      const isVideo = isVideoFile(file);
      if (accept === "image" && isVideo) {
        setError({
          fileName: file.name,
          message: "이미지가 아닙니다",
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
          message: "이미지 또는 MP4 가 아닙니다",
          advice: []
        });
        continue;
      }
      if (isVideo && file.size > VIDEO_MAX_BYTES) {
        setError({
          fileName: file.name,
          message: VIDEO_TOO_LARGE.message,
          advice: VIDEO_TOO_LARGE.advice
        });
        continue;
      }
      if (isGifFile(file) && file.size > GIF_MAX_BYTES) {
        setError({
          fileName: file.name,
          message: "GIF 가 너무 큽니다 (한도 50MB).",
          advice: ["MP4 로 바꾸면 보통 10분의 1 이하가 됩니다."]
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
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for (let i = 0; i < ok.length; i++) {
        if (controller.signal.aborted) break;
        const original = ok[i]!;
        let send = original;
        let shrinkLine: string | null = null;
        let preparedWidth: number | null = null;
        let preparedHeight: number | null = null;

        if (isImageFile(original)) {
          setProgress({
            fileName: original.name,
            phase: "shrink",
            percent: 8,
            loaded: 0,
            total: original.size,
            index: i + 1,
            count: ok.length,
            overallPercent: Math.round((i / ok.length) * 100),
            shrinkLine: null
          });
          const prepared = await prepareImageForUpload(original, prepareKind(kind));
          if (!prepared.ok) {
            setError({
              fileName: original.name,
              message: prepared.error,
              advice: []
            });
            break;
          }
          send = prepared.data.file;
          shrinkLine = prepared.data.line;
          preparedWidth = prepared.data.to.width;
          preparedHeight = prepared.data.to.height;
        }

        setProgress({
          fileName: original.name,
          phase: "upload",
          percent: 0,
          loaded: 0,
          total: send.size,
          index: i + 1,
          count: ok.length,
          overallPercent: Math.round((i / ok.length) * 100),
          shrinkLine
        });

        const signedTarget = resolveSignedTarget({ contentType, contentId, workId });

        if (isVideoFile(original) && !signedTarget) {
          setError({
            fileName: original.name,
            message: "콘텐츠가 없어 영상을 직접 올릴 수 없습니다",
            advice: []
          });
          break;
        }

        if (isGifFile(original) && !signedTarget) {
          setError({
            fileName: original.name,
            message: "콘텐츠가 없어 GIF 를 직접 올릴 수 없습니다",
            advice: []
          });
          break;
        }

        const filename = newStoredFilename(extForUpload(send), used);
        used.add(filename.toLowerCase());
        const onProgress = (p: { percent: number; loaded: number; total: number }) => {
          setProgress({
            fileName: original.name,
            phase: "upload",
            percent: p.percent,
            loaded: p.loaded,
            total: p.total || send.size,
            index: i + 1,
            count: ok.length,
            overallPercent: Math.round(((i + p.percent / 100) / ok.length) * 100),
            shrinkLine
          });
        };

        const res =
          isVideoFile(original) && signedTarget
            ? await uploadVideo(send, signedTarget, signedKindFor(kind, accept), {
                signal: controller.signal,
                onProgress
              })
            : isGifFile(original) && signedTarget
              ? await uploadGif(send, signedTarget, folder, {
                  signal: controller.signal,
                  onProgress
                })
              : await uploadFile(send, bucket, uploadObjectPath(folder, filename), {
                  signal: controller.signal,
                  fields:
                    kind === "insight-key"
                      ? { role: "insight-key" }
                      : kind === "key" || kind === "poster"
                        ? { role: "key" }
                        : undefined,
                  onProgress
                });

        if (!res.ok) {
          const parsed = describeUploadError(res.error, res.status, res.details);
          setError({
            fileName: original.name,
            message: parsed.message,
            advice: parsed.advice
          });
          break;
        }

        uploaded.push({
          src: res.data.publicUrl || `/${res.data.path}`,
          width: res.data.width ?? preparedWidth,
          height: res.data.height ?? preparedHeight,
          size: res.data.size,
          mime: res.data.mime,
          name: fileName(res.data.path || filename)
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

  const formatGuide =
    kind === "body" ? null : (
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
      {error ? (
        <ErrorBox
          error={error}
          onDismiss={() => setError(null)}
          onRetry={
            retryFilesRef.current
              ? () => {
                  const next = retryFilesRef.current;
                  if (next) void handleFiles(next);
                }
              : undefined
          }
        />
      ) : null}
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
            {hideThumb ? null : (
              <div
                className={thumb.video || video ? "ph v" : "ph"}
                style={{ width: thumb.width, height: thumb.height }}
              >
                {preview}
              </div>
            )}
            <div className="meta">
              <div className="fn">
                {[name, dims].filter(Boolean).join(" · ") || "파일"}
              </div>
              <div className="acts">
                {extraActions}
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
