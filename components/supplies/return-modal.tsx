"use client";

import { FormEvent, useEffect, useState } from "react";
import { returnSupplyLoan, uploadReturnImage } from "@/lib/supplies/operations";

type Props = {
  open: boolean;
  loanId: string;
  location: string;
  supplyName?: string;
  onClose: () => void;
  onSuccess: () => void;
};

export function ReturnModal({ open, loanId, location, supplyName, onClose, onSuccess }: Props) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setImageFile(null);
    setPreviewUrl(null);
    setNote("");
    setError(null);
  }, [open, loanId]);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!imageFile) return;

    setSaving(true);
    setError(null);

    const { url, error: upErr } = await uploadReturnImage(loanId, imageFile);
    if (upErr || !url) {
      setSaving(false);
      setError(upErr ?? "사진 업로드에 실패했습니다.");
      return;
    }

    const { error: retErr } = await returnSupplyLoan({
      loanId,
      returnImageUrl: url,
      note: note.trim() || null
    });

    setSaving(false);
    if (retErr) {
      setError(retErr);
      return;
    }

    onSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">반납하기</h2>
        {supplyName ? <p className="mt-1 text-sm text-slate-600">{supplyName}</p> : null}
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          물품을 보관 위치(<span className="font-semibold text-slate-900">{location || "—"}</span>)에 반납 후 사진을
          촬영해주세요.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            반납 사진 <span className="text-rose-600">*</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-1 w-full text-sm"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="반납 사진 미리보기" className="max-h-48 w-full rounded-lg border border-slate-200 object-contain" />
          ) : null}

          <label className="block text-sm font-medium text-slate-700">
            특이사항 (선택)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="파손, 분실 등"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!imageFile || saving}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "처리 중…" : "반납 완료"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
