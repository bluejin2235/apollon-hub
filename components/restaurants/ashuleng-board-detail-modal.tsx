"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Post = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  author_id: string;
  authorName: string;
};

type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  authorName: string;
};

type Props = {
  open: boolean;
  post: Post;
  /** Supabase auth user id (== `profiles.id`, `ashuleng_posts.author_id` 와 비교용) */
  authUserId: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  onRequestEdit: () => void;
  onRequestDelete: () => void;
};

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function AshulengBoardDetailModal({
  open,
  post,
  authUserId,
  onClose,
  onRefresh,
  onRequestEdit,
  onRequestDelete
}: Props) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const loadComments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ashuleng_comments")
      .select("id, post_id, author_id, content, created_at")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[ashuleng_comments]", error);
      setComments([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as Omit<CommentRow, "authorName">[];
    const ids = [...new Set(rows.map((r) => r.author_id))];
    const nameById = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id, name").in("id", ids);
      for (const p of profs ?? []) {
        const id = (p as { id: string }).id;
        const name = (p as { name: string }).name?.trim();
        nameById.set(id, name || "—");
      }
    }

    setComments(
      rows.map((row) => ({
        ...row,
        authorName: nameById.get(row.author_id) ?? "—"
      }))
    );
    setLoading(false);
  }, [post.id]);

  useEffect(() => {
    if (!open) return;
    setMsg("");
    setNewComment("");
    void loadComments();
  }, [open, loadComments]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isPostAuthor = authUserId != null && post.author_id === authUserId;

  const submitComment = useCallback(async () => {
    if (!authUserId) {
      setMsg("로그인이 필요합니다.");
      return;
    }
    const content = newComment.trim();
    if (!content) {
      setMsg("댓글 내용을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMsg("");
    const { error } = await supabase.from("ashuleng_comments").insert({
      post_id: post.id,
      author_id: authUserId,
      content
    });
    setSaving(false);
    if (error) {
      console.error(error);
      setMsg(`댓글 등록 실패: ${error.message}`);
      return;
    }
    setNewComment("");
    await loadComments();
    await onRefresh();
  }, [authUserId, loadComments, newComment, onRefresh, post.id]);

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!authUserId) return;
      const ok = window.confirm("댓글을 삭제할까요?");
      if (!ok) return;
      const { error } = await supabase
        .from("ashuleng_comments")
        .delete()
        .eq("id", commentId)
        .eq("author_id", authUserId);
      if (error) {
        window.alert(`댓글 삭제 실패: ${error.message}`);
        return;
      }
      await loadComments();
      await onRefresh();
    },
    [authUserId, loadComments, onRefresh]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[64] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900">{post.title}</h3>
              {isPostAuthor ? (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => onRequestEdit()}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="rounded border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    onClick={() => onRequestDelete()}
                  >
                    삭제
                  </button>
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {post.authorName} · {formatTs(post.created_at)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{post.content}</p>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <h4 className="text-sm font-bold text-slate-900">댓글 {comments.length}개</h4>
            <div className="mt-3 space-y-2">
              {loading ? (
                <p className="text-sm text-slate-500">댓글 불러오는 중…</p>
              ) : comments.length === 0 ? (
                <p className="text-sm text-slate-500">첫 댓글을 남겨 보세요.</p>
              ) : (
                comments.map((c) => {
                  const mine = authUserId != null && c.author_id === authUserId;
                  return (
                    <div key={c.id} className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">{c.authorName}</span> · {formatTs(c.created_at)}
                        </p>
                        {mine ? (
                          <button
                            type="button"
                            className="rounded border border-rose-200 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50"
                            onClick={() => void deleteComment(c.id)}
                          >
                            삭제
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{c.content}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 px-5 py-4">
          <textarea
            rows={3}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="댓글을 입력하세요"
            className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {msg ? <p className="mt-2 text-sm text-rose-600">{msg}</p> : null}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitComment()}
              className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "등록 중…" : "댓글 등록"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
