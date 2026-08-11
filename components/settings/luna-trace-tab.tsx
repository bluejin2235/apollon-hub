"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SupplyToast } from "@/components/supplies/toast";
import type {
  LunaReportRow,
  SelfstudyQueueRow,
  SelfstudySource
} from "@/lib/luna/selfstudy";
import type { LunaTraceWeeklyRow, TraceFailure } from "@/lib/luna/trace-weekly";
import { getCurrentWeekBounds } from "@/lib/luna/trace-weekly";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function sourceBadge(source: SelfstudySource | string): {
  label: string;
  className: string;
} {
  if (source === "failure") {
    return { label: "실패", className: "bg-red-100 text-red-800" };
  }
  if (source === "frequency") {
    return { label: "빈도", className: "bg-[#EEEDFE] text-[#26215C]" };
  }
  if (source === "project") {
    return { label: "프로젝트", className: "bg-[#E1F5EE] text-[#04342C]" };
  }
  return { label: "수동", className: "bg-slate-100 text-slate-700" };
}

function formatWeekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return weekStart;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}주`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatAvgMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function reasonBadgeClass(reason: string): string {
  if (reason === "싫어요") return "bg-amber-100 text-amber-900";
  if (reason === "결과없음") return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export function LunaTraceTab() {
  const [weeks, setWeeks] = useState<LunaTraceWeeklyRow[]>([]);
  const [queue, setQueue] = useState<SelfstudyQueueRow[]>([]);
  const [reports, setReports] = useState<LunaReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [aggregating, setAggregating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(() => new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);

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
    try {
      const [traceRes, studyRes] = await Promise.all([
        fetch("/api/luna/trace", {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch("/api/luna/selfstudy", {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (traceRes.ok) {
        const json = (await traceRes.json()) as { weeks?: LunaTraceWeeklyRow[] };
        setWeeks(json.weeks ?? []);
      } else {
        setToast(`관측 지표 불러오기 실패: ${await traceRes.text()}`);
      }

      if (studyRes.ok) {
        const json = (await studyRes.json()) as {
          queue?: SelfstudyQueueRow[];
          reports?: LunaReportRow[];
        };
        setQueue(json.queue ?? []);
        setReports(json.reports ?? []);
      } else {
        console.error("[luna-trace] selfstudy", await studyRes.text());
      }
    } catch (err) {
      console.error("[luna-trace] load", err);
      setToast("불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentWeekStart = useMemo(
    () => getCurrentWeekBounds().weekStart,
    []
  );

  const current =
    weeks.find((w) => w.week_start === currentWeekStart) ?? weeks[0] ?? null;

  const failures: TraceFailure[] = useMemo(() => {
    if (!current || !Array.isArray(current.top_failures)) return [];
    return current.top_failures;
  }, [current]);

  async function runAggregate() {
    const token = await getAccessToken();
    if (!token || aggregating) return;
    setAggregating(true);
    try {
      const res = await fetch("/api/luna/trace", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setToast(`집계 실패: ${await res.text()}`);
        return;
      }
      setToast("이번 주 집계를 완료했습니다");
      await load();
    } finally {
      setAggregating(false);
    }
  }

  function failureKey(f: TraceFailure): string {
    return `${f.created_at}::${f.question}`;
  }

  async function addEvalCase(f: TraceFailure) {
    const key = failureKey(f);
    if (addedKeys.has(key) || addingKey) return;
    const token = await getAccessToken();
    if (!token) return;
    setAddingKey(key);
    try {
      const res = await fetch("/api/luna/eval/cases", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: f.question,
          expectation: ""
        })
      });
      if (!res.ok) {
        setToast(`추가 실패: ${await res.text()}`);
        return;
      }
      setAddedKeys((prev) => new Set(prev).add(key));
      setToast("시험 문제로 추가했습니다");
    } finally {
      setAddingKey(null);
    }
  }

  async function pickTopics() {
    const token = await getAccessToken();
    if (!token || picking) return;
    setPicking(true);
    try {
      const res = await fetch("/api/luna/selfstudy/pick", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setToast(`주제 선정 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as {
        picked?: number;
        reason?: string;
      };
      if ((json.picked ?? 0) === 0 && json.reason) {
        setToast(`주제 선정 0건: ${json.reason}`);
      } else {
        setToast(`주제 ${json.picked ?? 0}건 선정`);
      }
      await load();
    } finally {
      setPicking(false);
    }
  }

  async function runQueueItem(queueId?: string) {
    if (runningId) return;
    const token = await getAccessToken();
    if (!token) return;
    setRunningId(queueId ?? "__next__");
    try {
      const res = await fetch("/api/luna/selfstudy/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(queueId ? { queue_id: queueId } : {})
      });
      if (!res.ok) {
        setToast(`실행 실패: ${await res.text()}`);
        return;
      }
      setToast("자습 리포트를 작성했습니다");
      await load();
    } finally {
      setRunningId(null);
    }
  }

  async function skipQueueItem(queueId: string) {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("/api/luna/selfstudy", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "skip", queue_id: queueId })
    });
    if (!res.ok) {
      setToast(`건너뛰기 실패: ${await res.text()}`);
      return;
    }
    setToast("건너뛰었습니다");
    await load();
  }

  async function archiveReport(reportId: string) {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("/api/luna/selfstudy", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "archive", report_id: reportId })
    });
    if (!res.ok) {
      setToast(`폐기 실패: ${await res.text()}`);
      return;
    }
    setToast("리포트를 폐기했습니다");
    if (openReportId === reportId) setOpenReportId(null);
    await load();
  }

  if (loading) {
    return <p className="text-[12px] text-slate-500">불러오는 중…</p>;
  }

  const stats = [
    { label: "전체 대화", value: current?.total_turns ?? 0, warn: false },
    { label: "검색 포함", value: current?.search_turns ?? 0, warn: false },
    {
      label: "결과 없음",
      value: current?.zero_result_turns ?? 0,
      warn: (current?.zero_result_turns ?? 0) > 0
    },
    { label: "재검색 발생", value: current?.requery_turns ?? 0, warn: false },
    {
      label: "싫어요",
      value: current?.thumbs_down ?? 0,
      warn: (current?.thumbs_down ?? 0) > 0
    }
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
          {stats.map((s) => (
            <div
              key={s.label}
              className={`min-w-[100px] rounded-lg px-3 py-2.5 ${
                s.warn ? "bg-amber-50" : "bg-slate-50"
              }`}
            >
              <p className="text-[11px] text-slate-500">{s.label}</p>
              <p
                className={`text-lg font-semibold ${
                  s.warn ? "text-amber-900" : "text-slate-900"
                }`}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={aggregating}
          onClick={() => void runAggregate()}
          className="shrink-0 rounded-lg bg-[#534AB7] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
        >
          {aggregating ? "집계 중…" : "지금 집계"}
        </button>
      </div>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-900">주간 추이</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">주</th>
                <th className="px-3 py-2 font-medium">전체</th>
                <th className="px-3 py-2 font-medium">검색</th>
                <th className="px-3 py-2 font-medium">결과없음</th>
                <th className="px-3 py-2 font-medium">재검색</th>
                <th className="px-3 py-2 font-medium">싫어요</th>
                <th className="px-3 py-2 font-medium">평균응답</th>
              </tr>
            </thead>
            <tbody>
              {weeks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-slate-400">
                    집계 데이터가 없습니다. [지금 집계]를 눌러 주세요.
                  </td>
                </tr>
              ) : (
                weeks.map((w) => {
                  const zeroRate =
                    w.total_turns > 0
                      ? w.zero_result_turns / w.total_turns
                      : 0;
                  const highlight = zeroRate > 0.2;
                  return (
                    <tr
                      key={w.week_start}
                      className={`border-t border-slate-100 ${
                        highlight ? "bg-amber-50/80" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-slate-800">
                        {formatWeekLabel(w.week_start)}
                      </td>
                      <td className="px-3 py-2">{w.total_turns}</td>
                      <td className="px-3 py-2">{w.search_turns}</td>
                      <td className="px-3 py-2">{w.zero_result_turns}</td>
                      <td className="px-3 py-2">{w.requery_turns}</td>
                      <td className="px-3 py-2">{w.thumbs_down}</td>
                      <td className="px-3 py-2">
                        {formatAvgMs(w.avg_duration_ms)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-900">
          실패한 질문
        </h3>
        {failures.length === 0 ? (
          <p className="text-[12px] text-slate-400">이번 주 실패 항목이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {failures.map((f) => {
              const key = failureKey(f);
              const added = addedKeys.has(key);
              return (
                <li
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-slate-900">
                      {f.question}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-px text-[10px] font-medium ${reasonBadgeClass(
                          f.reason
                        )}`}
                      >
                        {f.reason}
                      </span>
                      <span className="text-[10.5px] text-slate-400">
                        {formatDate(f.created_at)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={added || addingKey === key}
                    onClick={() => void addEvalCase(f)}
                    className="shrink-0 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {added ? "추가됨" : "시험 문제로 추가"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">자습</h3>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={picking || Boolean(runningId)}
              onClick={() => void pickTopics()}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {picking ? "선정 중…" : "주제 선정"}
            </button>
            <button
              type="button"
              disabled={picking || Boolean(runningId) || queue.length === 0}
              onClick={() => void runQueueItem()}
              className="rounded-lg bg-[#534AB7] px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
            >
              {runningId === "__next__" ? "실행 중…" : "다음 1건 실행"}
            </button>
          </div>
        </div>

        <div>
          <h4 className="mb-1.5 text-[12px] font-medium text-slate-600">
            대기 목록
          </h4>
          {queue.length === 0 ? (
            <p className="text-[12px] text-slate-400">대기 중인 주제가 없습니다.</p>
          ) : (
            <ul className="space-y-1.5">
              {queue.map((q) => {
                const badge = sourceBadge(q.source);
                const busy = runningId === q.id;
                return (
                  <li
                    key={q.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-slate-900">
                        {q.topic}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-px text-[10px] font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        <span className="font-mono text-[10.5px] text-slate-400">
                          {Number(q.score).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(runningId)}
                      onClick={() => void runQueueItem(q.id)}
                      className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy ? "실행 중…" : "실행"}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(runningId)}
                      onClick={() => void skipQueueItem(q.id)}
                      className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    >
                      건너뛰기
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <h4 className="mb-1.5 text-[12px] font-medium text-slate-600">
            완성된 리포트
          </h4>
          {reports.length === 0 ? (
            <p className="text-[12px] text-slate-400">활성 리포트가 없습니다.</p>
          ) : (
            <ul className="space-y-1.5">
              {reports.map((r) => {
                const open = openReportId === r.id;
                return (
                  <li
                    key={r.id}
                    className="rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-slate-900">
                          {r.title}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {r.topic} · 쓰인 횟수 {r.use_count ?? 0} ·{" "}
                          {formatDate(r.created_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenReportId(open ? null : r.id)
                        }
                        className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                      >
                        {open ? "접기" : "보기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void archiveReport(r.id)}
                        className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
                      >
                        폐기
                      </button>
                    </div>
                    {open ? (
                      <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2.5 text-[12px] leading-relaxed text-slate-700">
                        {r.content}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
