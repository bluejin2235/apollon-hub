"use client";

import { FormEvent, useState } from "react";
import { borrowSupply, defaultDueDate } from "@/lib/supplies/operations";
import type { Supply } from "@/lib/supplies/types";

type Props = {
  supply: Supply;
  borrowerId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function BorrowModal({ supply, borrowerId, open, onClose, onSuccess }: Props) {
  const [purpose, setPurpose] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate(7));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!purpose.trim()) {
      setError("사용 목적을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await borrowSupply({ supply, borrowerId, purpose, dueDate });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setPurpose("");
    onSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">대출 신청</h2>
        <p className="mt-1 text-sm text-slate-600">
          {supply.name} <span className="text-slate-400">({supply.code})</span>
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            사용 목적
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="사용 목적을 입력하세요"
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            반납예정일
            <input
              type="date"
              value={dueDate}
              min={defaultDueDate(0)}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? "신청 중…" : "대출 신청"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
