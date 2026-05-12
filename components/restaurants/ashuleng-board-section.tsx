"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AshulengBoardDetailModal } from "@/components/restaurants/ashuleng-board-detail-modal";
import { AshulengPostWriteModal } from "@/components/restaurants/ashuleng-post-write-modal";
import { supabase } from "@/lib/supabase/client";

const PAGE_SIZE = 5;

type PostRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  author_id: string;
  authorName: string;
  commentCount: number;
};

function formatPostTime(iso: string): string {
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

function isCurrentUserPostAuthor(authorId: string, authUserId: string | null, authProfileId: string | null): boolean {
  return (authUserId != null && authorId === authUserId) || (authProfileId != null && authorId === authProfileId);
}

export function AshulengBoardSection() {
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authProfileId, setAuthProfileId] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [total, setTotal] = useState(0);
  const [boardPage, setBoardPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeOpen, setWriteOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<PostRow | null>(null);
  const [detailPost, setDetailPost] = useState<PostRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email;
      if (!cancelled) setAuthUserId(uid);
      if (!email) {
        if (!cancelled) setAuthProfileId(null);
        return;
      }
      const { data: prof } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
      if (!cancelled) setAuthProfileId(prof?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchPostsPage = useCallback(async (page: number) => {
    const safePage = Math.max(1, page);
    setLoading(true);
    const from = (safePage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error, count } = await supabase
      .from("ashuleng_posts")
      .select("id, title, content, author_id, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) {
      setLoading(false);
      console.error("[ashuleng_posts]", error);
      setLoadError(error.message);
      setPosts([]);
      setTotal(0);
      return;
    }

    const raw = (data ?? []) as Omit<PostRow, "authorName" | "commentCount">[];
    const authorIds = [...new Set(raw.map((r) => r.author_id))];
    const postIds = raw.map((r) => r.id);

    const nameById = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profs, error: pe } = await supabase.from("profiles").select("id, name").in("id", authorIds);
      if (pe) console.error("[ashuleng_posts] profiles", pe);
      for (const p of profs ?? []) {
        const id = (p as { id: string }).id;
        const name = (p as { name: string }).name?.trim();
        nameById.set(id, name || "—");
      }
    }

    const commentCountByPost = new Map<string, number>();
    if (postIds.length > 0) {
      const { data: comments, error: ce } = await supabase.from("ashuleng_comments").select("post_id").in("post_id", postIds);
      if (ce) {
        console.error("[ashuleng_comments]", ce);
      } else {
        for (const row of comments ?? []) {
          const postId = (row as { post_id: string }).post_id;
          commentCountByPost.set(postId, (commentCountByPost.get(postId) ?? 0) + 1);
        }
      }
    }

    setLoadError(null);
    setPosts(
      raw.map((r) => ({
        ...r,
        authorName: nameById.get(r.author_id) ?? "—",
        commentCount: commentCountByPost.get(r.id) ?? 0
      }))
    );
    setTotal(count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchPostsPage(boardPage);
  }, [boardPage, fetchPostsPage]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    setBoardPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const canWrite = Boolean(authProfileId);

  const emptyHint = useMemo(() => {
    if (loading || loadError) return null;
    if (total === 0) return "첫 글을 남겨 보세요.";
    return null;
  }, [loading, loadError, total]);

  const refreshList = useCallback(async () => {
    await fetchPostsPage(boardPage);
  }, [boardPage, fetchPostsPage]);

  const onDeletePost = useCallback(async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    const { error } = await supabase.from("ashuleng_posts").delete().eq("id", deleteTarget.id);
    setDeleteBusy(false);
    if (error) {
      window.alert(`삭제 실패: ${error.message}`);
      return;
    }
    setDeleteTarget(null);
    setDetailPost((prev) => (prev?.id === deleteTarget.id ? null : prev));
    await refreshList();
  }, [deleteBusy, deleteTarget, refreshList]);

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="ashuleng-board-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 id="ashuleng-board-heading" className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              아슐랭 게시판
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">의견 · 아이디어 · 에피소드</p>
            {!loading && !loadError ? <p className="mt-1 text-xs tabular-nums text-slate-400">총 {total}건</p> : null}
          </div>
          {canWrite ? (
            <button
              type="button"
              onClick={() => {
                setEditingPost(null);
                setWriteOpen(true);
              }}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:self-auto"
            >
              ✏️ 글쓰기
            </button>
          ) : null}
        </div>

        {loadError ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
            게시글을 불러오지 못했습니다. 테이블/RLS를 확인해 주세요. <span className="text-rose-700/90">({loadError})</span>
          </p>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-100">
          <table className="w-full min-w-0 text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2.5 sm:px-4">제목</th>
                <th className="hidden w-[7rem] shrink-0 px-2 py-2.5 sm:table-cell">작성자</th>
                <th className="hidden w-[10.5rem] shrink-0 px-2 py-2.5 md:table-cell">작성일시</th>
                <th className="w-[5rem] shrink-0 px-2 py-2.5 text-right">댓글수</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    불러오는 중…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                    위 안내를 참고해 주세요.
                  </td>
                </tr>
              ) : posts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    {emptyHint ?? "게시글이 없습니다."}
                  </td>
                </tr>
              ) : (
                posts.map((row) => {
                  const mine = isCurrentUserPostAuthor(row.author_id, authUserId, authProfileId);
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="max-w-0 px-3 py-3 sm:px-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left font-semibold text-slate-900 hover:text-blue-700"
                            title={row.title}
                            onClick={() => setDetailPost(row)}
                          >
                            {row.title}
                          </button>
                          {mine ? (
                            <div className="shrink-0 space-x-1">
                              <button
                                type="button"
                                className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPost(row);
                                  setWriteOpen(true);
                                }}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                className="rounded border border-rose-200 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget(row);
                                }}
                              >
                                삭제
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 sm:hidden">
                          {row.authorName} · {formatPostTime(row.created_at)}
                        </p>
                      </td>
                      <td className="hidden px-2 py-3 text-slate-700 sm:table-cell">{row.authorName}</td>
                      <td className="hidden whitespace-nowrap px-2 py-3 text-xs text-slate-600 md:table-cell">{formatPostTime(row.created_at)}</td>
                      <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums text-slate-600">{row.commentCount}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 ? (
          <nav className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-slate-600" aria-label="게시판 페이지">
            <button
              type="button"
              aria-label="이전 페이지"
              disabled={boardPage <= 1}
              className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={() => setBoardPage((p) => Math.max(1, p - 1))}
            >
              {"<"}
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setBoardPage(p)}
                className={`min-w-[1.25rem] px-0.5 py-0.5 tabular-nums ${
                  p === boardPage
                    ? "font-bold text-slate-900 underline decoration-slate-900 decoration-2 underline-offset-4"
                    : "font-normal hover:text-slate-900"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              aria-label="다음 페이지"
              disabled={boardPage >= totalPages}
              className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={() => setBoardPage((p) => Math.min(totalPages, p + 1))}
            >
              {">"}
            </button>
          </nav>
        ) : null}
      </section>

      {authProfileId ? (
        <AshulengPostWriteModal
          open={writeOpen}
          authorProfileId={authProfileId}
          editingPost={
            editingPost
              ? { id: editingPost.id, title: editingPost.title, content: editingPost.content, author_id: editingPost.author_id }
              : null
          }
          onClose={() => {
            setWriteOpen(false);
            setEditingPost(null);
          }}
          onSaved={async () => {
            setBoardPage(1);
            await fetchPostsPage(1);
          }}
        />
      ) : null}

      {detailPost ? (
        <AshulengBoardDetailModal
          open={Boolean(detailPost)}
          post={detailPost}
          authUserId={authUserId}
          authProfileId={authProfileId}
          onClose={() => setDetailPost(null)}
          onRefresh={refreshList}
          onRequestEdit={() => {
            const row = detailPost;
            setDetailPost(null);
            setEditingPost(row);
            setWriteOpen(true);
          }}
          onRequestDelete={() => {
            if (detailPost) setDeleteTarget(detailPost);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
            <h3 className="text-base font-bold text-slate-900">게시글 삭제</h3>
            <p className="mt-2 text-sm text-slate-600">정말 삭제할까요? 삭제 후 복구할 수 없습니다.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setDeleteTarget(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                onClick={() => void onDeletePost()}
                disabled={deleteBusy}
              >
                {deleteBusy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
