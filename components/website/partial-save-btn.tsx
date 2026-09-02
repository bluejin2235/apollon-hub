"use client";

export type PartialSaveState = "idle" | "dirty" | "saving" | "saved";

type Props = {
  state: PartialSaveState;
  disabled?: boolean;
  onClick: () => void;
  /** 기본 「부분 저장」. 하단은 「전체 저장」 */
  label?: string;
};

/** 접이식 블록 — 즉시 저장 (태그·폴더 등) */
export function AutoSaveLabel() {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-400">
      자동 저장됨
    </span>
  );
}

function statusText(state: PartialSaveState): string | null {
  if (state === "dirty") return "저장할 것이 있습니다";
  if (state === "saved") return "저장되었습니다";
  return null;
}

/** 버튼 문구는 고정. 상태는 옆 글자 */
export function PartialSaveBtn({
  state,
  disabled,
  onClick,
  label = "부분 저장"
}: Props) {
  const status = statusText(state);
  const emphasize = state === "dirty";
  const className = emphasize
    ? "inline-flex items-center rounded-md border border-apollon-500 bg-apollon-50 px-2 py-1 text-[11px] font-semibold text-apollon-700 hover:bg-apollon-100 disabled:opacity-40"
    : "inline-flex items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || state === "saving" || state === "idle" || state === "saved"}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className={className}
      >
        {label}
      </button>
      {status ? (
        <span
          className={
            state === "dirty"
              ? "text-[11px] font-medium text-amber-700"
              : "text-[11px] font-medium text-emerald-700"
          }
        >
          {status}
        </span>
      ) : null}
    </span>
  );
}
