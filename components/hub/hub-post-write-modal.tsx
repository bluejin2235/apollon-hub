"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Props = {
  open: boolean;
  /** `hub_posts.author_id` (== auth.users.id == profiles.id) */
  authorId: string;
  editingPost?: { id: string; title: string; content: string; author_id: string } | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

export function HubPostWriteModal({ open, authorId, editingPost = null, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const isEdit = Boolean(editingPost);

  useEffect(() => {
    if (!open) return;
    setTitle(editingPost?.title ?? "");
    setContent(editingPost?.content ?? "");
    setMsg("");
  }, [open, editingPost]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = useCallback(async () => {
    const t = title.trim();
    const c = content.trim();
    if (!t) {
      setMsg("제목을 입력해 주세요.");
      return;
    }
    if (!c) {
      setMsg("내용을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMsg("");

    const error = isEdit
      ? (
          await supabase
            .from("hub_posts")
            .update({ title: t, content: c })
            .eq("id", editingPost!.id)
            .eq("author_id", editingPost!.author_id)
        ).error
      : (await supabase.from("hub_posts").insert({ title: t, content: c, author_id: authorId })).error;

    setSaving(false);
    if (error) {
      console.error(error);
      setMsg(`${isEdit ? "수정" : "등록"} 실패: ${error.message}`);
      return;
    }

    await onSaved();
    onClose();
  }, [authorId, content, editingPost, isEdit, onClose, onSaved, title]);

  const submitLabel = useMemo(
    () => (saving ? (isEdit ? "수정 중…" : "등록 중…") : isEdit ? "수정" : "등록"),
    [isEdit, saving]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal
      aria-labelledby="hub-write-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 id="hub-write-title" className="text-lg font-bold text-slate-900">
            {isEdit ? "글 수정" : "글쓰기"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <label htmlFor="hub-post-title" className="mb-1 block text-xs font-semibold text-slate-700">
              제목
            </label>
            <input
              id="hub-post-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="제목을 입력하세요"
            />
          </div>
          <div>
            <label htmlFor="hub-post-content" className="mb-1 block text-xs font-semibold text-slate-700">
              내용
            </label>
            <textarea
              id="hub-post-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="내용을 입력하세요"
            />
          </div>
          {msg ? <p className="text-sm text-rose-600">{msg}</p> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
