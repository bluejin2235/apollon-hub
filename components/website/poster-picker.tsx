"use client";

import { formatTimecode, type ExtractedFrame } from "@/lib/website/video-thumbs";

type Props = {
  frames: ExtractedFrame[];
  onPick: (blob: Blob, at: number) => void;
  onUpload: () => void;
  onRedraw?: () => void;
  busy?: boolean;
  extracting?: boolean;
  failed?: boolean;
  progress?: { done: number; total: number } | null;
  error?: string | null;
};

export function PosterPicker({
  frames,
  onPick,
  onUpload,
  onRedraw,
  busy,
  extracting,
  failed,
  progress,
  error
}: Props) {
  if (extracting) {
    const pct =
      progress && progress.total > 0
        ? Math.round((progress.done / progress.total) * 100)
        : null;
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">장면을 찾는 중…</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-apollon-400 transition-[width]"
            style={{ width: pct == null ? "40%" : `${pct}%` }}
          />
        </div>
        {progress && progress.total > 0 ? (
          <p className="mt-1.5 text-[11px] text-slate-400">
            {progress.done} / {progress.total}
          </p>
        ) : null}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
        <p className="text-amber-800">
          이 영상에서는 장면을 자동으로 뽑지 못했습니다. 직접 올려주세요.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {onRedraw ? (
            <button
              type="button"
              onClick={onRedraw}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              다시 뽑기
            </button>
          ) : null}
          <button
            type="button"
            onClick={onUpload}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            직접 올리기
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      </div>
    );
  }

  if (frames.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <p className="mb-2 text-sm font-semibold text-slate-900">재생 전 이미지를 고르세요</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {frames.map((frame, index) => (
          <button
            key={`${frame.at}-${index}`}
            type="button"
            disabled={busy}
            onClick={() => onPick(frame.blob, frame.at)}
            className="w-36 shrink-0 overflow-hidden rounded-md border-2 border-transparent bg-slate-100 text-left hover:border-slate-300 disabled:opacity-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frame.url} alt="" className="aspect-video w-full object-cover" />
            <span className="block px-1.5 py-1 text-center text-[11px] text-slate-600">
              {formatTimecode(frame.at)}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {onRedraw ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRedraw}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            다시 뽑기
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onUpload}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          직접 올리기
        </button>
      </div>
      {busy ? <p className="mt-2 text-xs text-slate-500">저장하는 중…</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
