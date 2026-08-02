"use client";

import { useCallback, useEffect, useState } from "react";
import { SupplyToast } from "@/components/supplies/toast";
import { supabase } from "@/lib/supabase/client";

type Counts = {
  active: number;
  conflict: number;
  candidate: number;
  archived: number;
};

type RelatedLearning = {
  id: string;
  content: string;
  category: string;
};

type KnowledgeItem = {
  id: string;
  content: string;
  category: string;
  status: string;
  confidence: number | null;
  use_count: number | null;
  last_used_at: string | null;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
  origin?: string | null;
  related?: RelatedLearning[];
};

type MergeSettingsState = {
  merge_threshold: number;
  max_wait_days: number;
  last_merge_at: string | null;
  last_merge_count: number | null;
  last_merge_trigger: string | null;
  candidate_count: number;
  oldest_days: number;
  next_midnight_action: string;
};

type SortKey = "recent" | "most_used" | "unused";

function triggerLabel(trigger: string | null): string {
  if (trigger === "threshold") return "임계치";
  if (trigger === "timeout") return "대기일수";
  if (trigger === "manual") return "수동";
  return trigger || "-";
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
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function ConfidenceDots({ value }: { value: number | null }) {
  const n = Math.min(5, Math.max(0, value ?? 0));
  return (
    <span className="inline-flex gap-0.5" aria-label={`신뢰도 ${n}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            i < n ? "bg-[#534AB7]" : "bg-slate-200"
          }`}
        />
      ))}
    </span>
  );
}

