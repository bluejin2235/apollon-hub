"use client";

export type PartialSaveState = "idle" | "dirty" | "saving" | "saved";

type Props = {
  state: PartialSaveState;
  disabled?: boolean;
  onClick: () => void;
};

/** 접이식 블록 — 즉시 저장 (태그·폴더 등) */
export function AutoSaveLabel() {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-400">
      자동 저장됨
    </span>
  );
}

/** 접이식 블록 오른쪽 위 부분 저장 */
export function PartialSaveBtn({ state, disabled, onClick }: Props) {
  const label =
    state === "saved"
      ? "방금 저장"
      : state === "dirty"
        ? "저장 안 함"
        : state === "saving"
          ? "저장 중..."
          : "부분 저장";

  const className =
    state === "dirty"
      ? "inline-flex items-center rounded-md border border-apollon-500 bg-apollon-50 px-2 py-1 text-[11px] font-semibold text-apollon-700 hover:bg-apollon-100 disabled:opacity-40"
      : state === "saved"
        ? "inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700"
        : "inline-flex items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40";

  return (
    <button
      type="button"
      disabled={disabled || state === "saving"}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={className}
    >
      {label}
    </button>
  );
}
