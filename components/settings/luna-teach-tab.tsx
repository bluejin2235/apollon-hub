"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

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

function reviewReasonLabel(reason: string | null | undefined): string | null {
  if (reason === "duplicate") return "중복";
  if (reason === "stale") return "미사용";
  if (reason === "contradiction") return "충돌";
  return null;
}

type ConflictGroup = {
  group: string;
  items: TeachItem[];
};

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

export function LunaTeachTab() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [history, setHistory] = useState<TeachItem[]>([]);
  const [pending, setPending] = useState<TeachItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeGroup, setMergeGroup] = useState<string | null>(null);
  const [mergeText, setMergeText] = useState("");
  const [mergeWinnerId, setMergeWinnerId] = useState<string>("");

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

    const res = await fetch("/api/luna/teach/list", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setMessage(`목록 불러오기 실패: ${await res.text()}`);
      setLoading(false);
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
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCount = selected.length;
  const canMarkConflict = isAdmin && selectedCount === 2;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

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
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const conflictHint = useMemo(
    () => "확정 전까지 루나는 이 내용을 답변에 사용하지 않습니다",
    []
  );

  if (loading) {
    return <p className="text-[12px] text-slate-500">불러오는 중…</p>;
  }

  return (
    <div className="space-y-6">
      {message ? <p className="text-[12px] text-slate-600">{message}</p> : null}

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
                          {item.author_name || "알 수 없음"} · {formatDate(item.created_at)}
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
