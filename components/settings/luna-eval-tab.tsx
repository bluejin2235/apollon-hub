"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LunaPromptRow, LunaPromptVersionRow } from "@/lib/luna/prompts";
import { supabase } from "@/lib/supabase/client";

type Connectors = { notion: boolean; web: boolean; nas: boolean };

type PendingVerifyItem = {
  version_id: string;
  prompt_title: string;
  version: number;
  change_summary: string | null;
  prediction: string;
  created_at: string;
};

type EvalCase = {
  id: string;
  question: string;
  expectation: string;
  category: string;
  connectors: Connectors;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

type EvalRun = {
  id: string;
  label: string;
  note: string | null;
  model_label: string | null;
  total: number;
  passed: number;
  failed: number;
  status: "running" | "done" | "stopped";
  started_at: string;
  finished_at: string | null;
};

type EvalResult = {
  id: string;
  run_id: string;
  case_id: string;
  answer: string;
  sources: unknown;
  verdict: "pass" | "fail" | null;
  memo: string | null;
  auto_pass?: boolean | null;
  auto_reason?: string | null;
  duration_ms: number | null;
  model_label: string | null;
  created_at: string;
  my_score?: number | null;
  my_comment?: string | null;
  human_avg?: number | null;
  case?: {
    id: string;
    question: string;
    expectation: string;
    category: string;
    connectors: Connectors;
    sort_order: number;
  } | null;
};

type RunSummary = {
  auto_passed: number;
  auto_total: number;
  human_avg: number | null;
};

type CaseDraft = {
  question: string;
  expectation: string;
  category: string;
  connectors: Connectors;
  sort_order: number;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function normalizeConnectors(raw: unknown): Connectors {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    notion: obj.notion === true,
    web: obj.web === true,
    nas: obj.nas === true
  };
}

function formatRunDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function AnswerBlock({ answer }: { answer: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = answer.split("\n");
  const needsMore = lines.length > 6 || answer.length > 420;
  const shown =
    expanded || !needsMore
      ? answer
      : lines.slice(0, 6).join("\n").slice(0, 420) + (needsMore ? "…" : "");

  return (
    <div className="rounded bg-slate-50 p-2 text-[12px] leading-relaxed text-slate-800 whitespace-pre-wrap">
      {shown || "(응답 없음)"}
      {needsMore ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 block text-[11px] text-[#534AB7]"
        >
          {expanded ? "접기" : "더보기"}
        </button>
      ) : null}
    </div>
  );
}

export function LunaEvalTab() {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaseDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [liveResults, setLiveResults] = useState<EvalResult[]>([]);
  const [pendingVerify, setPendingVerify] = useState<PendingVerifyItem[]>([]);
  const [verifyNotes, setVerifyNotes] = useState<Record<string, string>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);

  const activeCount = useMemo(
    () => cases.filter((c) => c.is_active).length,
    [cases]
  );

  const doneRuns = useMemo(
    () => runs.filter((r) => r.status === "done"),
    [runs]
  );
  const latestDone = doneRuns[0] ?? null;
  const previousDone = doneRuns[1] ?? null;

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [casesRes, runsRes] = await Promise.all([
      fetch("/api/luna/eval/cases", { headers }),
      fetch("/api/luna/eval/runs", { headers })
    ]);
    if (casesRes.ok) {
      const json = (await casesRes.json()) as { cases?: EvalCase[] };
      setCases(
        (json.cases ?? []).map((c) => ({
          ...c,
          connectors: normalizeConnectors(c.connectors)
        }))
      );
    }
    if (runsRes.ok) {
      const json = (await runsRes.json()) as { runs?: EvalRun[] };
      setRuns(json.runs ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadResults(runId: string) {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch(`/api/luna/eval/results?run_id=${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setMessage(`결과 불러오기 실패: ${await res.text()}`);
      return;
    }
    const json = (await res.json()) as {
      results?: EvalResult[];
      summary?: RunSummary;
    };
    const list = (json.results ?? []).map((r) => ({
      ...r,
      case: r.case
        ? Array.isArray(r.case)
          ? (r.case[0] as EvalResult["case"])
          : r.case
        : null
    }));
    setResults(list);
    setRunSummary(json.summary ?? null);
  }

  async function loadPendingVerify(run: EvalRun) {
    const token = await getAccessToken();
    if (!token) {
      setPendingVerify([]);
      return;
    }
    const res = await fetch("/api/luna/prompts", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setPendingVerify([]);
      return;
    }
    const json = (await res.json()) as { prompts?: LunaPromptRow[] };
    const before = new Date(run.started_at).getTime();
    const items: PendingVerifyItem[] = [];
    for (const p of json.prompts ?? []) {
      for (const v of (p.versions ?? []) as LunaPromptVersionRow[]) {
        const prediction = v.prediction?.trim() ?? "";
        if (!prediction) continue;
        if (v.verify_result) continue;
        const created = new Date(v.created_at).getTime();
        if (Number.isNaN(created) || created >= before) continue;
        items.push({
          version_id: v.id,
          prompt_title: p.title,
          version: v.version,
          change_summary: v.change_summary,
          prediction,
          created_at: v.created_at
        });
      }
    }
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    setPendingVerify(items.slice(0, 10));
  }

  async function submitVerify(
    versionId: string,
    result: "confirmed" | "refuted" | "inconclusive"
  ) {
    if (!selectedRunId || verifyingId) return;
    const token = await getAccessToken();
    if (!token) return;
    setVerifyingId(versionId);
    try {
      const res = await fetch("/api/luna/prompts/verify", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          version_id: versionId,
          verify_result: result,
          verify_note: (verifyNotes[versionId] ?? "").trim(),
          run_id: selectedRunId
        })
      });
      if (!res.ok) {
        setMessage(`검증 저장 실패: ${await res.text()}`);
        return;
      }
      setPendingVerify((prev) => prev.filter((p) => p.version_id !== versionId));
      setMessage("검증을 저장했습니다.");
    } finally {
      setVerifyingId(null);
    }
  }

  function openCase(c: EvalCase) {
    if (openCaseId === c.id) {
      setOpenCaseId(null);
      setDraft(null);
      return;
    }
    setOpenCaseId(c.id);
    setDraft({
      question: c.question,
      expectation: c.expectation ?? "",
      category: c.category ?? "",
      connectors: normalizeConnectors(c.connectors),
      sort_order: c.sort_order ?? 0
    });
  }

  async function toggleActive(c: EvalCase) {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("/api/luna/eval/cases", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: c.id, is_active: !c.is_active })
    });
    if (!res.ok) {
      setMessage(`활성 변경 실패: ${await res.text()}`);
      return;
    }
    setCases((prev) =>
      prev.map((row) => (row.id === c.id ? { ...row, is_active: !c.is_active } : row))
    );
  }

  async function saveCase(c: EvalCase) {
    if (!draft) return;
    setSaving(true);
    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      return;
    }
    const res = await fetch("/api/luna/eval/cases", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: c.id, ...draft })
    });
    setSaving(false);
    if (!res.ok) {
      setMessage(`저장 실패: ${await res.text()}`);
      return;
    }
    setOpenCaseId(null);
    setDraft(null);
    await load();
  }

  async function deleteCase(c: EvalCase) {
    if (!window.confirm("이 시험 문제를 삭제할까요?")) return;
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("/api/luna/eval/cases", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: c.id })
    });
    if (!res.ok) {
      setMessage(`삭제 실패: ${await res.text()}`);
      return;
    }
    setOpenCaseId(null);
    setDraft(null);
    await load();
  }

  async function addCase() {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("/api/luna/eval/cases", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: "새 시험 문제",
        expectation: "",
        category: "general",
        connectors: { notion: true, web: true, nas: true },
        sort_order: cases.length + 1
      })
    });
    if (!res.ok) {
      setMessage(`추가 실패: ${await res.text()}`);
      return;
    }
    const json = (await res.json()) as { case?: EvalCase };
    await load();
    if (json.case?.id) {
      setOpenCaseId(json.case.id);
      setDraft({
        question: json.case.question,
        expectation: json.case.expectation ?? "",
        category: json.case.category ?? "",
        connectors: normalizeConnectors(json.case.connectors),
        sort_order: json.case.sort_order ?? 0
      });
    }
  }

  async function openRunDetail(runId: string) {
    const run = runs.find((r) => r.id === runId) ?? null;
    setSelectedRunId(runId);
    setView("detail");
    setLiveResults([]);
    setPendingVerify([]);
    await loadResults(runId);
    if (run) await loadPendingVerify(run);
  }

  async function runAll() {
    const active = cases.filter((c) => c.is_active);
    if (active.length === 0) {
      setMessage("활성 시험 문제가 없습니다.");
      return;
    }
    if (!window.confirm(`시험 문제 ${active.length}개를 실행합니다. 계속할까요?`)) {
      return;
    }

    const token = await getAccessToken();
    if (!token) return;

    setRunning(true);
    setProgress({ done: 0, total: active.length });
    setLiveResults([]);
    setView("detail");
    setMessage("");

    const createRes = await fetch("/api/luna/eval/runs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    if (!createRes.ok) {
      setRunning(false);
      setMessage(`회차 생성 실패: ${await createRes.text()}`);
      return;
    }
    const created = (await createRes.json()) as { run?: EvalRun };
    const run = created.run;
    if (!run) {
      setRunning(false);
      setMessage("회차 생성 실패");
      return;
    }

    setSelectedRunId(run.id);
    setRuns((prev) => [run, ...prev]);
    setResults([]);

    const collected: EvalResult[] = [];
    for (let i = 0; i < active.length; i += 1) {
      const c = active[i];
      const oneRes = await fetch("/api/luna/eval/run-one", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ run_id: run.id, case_id: c.id })
      });
      if (oneRes.ok) {
        const json = (await oneRes.json()) as { result?: EvalResult };
        if (json.result) {
          const row: EvalResult = {
            ...json.result,
            case: {
              id: c.id,
              question: c.question,
              expectation: c.expectation,
              category: c.category,
              connectors: c.connectors,
              sort_order: c.sort_order
            }
          };
          collected.push(row);
          setLiveResults([...collected]);
          setResults([...collected]);
        }
      } else {
        console.error("[luna/eval] run-one", await oneRes.text());
      }
      setProgress({ done: i + 1, total: active.length });
    }

    await fetch("/api/luna/eval/runs", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: run.id,
        status: "done",
        finished_at: new Date().toISOString()
      })
    });

    await fetch("/api/luna/eval/finalize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ run_id: run.id })
    });

    setRunning(false);
    await load();
    await loadResults(run.id);
    await loadPendingVerify(run);
  }

  const displayResults = view === "detail" ? (liveResults.length > 0 && running ? liveResults : results.length > 0 ? results : liveResults) : [];

  if (loading) {
    return <div className="text-sm text-slate-400">불러오는 중…</div>;
  }

  if (view === "detail" && selectedRun) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{selectedRun.label}</h2>
            <p className="text-[12px] text-slate-500">
              {selectedRun.model_label || "-"} · {selectedRun.status}
            </p>
            <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-slate-700">
              <span>
                자동 점수{" "}
                <span className="font-medium text-slate-900">
                  {runSummary
                    ? `${runSummary.auto_passed}/${runSummary.auto_total}`
                    : `${selectedRun.passed}/${selectedRun.total}`}
                </span>
              </span>
              <span>
                사람 평균{" "}
                <span className="font-medium text-slate-900">
                  {runSummary?.human_avg != null
                    ? `${runSummary.human_avg}/10`
                    : "—"}
                </span>
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={() => {
              setView("list");
              setSelectedRunId(null);
              setLiveResults([]);
            }}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-700 disabled:opacity-40"
          >
            뒤로
          </button>
        </div>

        {running ? (
          <p className="text-[12px] text-[#534AB7]">
            {progress.done} / {progress.total} 실행 중
          </p>
        ) : null}

        {message ? <p className="text-[12px] text-slate-600">{message}</p> : null}

        {pendingVerify.length > 0 ? (
          <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <h3 className="text-[13px] font-semibold text-slate-800">
              검증 대기 중인 수정
            </h3>
            {pendingVerify.map((item) => (
              <div
                key={item.version_id}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-2"
              >
                <p className="text-[13px] font-medium text-slate-900">
                  {item.prompt_title}{" "}
                  <span className="font-mono text-[11px] text-slate-500">
                    v{item.version}
                  </span>
                </p>
                <p className="mt-0.5 text-[11.5px] text-gray-500">
                  {item.change_summary || ""}
                </p>
                <p className="mt-1 text-[12px] font-medium text-slate-800">
                  → {item.prediction}
                </p>
                <input
                  value={verifyNotes[item.version_id] ?? ""}
                  onChange={(e) =>
                    setVerifyNotes((prev) => ({
                      ...prev,
                      [item.version_id]: e.target.value
                    }))
                  }
                  placeholder="메모 (선택)"
                  className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-[12px]"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={verifyingId === item.version_id}
                    onClick={() => void submitVerify(item.version_id, "confirmed")}
                    className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-800 disabled:opacity-50"
                  >
                    확인됨
                  </button>
                  <button
                    type="button"
                    disabled={verifyingId === item.version_id}
                    onClick={() => void submitVerify(item.version_id, "refuted")}
                    className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] text-red-800 disabled:opacity-50"
                  >
                    효과 없음
                  </button>
                  <button
                    type="button"
                    disabled={verifyingId === item.version_id}
                    onClick={() =>
                      void submitVerify(item.version_id, "inconclusive")
                    }
                    className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-900 disabled:opacity-50"
                  >
                    판단 불가
                  </button>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <div className="space-y-2">
          {displayResults.map((r) => {
            const q = r.case?.question ?? "";
            const exp = r.case?.expectation ?? "";
            const open = expandedResultId === r.id;
            const autoPass =
              typeof r.auto_pass === "boolean"
                ? r.auto_pass
                : r.verdict === "pass"
                  ? true
                  : r.verdict === "fail"
                    ? false
                    : null;
            return (
              <div
                key={r.id}
                className="rounded-lg border border-solid border-slate-200 px-2.5 py-[9px]"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedResultId((prev) => (prev === r.id ? null : r.id))
                  }
                  className="flex w-full items-start justify-between gap-2 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-900">{q}</p>
                    <p className="mt-1 text-[11.5px] text-gray-500">
                      {exp || "(채점 기준 없음)"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${
                      autoPass === true
                        ? "bg-[#E1F5EE] text-[#04342C]"
                        : autoPass === false
                          ? "bg-[#FBEAF0] text-[#72243E]"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {autoPass === true
                      ? "합격"
                      : autoPass === false
                        ? "실패"
                        : "대기"}
                  </span>
                </button>

                {open ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-medium text-slate-500">
                        루나 답변
                      </p>
                      <AnswerBlock answer={r.answer || ""} />
                      <p className="mt-1.5 text-[10.5px] text-gray-400">
                        {r.duration_ms != null
                          ? `${(r.duration_ms / 1000).toFixed(1)}초`
                          : "-"}{" "}
                        · {r.model_label || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-medium text-slate-500">
                        자동 판정
                      </p>
                      <div
                        className={`rounded-lg px-2.5 py-2 text-[12px] ${
                          autoPass === true
                            ? "bg-[#E1F5EE] text-[#04342C]"
                            : autoPass === false
                              ? "bg-[#FBEAF0] text-[#72243E]"
                              : "bg-slate-50 text-slate-600"
                        }`}
                      >
                        <p className="font-medium">
                          {autoPass === true
                            ? "합격"
                            : autoPass === false
                              ? "실패"
                              : "미판정"}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-[11px] opacity-90">
                          {r.auto_reason || "사유 없음"}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {displayResults.length === 0 && !running ? (
            <p className="text-[12px] text-slate-400">결과가 없습니다.</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 상단 요약 — 자동/사람 점수 분리, 합산 금지 */}
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 px-2.5 py-[9px]">
            <div className="text-[11px] text-slate-500">자동 점수</div>
            <div className="mt-0.5 text-[15px] font-medium text-slate-900">
              {latestDone ? `${latestDone.passed}/${latestDone.total}` : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-[9px]">
            <div className="text-[11px] text-slate-500">직전 자동</div>
            <div className="mt-0.5 text-[15px] font-medium text-gray-500">
              {previousDone ? `${previousDone.passed}/${previousDone.total}` : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-[9px]">
            <div className="text-[11px] text-slate-500">사람 평균</div>
            <div className="mt-0.5 text-[15px] font-medium text-slate-900">
              {runSummary?.human_avg != null && selectedRunId
                ? `${runSummary.human_avg}/10`
                : "시험 보기에서 확인"}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2.5 py-[9px]">
            <div className="text-[11px] text-slate-500">시험 문제 수</div>
            <div className="mt-0.5 text-[15px] font-medium text-slate-900">{activeCount}</div>
          </div>
        </div>
        <button
          type="button"
          disabled={running || activeCount === 0}
          onClick={() => void runAll()}
          className="shrink-0 rounded-lg bg-[#534AB7] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-40"
        >
          시험 보기
        </button>
      </div>

      {running ? (
        <p className="text-[12px] text-[#534AB7]">
          {progress.done} / {progress.total} 실행 중
        </p>
      ) : null}
      {message ? <p className="text-[12px] text-slate-600">{message}</p> : null}

      {/* 섹션 1 시험 문제 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-slate-900">
            시험 문제 <span className="font-normal text-slate-400">{cases.length}</span>
          </h3>
          <button
            type="button"
            onClick={() => void addCase()}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            ＋ 추가
          </button>
        </div>

        {cases.map((c, index) => {
          const open = openCaseId === c.id;
          return (
            <div key={c.id} className="mb-1">
              <button
                type="button"
                onClick={() => openCase(c)}
                className="flex w-full items-center gap-2 rounded-lg border border-solid border-slate-200 px-2.5 py-[9px] text-left"
              >
                <span className="w-5 shrink-0 font-mono text-[10.5px] text-gray-400">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-900">
                  {c.question}
                </span>
                <span className="shrink-0 rounded bg-[#F1EFE8] px-1.5 py-0.5 text-[9.5px] text-[#5F5E5A]">
                  {c.category || "-"}
                </span>
                <span
                  role="switch"
                  aria-checked={c.is_active}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleActive(c);
                  }}
                  className={`shrink-0 cursor-pointer rounded-full border border-solid px-2 py-px text-[9px] ${
                    c.is_active
                      ? "border-[#0F6E56] bg-[#E1F5EE] text-[#04342C]"
                      : "border-[#D3D1C7] bg-transparent text-gray-500"
                  }`}
                >
                  {c.is_active ? "ON" : "OFF"}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{open ? "⌃" : "⌄"}</span>
              </button>

              {open && draft ? (
                <div className="rounded-b-lg border border-t-0 border-solid border-[#534AB7] p-3">
                  <label className="mb-2 block">
                    <span className="mb-1 block text-[11px] text-gray-500">질문</span>
                    <textarea
                      rows={2}
                      value={draft.question}
                      onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                      className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                    />
                  </label>
                  <label className="mb-2 block">
                    <span className="mb-1 block text-[11px] text-gray-500">채점 기준</span>
                    <textarea
                      rows={3}
                      value={draft.expectation}
                      onChange={(e) => setDraft({ ...draft, expectation: e.target.value })}
                      placeholder="어떤 답이 나오면 통과인지"
                      className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                    />
                  </label>
                  <label className="mb-2 block">
                    <span className="mb-1 block text-[11px] text-gray-500">카테고리</span>
                    <input
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                      className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                    />
                  </label>
                  <div className="mb-2">
                    <span className="mb-1 block text-[11px] text-gray-500">검색 범위</span>
                    <div className="flex flex-wrap gap-3 text-[12px] text-slate-700">
                      {(
                        [
                          ["notion", "노션"],
                          ["nas", "Work서버"],
                          ["web", "웹"]
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={draft.connectors[key]}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                connectors: {
                                  ...draft.connectors,
                                  [key]: e.target.checked
                                }
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="mb-3 block">
                    <span className="mb-1 block text-[11px] text-gray-500">정렬 순서</span>
                    <input
                      type="number"
                      value={draft.sort_order}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          sort_order: Number(e.target.value) || 0
                        })
                      }
                      className="w-[110px] rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void saveCase(c)}
                      className="rounded bg-[#534AB7] px-3 py-1.5 text-[12px] text-white disabled:opacity-40"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCase(c)}
                      className="rounded border border-slate-200 px-3 py-1.5 text-[12px] text-slate-600"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      {/* 섹션 2 실행 이력 */}
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-900">실행 이력</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2.5 py-2 font-medium">회차</th>
                <th className="px-2.5 py-2 font-medium">날짜</th>
                <th className="px-2.5 py-2 font-medium">모델</th>
                <th className="px-2.5 py-2 font-medium">점수</th>
                <th className="px-2.5 py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2.5 py-4 text-center text-slate-400">
                    이력이 없습니다.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => void openRunDetail(r.id)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-2.5 py-2 font-medium text-slate-800">{r.label}</td>
                    <td className="px-2.5 py-2 text-slate-600">{formatRunDate(r.started_at)}</td>
                    <td className="px-2.5 py-2 font-mono text-[11px] text-slate-600">
                      {r.model_label || "-"}
                    </td>
                    <td className="px-2.5 py-2 text-slate-700">
                      {r.passed} / {r.total}
                    </td>
                    <td className="px-2.5 py-2 text-slate-600">{r.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
