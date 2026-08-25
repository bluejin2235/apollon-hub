"use client";

import { useRef, useState } from "react";
import { uploadFile } from "@/lib/website/api";

export type UploadedMedia = {
  src: string;
  width: number | null;
  height: number | null;
  size: number;
  mime: string;
  name: string;
};

type Kind = "gallery" | "poster" | "loop-lg" | "loop-sm";

type Props = {
  workId: string;
  accept: "image" | "video" | "both";
  multiple?: boolean;
  disabled?: boolean;
  maxFiles?: number;
  kind?: Kind;
  label: string;
  onUploaded: (files: UploadedMedia[]) => void;
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const VIDEO_TYPES = new Set(["video/mp4"]);
const MAX_BYTES = 10 * 1024 * 1024;

function acceptAttr(accept: Props["accept"]) {
  if (accept === "image") return "image/jpeg,image/png,image/webp,image/avif";
  if (accept === "video") return "video/mp4";
  return "image/jpeg,image/png,image/webp,image/avif,video/mp4";
}

function isNear169(width: number, height: number) {
  if (!width || !height) return true;
  const ratio = width / height;
  return Math.abs(ratio - 16 / 9) < 0.08;
}

function readSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
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

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function ImageUploader({
  workId,
  accept,
  multiple = false,
  disabled,
  maxFiles,
  kind = "gallery",
  label,
  onUploaded
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list).slice(0, maxFiles ?? list.length);
    const ok: File[] = [];
    const nextWarnings: string[] = [];
    setError(null);

    for (const file of files) {
      const isImage = IMAGE_TYPES.has(file.type);
      const isVideo = VIDEO_TYPES.has(file.type);
      if (accept === "image" && !isImage) {
        setError(`${file.name}: jpeg/png/webp/avif 만 올릴 수 있습니다`);
        continue;
      }
      if (accept === "video" && !isVideo) {
        setError(`${file.name}: mp4 만 올릴 수 있습니다`);
        continue;
      }
      if (accept === "both" && !isImage && !isVideo) {
        setError(`${file.name}: 지원하지 않는 형식입니다`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name}: 10MB를 넘습니다`);
        continue;
      }

      const dims = await readSize(file);
      if (isImage && file.size > 2 * 1024 * 1024) {
        nextWarnings.push(`${file.name}: 2MB를 넘습니다. 가능하면 줄이세요.`);
      }
      if (isImage && dims && !isNear169(dims.width, dims.height) && kind !== "gallery") {
        nextWarnings.push(`${file.name}: 16:9가 아닙니다.`);
      }
      if (isImage && dims && !isNear169(dims.width, dims.height) && kind === "gallery") {
        nextWarnings.push(`${file.name}: 대표 이미지 기준 16:9가 아닙니다. 본문은 비율 자유입니다.`);
      }
      if (isVideo && kind === "loop-lg" && file.size > 1.5 * 1024 * 1024) {
        nextWarnings.push(`${file.name}: 배경 영상 lg 권장 1.5MB를 넘습니다.`);
      }
      if (isVideo && kind === "loop-sm" && file.size > 0.5 * 1024 * 1024) {
        nextWarnings.push(`${file.name}: 배경 영상 sm 권장 0.5MB를 넘습니다.`);
      }
      ok.push(file);
    }

    setWarnings(nextWarnings);
    if (ok.length === 0) return;

    const uploaded: UploadedMedia[] = [];
    try {
      for (let i = 0; i < ok.length; i++) {
        const file = ok[i]!;
        setProgress(`${i + 1} / ${ok.length} 올리는 중… ${file.name}`);
        const dims = await readSize(file);
        const path = `works/${workId}/${Date.now()}-${i}-${safeName(file.name)}`;
        const res = await uploadFile(file, "works", path);
        if (!res.ok) {
          setError(`${file.name}: ${res.error}`);
          continue;
        }
        uploaded.push({
          src: res.data.publicUrl || `/${res.data.path}`,
          width: res.data.width ?? dims?.width ?? null,
          height: res.data.height ?? dims?.height ?? null,
          size: res.data.size,
          mime: res.data.mime,
          name: file.name
        });
      }
    } finally {
      setProgress(null);
    }
    if (uploaded.length > 0) onUploaded(uploaded);
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled && e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
        className={`w-full rounded-lg border border-dashed px-3 py-3 text-sm ${
          drag ? "border-apollon-400 bg-apollon-50" : "border-slate-300 bg-slate-50 text-slate-600"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={acceptAttr(accept)}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {progress ? <p className="mt-1 text-xs text-slate-500">{progress}</p> : null}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      {warnings.map((w) => (
        <p key={w} className="mt-1 text-xs text-amber-700">
          {w}
        </p>
      ))}
    </div>
  );
}
