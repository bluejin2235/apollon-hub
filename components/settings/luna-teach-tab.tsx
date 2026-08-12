"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type ThreadTurn = { role: "luna" | "human"; text: string; at: string };

type CandidateSource = "chat" | "selfstudy" | "question" | "direct";

type CandidateItem = {
  id: string;
  content: string;
  category: string;
  source: CandidateSource;
  evidence: string | null;
  scope_suggestion: string | null;
  thread: ThreadTurn[];
  author_id: string | null;
  author_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  source_conversation_id: string | null;
  created_at: string | null;
};

type TeachItem = {
  id: string;
  content: string;
  category: string;
  status: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string | null;
  use_count: number | null;
  conflict_group: string | null;
  raw_input?: string | null;
  merge_target?: string | null;
  review_reason?: string | null;
};

type ConflictGroup = {
  group: string;
  items: TeachItem[];
};

type FilterChip = "all" | "chat" | "selfstudy" | "mine";

function reviewReasonLabel(reason: string | null | undefined): string | null {
  if (reason === "duplicate") return "중복";
  if (reason === "stale") return "미사용";
  if (reason === "contradiction") return "충돌";
  return null;
}

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function sourceBadge(source: CandidateSource): {
  label: string;
  className: string;
} {
  if (source === "chat") {
    return { label: "대화에서 배움", className: "bg-[#E1F5EE] text-[#04342C]" };
  }
  if (source === "selfstudy") {
    return { label: "자습 문답", className: "bg-[#EEEDFE] text-[#26215C]" };
  }
  if (source === "question") {
    return { label: "루나의 질문", className: "bg-[#FAECE7] text-[#712B13]" };
  }
  return { label: "알려주기", className: "bg-[#F1F0EF] text-[#5F5E5A]" };
}

const FILTERS: { key: FilterChip; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "chat", label: "대화에서" },
  { key: "selfstudy", label: "자습에서" },
  { key: "mine", label: "내가 답할 차례" }
];

