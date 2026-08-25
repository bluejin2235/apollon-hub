"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText: string;
  confirmWord?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  confirmWord,
  danger,
  onConfirm,
  onCancel
}: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const titleId = useId();
  const wordOk = !confirmWord || typed === confirmWord;
  const canConfirm = wordOk && !busy;

  useEffect(() => {
    if (!open) return;
    setTyped("");
    setBusy(false);
    busyRef.current = false;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onCancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  if (!open) return null;

  async function handleConfirm() {
    if (!wordOk || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <h2 id={titleId} className="text-base font-bold text-slate-900">
          {title}
        </h2>
        {description ? <div className="mt-3 space-y-2 text-sm text-slate-600">{description}</div> : null}

        {confirmWord ? (
          <div className="mt-4">
            <label htmlFor={`${titleId}-word`} className="mb-1.5 block text-sm text-slate-600">
              확인을 위해 {confirmWord} 를 입력하세요
            </label>
            <input
              id={`${titleId}-word`}
              ref={inputRef}
              value={typed}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${
              danger ? "bg-rose-600 hover:bg-rose-500" : "bg-apollon-500 hover:bg-apollon-400"
            }`}
          >
            {busy ? "처리 중…" : confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}
