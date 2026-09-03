"use client";

import { GhostBtn, PrimaryBtn } from "@/components/website/work-editor-ui";
import { firstPublishNote } from "@/lib/website/publish";

type Props = {
  open: boolean;
  loading: boolean;
  publishing: boolean;
  changedFields: string[];
  firstPublish: boolean;
  note: string;
  noteLoading: boolean;
  checkSkipWarning?: boolean;
  /** 공개 실패 시 팝업 안에 보여 줄 이유. 있으면 열어 둔다 */
  error?: string | null;
  onNoteChange: (value: string) => void;
  onRegenerate: () => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function PublishModal({
  open,
  loading,
  publishing,
  changedFields,
  firstPublish,
  note,
  noteLoading,
  checkSkipWarning = false,
  error = null,
  onNoteChange,
  onRegenerate,
  onClose,
  onConfirm,
}: Props) {
  if (!open) return null;

  const canConfirm = note.trim().length > 0 && !publishing && !loading;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-modal-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 id="publish-modal-title" className="text-base font-bold text-slate-900">
            공개하기
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {firstPublish
              ? "처음 공개합니다. 사이트에 올라갈 내용을 확인하세요."
              : "바뀐 내용을 사이트에 반영합니다."}
          </p>
          {checkSkipWarning ? (
            <p className="mt-2 text-sm text-amber-700">점검을 통과하지 못한 상태로 공개합니다</p>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-500">바뀐 칸을 확인하는 중...</p>
          ) : (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                바뀐 칸
              </p>
              {changedFields.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {changedFields.map((field) => (
                    <span
                      key={field}
                      className="inline-flex rounded-full bg-apollon-50 px-2.5 py-1 text-xs font-medium text-apollon-700"
                    >
                      {field}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  {firstPublish ? "처음 공개합니다." : "바뀐 칸이 없습니다."}
                </p>
              )}

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label htmlFor="publish-change-note" className="text-sm font-semibold text-slate-900">
                    이번 공개에서 무엇이 바뀌었나요
                  </label>
                  <GhostBtn disabled={noteLoading || publishing} onClick={onRegenerate}>
                    다시 쓰기
                  </GhostBtn>
                </div>
                <textarea
                  id="publish-change-note"
                  value={note}
                  onChange={(event) => onNoteChange(event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  placeholder={firstPublish ? firstPublishNote() : "변경 요약"}
                />
                {noteLoading ? (
                  <p className="mt-1 text-xs text-slate-400">루나가 초안을 쓰는 중...</p>
                ) : null}
              </div>

              {error ? (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <GhostBtn disabled={publishing} onClick={onClose}>
            취소
          </GhostBtn>
          <PrimaryBtn disabled={!canConfirm} onClick={onConfirm}>
            {publishing ? "공개하는 중..." : "공개 확인"}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