export function LunaTeachTab() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const initialFilter = searchParams.get("filter");
  const lunaMenu = searchParams.get("luna");
  const lunaSub = searchParams.get("sub");
  const [filter, setFilter] = useState<FilterChip>(() => {
    if (lunaMenu === "candidates" && lunaSub === "mine") return "mine";
    if (
      initialFilter === "mine" ||
      initialFilter === "chat" ||
      initialFilter === "selfstudy"
    ) {
      return initialFilter;
    }
    return "all";
  });
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [reviseOpen, setReviseOpen] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<TeachItem[]>([]);
  const [pending, setPending] = useState<TeachItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeGroup, setMergeGroup] = useState<string | null>(null);
  const [mergeText, setMergeText] = useState("");
  const [mergeWinnerId, setMergeWinnerId] = useState<string>("");

  const loadCandidates = useCallback(async (token: string, f: FilterChip) => {
    const res = await fetch(`/api/luna/candidates?filter=${f}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setMessage(`후보 목록 실패: ${await res.text()}`);
      return;
    }
    const json = (await res.json()) as { items?: CandidateItem[] };
    setCandidates(json.items ?? []);
  }, []);

  const loadTeach = useCallback(async (token: string) => {
    const res = await fetch("/api/luna/teach/list", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setMessage(`목록 불러오기 실패: ${await res.text()}`);
      return;
    }
    const json = (await res.json()) as {
      history?: TeachItem[];
      pending?: TeachItem[];
      conflicts?: ConflictGroup[];
    };
    setHistory(json.history ?? []);
    setPending(json.pending ?? []);
    setConflicts(json.conflicts ?? []);
    setSelected([]);
  }, []);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }

    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAdmin(profile?.role === "슈퍼관리자");
    }

    await Promise.all([loadCandidates(token, filter), loadTeach(token)]);
    setLoading(false);
  }, [filter, loadCandidates, loadTeach]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      await loadCandidates(token, filter);
    })();
  }, [filter, loadCandidates]);

  const selectedCount = selected.length;
  const canMarkConflict = isAdmin && selectedCount === 2;
  const candidateCount = candidates.length;

  const conflictHint = useMemo(
    () => "확정 전까지 루나는 이 내용을 답변에 사용하지 않습니다",
    []
  );

  async function callJson(
    url: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>
  ): Promise<boolean> {
    const token = await getAccessToken();
    if (!token) {
      setMessage("로그인이 필요합니다");
      return false;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        setMessage(await res.text());
        return false;
      }
      await loadTeach(token);
      await loadCandidates(token, filter);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function respond(
    id: string,
    action: "confirm" | "revise" | "reject" | "not_needed",
    text?: string
  ) {
    const token = await getAccessToken();
    if (!token) {
      setMessage("로그인이 필요합니다");
      return;
    }
    setBusyId(id);
    setMessage("");
    try {
      const res = await fetch("/api/luna/candidates/respond", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id, action, text })
      });
      if (!res.ok) {
        setMessage(await res.text());
        return;
      }
      const json = (await res.json()) as {
        id?: string;
        status?: string;
        content?: string;
        thread?: ThreadTurn[];
      };

      if (action === "revise" && json.id) {
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === json.id
              ? {
                  ...c,
                  content: json.content ?? c.content,
                  thread: json.thread ?? c.thread
                }
              : c
          )
        );
        setReviseOpen((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return;
      }

      // confirm / reject / not_needed → 목록에서 제거
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      if (action === "confirm") {
        setMessage("기억으로 확정했어요");
        await loadTeach(token);
      }
    } finally {
      setBusyId(null);
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  if (loading) {
    return <p className="text-[12px] text-slate-500">불러오는 중…</p>;
  }

  return (
    <div className="space-y-6">
      {message ? <p className="text-[12px] text-slate-600">{message}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold text-slate-900">지식 후보함</h3>
          <span className="rounded-full bg-[#534AB7] px-2 py-0.5 text-[11px] font-medium text-white">
            {candidateCount}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] ${
                  active
                    ? "bg-[#534AB7] text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {candidates.length === 0 ? (
          <p className="mt-4 text-[12px] text-slate-500">대기 중인 후보가 없습니다</p>
        ) : (
          <div className="mt-4 space-y-3">
            {candidates.map((item) => {
              const badge = sourceBadge(item.source);
              const revising = reviseOpen[item.id] !== undefined;
              const reviseText = reviseOpen[item.id] ?? "";
              const busyThis = busyId === item.id;
              return (
                <article
                  key={item.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/40 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[10.5px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    {item.scope_suggestion ? (
                      <span className="rounded-lg bg-white px-2 py-0.5 text-[10.5px] text-slate-500">
                        {item.scope_suggestion === "org" ? "조직" : "개인"} 제안
                      </span>
                    ) : null}
                  </div>

                  <p className="whitespace-pre-wrap text-[13px] font-medium text-slate-900">
                    {item.content}
                  </p>
                  {item.evidence ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">
                      {item.evidence}
                    </p>
                  ) : null}
                  {item.source_conversation_id ? (
                    <a
                      href={`/luna`}
                      className="mt-1.5 inline-block text-[11px] text-[#534AB7] hover:underline"
                      title={item.source_conversation_id}
                    >
                      원문 대화 보기
                    </a>
                  ) : null}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {item.author_name || "알 수 없음"}
                    {item.assigned_name
                      ? ` · 배정 ${item.assigned_name}`
                      : ""}{" "}
                    · {formatDate(item.created_at)}
                  </p>

                  {item.thread.length > 0 ? (
                    <div className="mt-3 space-y-1.5 rounded-lg bg-white p-2.5">
                      {item.thread.map((t, idx) => (
                        <div
                          key={`${item.id}-t-${idx}`}
                          className={`max-w-[92%] rounded-lg px-2.5 py-1.5 text-[12px] ${
                            t.role === "luna"
                              ? "rounded-bl-sm bg-slate-100 text-slate-800"
                              : "ml-auto rounded-br-sm bg-[#EEEDFE] text-[#26215C]"
                          }`}
                        >
                          <span className="mb-0.5 block text-[10px] font-medium opacity-60">
                            {t.role === "luna" ? "루나" : "사람"}
                          </span>
                          {t.text}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {revising ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        rows={3}
                        value={reviseText}
                        onChange={(e) =>
                          setReviseOpen((prev) => ({
                            ...prev,
                            [item.id]: e.target.value
                          }))
                        }
                        placeholder="고친 문장을 적어 주세요"
                        className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-[13px]"
                        disabled={busyThis}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={busyThis || !reviseText.trim()}
                          onClick={() =>
                            void respond(item.id, "revise", reviseText.trim())
                          }
                          className="rounded-lg bg-[#534AB7] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                        >
                          {busyThis ? "반영 중…" : "고쳐서 보내기"}
                        </button>
                        <button
                          type="button"
                          disabled={busyThis}
                          onClick={() =>
                            setReviseOpen((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            })
                          }
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={busyThis}
                        onClick={() => void respond(item.id, "confirm")}
                        className="rounded-lg bg-[#0F6E56] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                      >
                        맞아요 → 기억
                      </button>
                      <button
                        type="button"
                        disabled={busyThis}
                        onClick={() =>
                          setReviseOpen((prev) => ({
                            ...prev,
                            [item.id]: item.content
                          }))
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 disabled:opacity-40"
                      >
                        고쳐서 확정
                      </button>
                      <button
                        type="button"
                        disabled={busyThis}
                        onClick={() => void respond(item.id, "reject")}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 disabled:opacity-40"
                      >
                        아니에요
                      </button>
                      {item.source === "selfstudy" ? (
                        <button
                          type="button"
                          disabled={busyThis}
                          onClick={() => void respond(item.id, "not_needed")}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-500 disabled:opacity-40"
                        >
                          이런 건 안 배워도 돼
                        </button>
                      ) : null}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">의견 충돌 보류함</h3>
        <p className="mt-1 text-[11px] text-slate-500">{conflictHint}</p>
        {conflicts.length === 0 ? (
          <p className="mt-3 text-[12px] text-slate-500">아직 항목이 없습니다</p>
        ) : (
          <div className="mt-3 space-y-3">
            {conflicts.map((group) => {
              const [a, b] = group.items;
              if (!a || !b) return null;
              const merging = mergeGroup === group.group;
              return (
                <div
                  key={group.group}
                  className="rounded-lg border border-orange-200 bg-orange-50/40 p-3"
                >
                  {group.items.some((it) => it.review_reason === "contradiction") ? (
                    <span className="mb-2 inline-block rounded-lg bg-orange-100 px-2 py-0.5 text-[11px] text-orange-900">
                      충돌
                    </span>
                  ) : null}
                  <div className="grid gap-3 md:grid-cols-2">
                    {[a, b].map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-slate-200 bg-white p-3"
                      >
                        <p className="whitespace-pre-wrap text-[13px] text-slate-900">
                          {item.content}
                        </p>
                        <p className="mt-2 text-[11px] text-slate-500">
                          {item.author_name || "알 수 없음"} ·{" "}
                          {formatDate(item.created_at)}
                        </p>
                        {isAdmin ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void callJson("/api/luna/teach/resolve", "POST", {
                                group: group.group,
                                winner_id: item.id
                              })
                            }
                            className="mt-2 rounded-lg bg-[#534AB7] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                          >
                            이걸로 확정
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {isAdmin ? (
                    <div className="mt-3">
                      {!merging ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setMergeGroup(group.group);
                            setMergeWinnerId(a.id);
                            setMergeText(`${a.content}\n\n${b.content}`);
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50"
                        >
                          병합해서 확정
                        </button>
                      ) : (
                        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                          <label className="block text-[11px] text-slate-500">
                            승자로 남길 항목
                            <select
                              value={mergeWinnerId}
                              onChange={(e) => setMergeWinnerId(e.target.value)}
                              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-[12px]"
                            >
                              {[a, b].map((item) => (
                                <option key={item.id} value={item.id}>
                                  {(item.author_name || "알 수 없음") +
                                    " · " +
                                    item.content.slice(0, 40)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <textarea
                            rows={4}
                            value={mergeText}
                            onChange={(e) => setMergeText(e.target.value)}
                            className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                            placeholder="병합된 내용"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy || !mergeText.trim()}
                              onClick={() =>
                                void callJson("/api/luna/teach/resolve", "POST", {
                                  group: group.group,
                                  winner_id: mergeWinnerId,
                                  merged_content: mergeText.trim()
                                }).then((ok) => {
                                  if (ok) {
                                    setMergeGroup(null);
                                    setMergeText("");
                                  }
                                })
                              }
                              className="rounded-lg bg-[#534AB7] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setMergeGroup(null);
                                setMergeText("");
                              }}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600"
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">승인 대기</h3>
        {pending.length === 0 ? (
          <p className="mt-3 text-[12px] text-slate-500">아직 항목이 없습니다</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {pending.map((item) => {
              const reasonLabel = reviewReasonLabel(item.review_reason);
              return (
                <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      {reasonLabel ? (
                        <span className="rounded-lg bg-orange-50 px-2 py-0.5 text-[11px] text-orange-900">
                          {reasonLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] text-slate-900">
                      {item.content}
                    </p>
                    {item.review_reason === "duplicate" && item.raw_input ? (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] text-slate-700">
                        <span className="font-medium text-slate-500">병합 초안 · </span>
                        {item.raw_input}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {item.author_name || "알 수 없음"} · {formatDate(item.created_at)}
                    </p>
                  </div>
                  {isAdmin ? (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void callJson("/api/luna/teach/review", "POST", {
                            id: item.id,
                            action: "approve"
                          })
                        }
                        className="rounded-lg bg-[#0F6E56] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                      >
                        승인
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void callJson("/api/luna/teach/review", "POST", {
                            id: item.id,
                            action: "reject"
                          })
                        }
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-700 disabled:opacity-40"
                      >
                        반려
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            알려준 것{" "}
            <span className="font-normal text-slate-400">{history.length}</span>
          </h3>
          {isAdmin ? (
            <button
              type="button"
              disabled={!canMarkConflict || busy}
              onClick={() =>
                void callJson("/api/luna/teach/conflict", "POST", {
                  ids: selected
                })
              }
              className="rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-[11px] font-medium text-orange-900 disabled:opacity-40"
            >
              충돌로 표시 {selectedCount === 2 ? "(2)" : ""}
            </button>
          ) : null}
        </div>
        {history.length === 0 ? (
          <p className="mt-3 text-[12px] text-slate-500">아직 항목이 없습니다</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
                  {isAdmin ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1"
                      aria-label="충돌 후보 선택"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-[13px] text-slate-900">
                      {item.content}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {item.author_name || "알 수 없음"} · {formatDate(item.created_at)} ·
                      사용 {item.use_count ?? 0}회
                    </p>
                  </div>
                  {isAdmin ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void callJson("/api/luna/teach/retire", "PATCH", {
                          id: item.id
                        })
                      }
                      className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      폐기
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
