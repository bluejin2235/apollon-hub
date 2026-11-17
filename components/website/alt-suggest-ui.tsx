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
      {status === "kept" ? <span>직접 쓴 문장을 그대로 두었어요</span> : null}
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

/**
 * 대표 이미지를 새 사진으로 바꾼 뒤 남은 설명 — 「이전 사진 설명 · 확인 필요」.
 * 국문이 남아 있으면 공개가 막히고, 영문만이면 경고.
 */
export function AltReviewNotice({
  state,
  onKeep
}: {
  state: { ko: boolean; en: boolean };
  onKeep: (lang: "ko" | "en") => void;
}) {
  if (!state.ko && !state.en) return null;
  const rows: { lang: "ko" | "en"; label: string; tail: string }[] = [];
  if (state.ko) {
    rows.push({ lang: "ko", label: "국문", tail: "확인하기 전에는 공개할 수 없습니다" });
  }
  if (state.en) {
    rows.push({ lang: "en", label: "영문", tail: "확인하지 않아도 공개할 수 있습니다" });
  }
  return (
    <div className="alt-review mt-1 flex flex-col gap-1 text-[11px]">
      {rows.map((row) => (
        <div key={row.lang} className="flex flex-wrap items-center gap-2 text-amber-700">
          <span>
            {row.label} · 이전 사진 설명 · 확인 필요 — 사진을 바꾸기 전에 쓴 문장입니다. 새 사진에 맞게
            고치거나 그대로 쓸지 정해 주세요. {row.tail}
          </span>
          <button
            type="button"
            className="underline decoration-amber-300 underline-offset-2 hover:text-amber-900"
            onClick={() => onKeep(row.lang)}
          >
            이 설명 그대로 쓰기
          </button>
        </div>
      ))}
    </div>
  );
}