function isStaleUnused(item: KnowledgeItem): boolean {
  const useCount = item.use_count ?? 0;
  if (useCount > 0) return false;
  const created = new Date(item.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created > 30 * 24 * 60 * 60 * 1000;
}

export function LunaKnowledgeTab() {
  const [counts, setCounts] = useState<Counts>({
    active: 0,
    conflict: 0,
    candidate: 0,
    archived: 0
  });
  const [conflicts, setConflicts] = useState<KnowledgeItem[]>([]);
  const [activeItems, setActiveItems] = useState<KnowledgeItem[]>([]);
  const [candidates, setCandidates] = useState<KnowledgeItem[]>([]);
  const [archived, setArchived] = useState<KnowledgeItem[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>("recent");
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [keepOneFor, setKeepOneFor] = useState<string | null>(null);
  const [keepId, setKeepId] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mergeSettings, setMergeSettings] = useState<MergeSettingsState | null>(
    null
  );
  const [thresholdDraft, setThresholdDraft] = useState(15);
  const [maxWaitDraft, setMaxWaitDraft] = useState(7);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [activeRes, conflictRes, candidateRes, archivedRes, settingsRes] =
      await Promise.all([
      fetch(`/api/luna/knowledge?status=active&sort=${sort}&page=${page}`, {
        headers
      }),
      fetch("/api/luna/knowledge?status=conflict&page=1", { headers }),
      fetch("/api/luna/knowledge?status=candidate&page=1", { headers }),
      fetch("/api/luna/knowledge?status=archived&page=1", { headers }),
      fetch("/api/luna/knowledge/settings", { headers })
    ]);

    if (activeRes.ok) {
      const json = (await activeRes.json()) as {
        items?: KnowledgeItem[];
        total?: number;
        counts?: Counts;
      };
      setActiveItems(json.items ?? []);
      setActiveTotal(json.total ?? 0);
      if (json.counts) setCounts(json.counts);
    }
    if (conflictRes.ok) {
      const json = (await conflictRes.json()) as {
        items?: KnowledgeItem[];
        counts?: Counts;
      };
      setConflicts(json.items ?? []);
      if (json.counts) setCounts(json.counts);
    }
    if (candidateRes.ok) {
      const json = (await candidateRes.json()) as { items?: KnowledgeItem[] };
      setCandidates(json.items ?? []);
    }
    if (archivedRes.ok) {
      const json = (await archivedRes.json()) as { items?: KnowledgeItem[] };
      setArchived(json.items ?? []);
    }
    if (settingsRes.ok) {
      const json = (await settingsRes.json()) as MergeSettingsState;
      setMergeSettings(json);
      setThresholdDraft(json.merge_threshold);
      setMaxWaitDraft(json.max_wait_days);
    }
    setLoading(false);
  }, [page, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMergeSettings() {
    const token = await getAccessToken();
    if (!token || savingSettings) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/luna/knowledge/settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          merge_threshold: thresholdDraft,
          max_wait_days: maxWaitDraft
        })
      });
      if (!res.ok) {
        setToast(`설정 저장 실패: ${await res.text()}`);
        return;
      }
      setToast("통합 설정을 저장했습니다");
      await load();
    } catch (err) {
      console.error("[luna-knowledge] settings", err);
      setToast("설정 저장 실패");
    } finally {
      setSavingSettings(false);
    }
  }

  async function runMerge() {
    const token = await getAccessToken();
    if (!token || merging) return;
    setMerging(true);
    try {
      const res = await fetch("/api/luna/knowledge/merge", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setToast(`통합 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as {
        merged?: number;
        conflicts?: number;
        archived?: number;
      };
      setToast(
        `통합 ${json.merged ?? 0} · 충돌 ${json.conflicts ?? 0} · 폐기 ${json.archived ?? 0}`
      );
      await load();
    } catch (err) {
      console.error("[luna-knowledge] merge", err);
      setToast("통합 실패");
    } finally {
      setMerging(false);
    }
  }

  async function resolveConflict(
    conflictId: string,
    action: "keep_both" | "keep_one" | "discard",
    selectedKeepId?: string
  ) {
    const token = await getAccessToken();
    if (!token || busyId) return;
    setBusyId(conflictId);
    try {
      const res = await fetch("/api/luna/knowledge/resolve", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          conflict_id: conflictId,
          action,
          ...(action === "keep_one" ? { keep_id: selectedKeepId } : {})
        })
      });
      if (!res.ok) {
        setToast(`처리 실패: ${await res.text()}`);
        return;
      }
      setKeepOneFor(null);
      setKeepId("");
      setToast("처리했습니다");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(id: string, status: string) {
    const token = await getAccessToken();
    if (!token || busyId) return;
    setBusyId(id);
    try {
      const res = await fetch("/api/luna/knowledge", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id, status })
      });
      if (!res.ok) {
        setToast(`변경 실패: ${await res.text()}`);
        return;
      }
      setToast(status === "archived" ? "폐기했습니다" : "복원했습니다");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(activeTotal / 20));

  if (loading) {
    return <p className="text-[12px] text-slate-500">불러오는 중…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { key: "active", label: "활성 지식", value: counts.active },
              { key: "conflict", label: "검토 대기", value: counts.conflict },
              { key: "candidate", label: "후보", value: counts.candidate },
              { key: "archived", label: "폐기됨", value: counts.archived }
            ] as const
          ).map((c) => (
            <div
              key={c.key}
              className="min-w-[120px] rounded-lg bg-slate-50 px-3 py-2.5"
            >
              <p className="text-[11px] text-slate-500">{c.label}</p>
              <p className="text-lg font-semibold text-slate-900">{c.value}</p>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={merging}
          onClick={() => void runMerge()}
          className="rounded-lg bg-[#534AB7] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
        >
          {merging ? "통합 중…" : "지금 통합 실행"}
        </button>
      </div>

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <h3 className="text-[13px] font-semibold text-slate-800">통합 설정</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-[11px] text-slate-600">
            통합 기준 개수
            <input
              type="number"
              min={3}
              max={100}
              value={thresholdDraft}
              onChange={(e) => setThresholdDraft(Number(e.target.value))}
              className="mt-1 block w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] text-slate-900"
            />
          </label>
          <label className="block text-[11px] text-slate-600">
            최대 대기 일수
            <input
              type="number"
              min={1}
              max={30}
              value={maxWaitDraft}
              onChange={(e) => setMaxWaitDraft(Number(e.target.value))}
              className="mt-1 block w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] text-slate-900"
            />
          </label>
          <button
            type="button"
            disabled={savingSettings}
            onClick={() => void saveMergeSettings()}
            className="rounded-lg border border-[#534AB7] px-3 py-1.5 text-[12px] font-medium text-[#534AB7] hover:bg-[#EEEDFE] disabled:opacity-50"
          >
            {savingSettings ? "저장 중…" : "저장"}
          </button>
        </div>
        {mergeSettings ? (
          <div className="space-y-0.5 text-[11px] text-gray-500">
            <p>
              후보 {mergeSettings.candidate_count}개 · 가장 오래된 것{" "}
              {mergeSettings.oldest_days}일 경과 · 다음 자정에{" "}
              {mergeSettings.next_midnight_action}
            </p>
            <p>
              마지막 실행:{" "}
              {mergeSettings.last_merge_at
                ? `${formatDate(mergeSettings.last_merge_at)} · ${triggerLabel(
                    mergeSettings.last_merge_trigger
                  )}${
                    mergeSettings.last_merge_count != null
                      ? ` · 후보 ${mergeSettings.last_merge_count}개`
                      : ""
                  }`
                : "아직 없음"}
            </p>
          </div>
        ) : null}
      </section>

      {conflicts.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-slate-800">검토 필요</h3>
          {conflicts.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-2.5"
            >
              <p className="text-[13px] text-slate-800">{item.content}</p>
              {(item.related ?? []).length > 0 ? (
                <ul className="mt-1.5 space-y-0.5">
                  {(item.related ?? []).map((r) => (
                    <li key={r.id} className="text-[11.5px] text-gray-500">
                      · [{r.category}] {r.content}
                    </li>
                  ))}
                </ul>
              ) : null}

              {keepOneFor === item.id ? (
                <div className="mt-2 space-y-1.5">
                  {(item.related ?? []).map((r) => (
                    <label
                      key={r.id}
                      className="flex items-start gap-2 text-[11.5px] text-slate-700"
                    >
                      <input
                        type="radio"
                        name={`keep-${item.id}`}
                        checked={keepId === r.id}
                        onChange={() => setKeepId(r.id)}
                      />
                      <span>{r.content}</span>
                    </label>
                  ))}
                  <div className="flex gap-1.5 pt-1">
                    <button
                      type="button"
                      disabled={!keepId || busyId === item.id}
                      onClick={() =>
                        void resolveConflict(item.id, "keep_one", keepId)
                      }
                      className="rounded border border-[#534AB7] px-2 py-1 text-[11px] text-[#534AB7] disabled:opacity-50"
                    >
                      선택 유지
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setKeepOneFor(null);
                        setKeepId("");
                      }}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void resolveConflict(item.id, "keep_both")}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700"
                  >
                    양쪽 다 유지
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => {
                      setKeepOneFor(item.id);
                      setKeepId(item.related?.[0]?.id ?? "");
                    }}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700"
                  >
                    하나만 남기기
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void resolveConflict(item.id, "discard")}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-red-600"
                  >
                    폐기
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-800">활성 지식</h3>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                { key: "recent", label: "최근순" },
                { key: "most_used", label: "많이 쓰인 순" },
                { key: "unused", label: "안 쓰인 순" }
              ] as const
            ).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setPage(1);
                  setSort(s.key);
                }}
                className={`rounded-md px-2 py-1 text-[11px] ${
                  sort === s.key
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">내용</th>
                <th className="px-3 py-2 font-medium">출처</th>
                <th className="px-3 py-2 font-medium">분류</th>
                <th className="px-3 py-2 font-medium">신뢰도</th>
                <th className="px-3 py-2 font-medium">쓰인 횟수</th>
                <th className="px-3 py-2 font-medium">마지막 사용</th>
                <th className="px-3 py-2 font-medium">작업</th>
              </tr>
            </thead>
            <tbody>
              {activeItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-slate-400">
                    활성 지식이 없습니다.
                  </td>
                </tr>
              ) : (
                activeItems.map((item) => {
                  const stale = isStaleUnused(item);
                  return (
                    <tr
                      key={item.id}
                      className={`border-t border-slate-100 ${
                        stale ? "bg-slate-100/80" : "bg-white"
                      }`}
                    >
                      <td className="max-w-[320px] px-3 py-2 text-slate-800">
                        <span className="line-clamp-2">{item.content}</span>
                        {stale ? (
                          <span className="ml-1.5 inline-block rounded bg-slate-200 px-1.5 py-px text-[10px] text-slate-600">
                            폐기 후보
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {item.origin === "direct" ? (
                          <span
                            className="inline-block rounded px-1.5 py-px text-[10px] font-medium"
                            style={{
                              backgroundColor: "#EEEDFE",
                              color: "#26215C"
                            }}
                          >
                            직접
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{item.category}</td>
                      <td className="px-3 py-2">
                        <ConfidenceDots value={item.confidence} />
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {item.use_count ?? 0}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDate(item.last_used_at)}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void setStatus(item.id, "archived")}
                          className="text-[11px] text-slate-500 hover:text-red-600 disabled:opacity-50"
                        >
                          폐기
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <div className="flex items-center justify-end gap-2 text-[11px] text-slate-600">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              이전
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold text-slate-800">후보</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">내용</th>
                <th className="px-3 py-2 font-medium">분류</th>
                <th className="px-3 py-2 font-medium">작성자</th>
                <th className="px-3 py-2 font-medium">날짜</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-slate-400">
                    후보가 없습니다.
                  </td>
                </tr>
              ) : (
                candidates.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="max-w-[360px] px-3 py-2 text-slate-800">
                      <span className="line-clamp-2">{item.content}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{item.category}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {item.author_name || "-"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDate(item.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => setArchivedOpen((v) => !v)}
          className="text-[13px] font-semibold text-slate-800"
        >
          폐기됨 {archivedOpen ? "▾" : "▸"}
          <span className="ml-1.5 font-normal text-slate-400">
            ({counts.archived})
          </span>
        </button>
        {archivedOpen ? (
          <div className="mt-2 space-y-1.5">
            {archived.length === 0 ? (
              <p className="text-[12px] text-slate-400">폐기된 지식이 없습니다.</p>
            ) : (
              archived.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[12px] text-slate-700">{item.content}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {item.category} · {formatDate(item.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void setStatus(item.id, "active")}
                    className="shrink-0 text-[11px] text-[#534AB7] hover:underline disabled:opacity-50"
                  >
                    복원
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
