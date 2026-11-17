"use client";

import type { AltSuggestStatus } from "@/lib/website/alt-suggest-client";

export function AltSuggestStatusLine({
  status,
  onRewrite,
  canRewrite
}: {
  status: AltSuggestStatus;
  onRewrite?: () => void;
  canRewrite?: boolean;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
      {status === "loading" ? <span>AI가 설명 쓰는 중…</span> : null}
      {status === "filled" ? <span>AI가 썼어요 · 확인해 주세요</span> : null}
      {status === "failed" ? (
        <span className="text-rose-600">자동 설명을 못 썼어요. 직접 써 주세요</span>
      ) : null}
      {canRewrite && onRewrite && status !== "loading" ? (
        <button
          type="button"
          className="underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
          onClick={onRewrite}
        >
          AI로 다시 쓰기
        </button>
      ) : null}
    </div>
  );
}

export function confirmOverwriteAlt(hasExisting: boolean): boolean {
  if (!hasExisting) return true;
  if (typeof window === "undefined") return false;
  return window.confirm("지금 적힌 대체 텍스트를 지우고 AI가 다시 쓸까요?");
}
