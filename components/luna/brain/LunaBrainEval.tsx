"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  KnowledgeShell,
  ListCard,
  LoadingLine,
  Toolbar
} from "@/components/luna/knowledge/ui";
import {
  BarChart,
  BrainCard,
  brainFetch,
  formatDateTime,
  getAccessToken,
  InfoBar
} from "@/components/luna/brain/shared";
import { K } from "@/lib/luna/knowledge-format";

type EvalRun = {
  id: string;
  label: string | null;
  note: string | null;
  total: number | null;
  passed: number | null;
  failed: number | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  tier?: string | null;
  score_sum?: number | null;
  score_max?: number | null;
};

type EvalCase = {
  id: string;
  question: string;
  expectation: string | null;
  category: string | null;
  sort_order: number | null;
  is_active: boolean;
  tier?: string | null;
  must_pass?: string | null;
  quality?: string | null;
};

type EvalResult = {
  id: string;
  case_id: string;
  answer: string | null;
  verdict: string | null;
  memo: string | null;
  auto_pass: boolean | null;
  auto_reason: string | null;
  score?: number | null;
  fail_kind?: string | null;
  case?: {
    id: string;
    question: string;
    category: string | null;
    sort_order: number | null;
    tier?: string | null;
    must_pass?: string | null;
    quality?: string | null;
  } | null;
};

type TierLastRun = {
  id: string;
  finished_at: string | null;
  started_at: string | null;
  status: string;
  score_sum: number | null;
  score_max: number | null;
  passed: number | null;
  total: number | null;
  ok: boolean;
};

type SchedulePayload = {
  schedule: {
    light: { enabled: boolean; hour: number; minute: number };
    heavy: {
      enabled: boolean;
      weekday: number;
      hour: number;
      minute: number;
    };
  };
  light: {
    enabled: boolean;
    hour: number;
    minute: number;
    time_label: string;
    cadence_label: string;
    next_label: string;
    search_label: string;
  };
  heavy: {
    enabled: boolean;
    weekday: number;
    hour: number;
    minute: number;
    time_label: string;
    weekday_label: string;
    cadence_label: string;
    next_label: string;
    search_label: string;
  };
  conflicts: Array<{ tier: string; message: string }>;
  cron_note: string;
  last_runs: { light: TierLastRun | null; heavy: TierLastRun | null };
  case_counts: { light: number; heavy: number };
};

function runScore(run: EvalRun): number {
  if (typeof run.score_sum === "number") return Number(run.score_sum);
  return run.passed ?? 0;
}

function runMax(run: EvalRun): number {
  if (typeof run.score_max === "number" && run.score_max > 0) {
    return Number(run.score_max);
  }
  if (run.tier === "light") return 12;
  if (run.tier === "heavy") return 8;
  return run.total ?? 0;
}

function tierBadgeLabel(tier: string | null | undefined): string {
  if (tier === "light") return "light";
  if (tier === "heavy") return "heavy";
  if (tier === "prompt") return "prompt";
  if (tier === "mixed") return "전체";
  return "구 문항 기준";
}

function resultKind(
  result: EvalResult
): "pass" | "partial" | "must_fail" | "fail" | "unknown" {
  if (result.fail_kind === "must_pass") return "must_fail";
  if (result.fail_kind === "quality" || result.verdict === "partial") {
    return "partial";
  }
  if (result.verdict === "pass" || result.auto_pass === true) return "pass";
  if (result.verdict === "fail" || result.auto_pass === false) return "fail";
  if (typeof result.score === "number") {
    if (result.score >= 1) return "pass";
    if (result.score >= 0.5) return "partial";
    return "fail";
  }
  return "unknown";
}

function lastRunSummary(last: TierLastRun | null): string {
  if (!last) return "마지막 실행 없음";
  const when = formatDateTime(last.finished_at ?? last.started_at);
  const score =
    last.score_sum != null && last.score_max != null
      ? `${last.score_sum}/${last.score_max}`
      : last.passed != null && last.total != null
        ? `${last.passed}/${last.total}`
        : "—";
  const ok =
    last.status === "done"
      ? "성공"
      : last.status === "running"
        ? "실행 중"
        : "실패";
  return `${when} · ${ok} · ${score}`;
}

function timeInputValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function LunaBrainEval() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [scheduleInfo, setScheduleInfo] = useState<SchedulePayload | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCases, setShowCases] = useState(false);
  const [openResultId, setOpenResultId] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [editing, setEditing] = useState<"light" | "heavy" | null>(null);
  const [editLight, setEditLight] = useState({
    enabled: true,
    hour: 3,
    minute: 40
  });
  const [editHeavy, setEditHeavy] = useState({
    enabled: true,
    weekday: 0,
    hour: 3,
    minute: 50
  });

  const loadResultsFor = useCallback(async (runId: string) => {
    const resultRes = await brainFetch<{ results?: EvalResult[] }>(
      `/api/luna/eval/results?run_id=${runId}`
    );
    setResults(resultRes.results ?? []);
    setSelectedRunId(runId);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [runRes, caseRes, schedRes] = await Promise.all([
        brainFetch<{ runs?: EvalRun[] }>("/api/luna/eval/runs"),
        brainFetch<{ cases?: EvalCase[] }>("/api/luna/eval/cases"),
        brainFetch<SchedulePayload>("/api/luna/eval/schedule")
      ]);
      const runList = runRes.runs ?? [];
      setRuns(runList);
      setCases(caseRes.cases ?? []);
      setScheduleInfo(schedRes);

      const preferred =
        runList.find((r) => r.id === selectedRunId) ??
        runList.find((r) => r.status === "done") ??
        runList[0];
      if (preferred) {
        await loadResultsFor(preferred.id);
      } else {
        setResults([]);
        setSelectedRunId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [loadResultsFor, selectedRunId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const doneRuns = useMemo(
    () => runs.filter((r) => r.status === "done" && r.total),
    [runs]
  );

  const selectedRun =
    runs.find((r) => r.id === selectedRunId) ?? doneRuns[0] ?? runs[0] ?? null;

  const lightTrend = useMemo(() => {
    const recent = doneRuns
      .filter((r) => r.tier === "light")
      .slice(0, 4)
      .reverse();
    return recent.map((run, i) => {
      const prev = i > 0 ? recent[i - 1] : null;
      const score = runScore(run);
      const max = runMax(run);
      return {
        label: `${score}/${max}`,
        value: score,
        tone: prev && runScore(prev) > score ? ("down" as const) : undefined
      };
    });
  }, [doneRuns]);

  const heavyTrend = useMemo(() => {
    const recent = doneRuns
      .filter((r) => r.tier === "heavy")
      .slice(0, 4)
      .reverse();
    return recent.map((run, i) => {
      const prev = i > 0 ? recent[i - 1] : null;
      const score = runScore(run);
      const max = runMax(run);
      return {
        label: `${score}/${max}`,
        value: score,
        tone: prev && runScore(prev) > score ? ("down" as const) : undefined
      };
    });
  }, [doneRuns]);

  const activeCases = cases.filter((c) => c.is_active);
  const lightCount =
    scheduleInfo?.case_counts.light ??
    activeCases.filter((c) => c.tier === "light").length;
  const heavyCount =
    scheduleInfo?.case_counts.heavy ??
    activeCases.filter((c) => c.tier === "heavy").length;

  const sortedResults = useMemo(
    () =>
      results
        .slice()
        .sort((a, b) => (a.case?.sort_order ?? 0) - (b.case?.sort_order ?? 0)),
    [results]
  );

  function startEdit(tier: "light" | "heavy") {
    if (!scheduleInfo) return;
    if (tier === "light") {
      setEditLight({ ...scheduleInfo.schedule.light });
    } else {
      setEditHeavy({ ...scheduleInfo.schedule.heavy });
    }
    setEditing(tier);
  }

  async function saveSchedule(force = false) {
    if (!scheduleInfo || !editing) return;
    setBusy(true);
    setNotice("");
    try {
      const body =
        editing === "light"
          ? { light: editLight, force }
          : { heavy: editHeavy, force };
      const token = await getAccessToken();
      if (!token) throw new Error("로그인이 필요합니다.");
      const res = await fetch("/api/luna/eval/schedule", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const json = (await res.json()) as SchedulePayload & {
        error?: string;
        message?: string;
        conflicts?: Array<{ message: string }>;
      };
      if (res.status === 409) {
        const msg =
          json.message ||
          json.conflicts?.map((c) => c.message).join(" · ") ||
          "다른 작업과 시각이 겹칩니다";
        if (
          typeof window !== "undefined" &&
          window.confirm(`${msg}\n\n그래도 저장할까요?`)
        ) {
          await saveSchedule(true);
          return;
        }
        setNotice(msg);
        return;
      }
      if (!res.ok) {
        throw new Error(json.error ?? json.message ?? "저장 실패");
      }
      setScheduleInfo(json);
      setEditing(null);
      setNotice("스케줄을 저장했습니다.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function runExam(tier: "light" | "heavy" | "all") {
    setBusy(true);
    setNotice("");
    try {
      const body: { force: boolean; tier?: string } = { force: true };
      if (tier === "light" || tier === "heavy") body.tier = tier;
      const res = await brainFetch<{
        skipped: boolean;
        reason?: string;
        run_id?: string;
        passed?: number;
        total?: number;
        score_sum?: number;
        score_max?: number;
        tier?: string;
      }>("/api/luna/eval/exam", {
        method: "POST",
        body: JSON.stringify(body)
      });
      const score =
        res.score_sum != null && res.score_max != null
          ? `${res.score_sum}/${res.score_max}`
          : `${res.passed ?? 0}/${res.total ?? 0}`;
      setNotice(
        res.skipped
          ? `건너뜀: ${res.reason ?? "실행 조건 미충족"}`
          : `${tier === "all" ? "전체" : tier} 실행 완료 · ${score}점`
      );
      if (res.run_id) setSelectedRunId(res.run_id);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "실행하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function addCase() {
    if (!newQuestion.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/eval/cases", {
        method: "POST",
        body: JSON.stringify({
          question: newQuestion.trim(),
          category: newCategory.trim(),
          sort_order: activeCases.length + 1
        })
      });
      setNewQuestion("");
      setNewCategory("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "문항을 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCase(item: EvalCase) {
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/eval/cases", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, is_active: !item.is_active })
      });
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const selectedMax = selectedRun ? runMax(selectedRun) : null;
  const selectedScore = selectedRun ? runScore(selectedRun) : null;

  return (
    <KnowledgeShell>
      <InfoBar>
        매일 light(검색 없음)·매주 heavy(검색 포함)로 나눕니다. 필수 위반은
        프롬프트 문제, 품질 미달은 자습 재료입니다.
        {scheduleInfo?.cron_note ? (
          <>
            <br />
            <span style={{ color: K.faint }}>{scheduleInfo.cron_note}</span>
          </>
        ) : null}
      </InfoBar>

      {notice ? (
        <p className="mb-2.5 text-[12px]" style={{ color: K.luna }}>
          {notice}
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <LoadingLine /> : null}

      {!loading && !error ? (
        <>
          <BrainCard>
            <div className="mb-2 text-[13px] font-bold">실행 스케줄</div>

            {/* light */}
            <div
              className="mb-2 rounded-lg border px-3 py-2.5"
              style={{ borderColor: K.line2 }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge kind="src">light</Badge>
                {editing === "light" ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-[12px]">
                      <input
                        type="checkbox"
                        checked={editLight.enabled}
                        onChange={(e) =>
                          setEditLight((s) => ({
                            ...s,
                            enabled: e.target.checked
                          }))
                        }
                      />
                      사용
                    </label>
                    <input
                      type="time"
                      className="rounded border px-2 py-1 text-[12px]"
                      style={{ borderColor: K.line }}
                      value={timeInputValue(editLight.hour, editLight.minute)}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(":").map(Number);
                        setEditLight((s) => ({
                          ...s,
                          hour: h ?? 3,
                          minute: m ?? 0
                        }));
                      }}
                    />
                    <Btn disabled={busy} onClick={() => void saveSchedule()}>
                      저장
                    </Btn>
                    <Btn disabled={busy} onClick={() => setEditing(null)}>
                      취소
                    </Btn>
                  </div>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-[12.5px]">
                      {scheduleInfo?.light.cadence_label ?? "매일"}{" "}
                      {scheduleInfo?.light.time_label ?? "03:40"} ·{" "}
                      {lightCount}문항 ·{" "}
                      {scheduleInfo?.light.search_label ?? "검색 없음"} · 다음
                      실행 {scheduleInfo?.light.next_label ?? "—"}
                      {!scheduleInfo?.light.enabled ? (
                        <span style={{ color: K.faint }}> (꺼짐)</span>
                      ) : null}
                    </span>
                    <Btn disabled={busy} onClick={() => startEdit("light")}>
                      변경
                    </Btn>
                  </>
                )}
              </div>
              <div className="mt-1 text-[11.5px]" style={{ color: K.faint }}>
                {lastRunSummary(scheduleInfo?.last_runs.light ?? null)}
              </div>
            </div>

            {/* heavy */}
            <div
              className="rounded-lg border px-3 py-2.5"
              style={{ borderColor: K.line2 }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge kind="org">heavy</Badge>
                {editing === "heavy" ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-[12px]">
                      <input
                        type="checkbox"
                        checked={editHeavy.enabled}
                        onChange={(e) =>
                          setEditHeavy((s) => ({
                            ...s,
                            enabled: e.target.checked
                          }))
                        }
                      />
                      사용
                    </label>
                    <select
                      className="rounded border px-2 py-1 text-[12px]"
                      style={{ borderColor: K.line }}
                      value={editHeavy.weekday}
                      onChange={(e) =>
                        setEditHeavy((s) => ({
                          ...s,
                          weekday: Number(e.target.value)
                        }))
                      }
                    >
                      {["일", "월", "화", "수", "목", "금", "토"].map(
                        (label, i) => (
                          <option key={label} value={i}>
                            {label}요일
                          </option>
                        )
                      )}
                    </select>
                    <input
                      type="time"
                      className="rounded border px-2 py-1 text-[12px]"
                      style={{ borderColor: K.line }}
                      value={timeInputValue(editHeavy.hour, editHeavy.minute)}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(":").map(Number);
                        setEditHeavy((s) => ({
                          ...s,
                          hour: h ?? 3,
                          minute: m ?? 0
                        }));
                      }}
                    />
                    <Btn disabled={busy} onClick={() => void saveSchedule()}>
                      저장
                    </Btn>
                    <Btn disabled={busy} onClick={() => setEditing(null)}>
                      취소
                    </Btn>
                  </div>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-[12.5px]">
                      {scheduleInfo?.heavy.cadence_label ?? "매주 일요일"}{" "}
                      {scheduleInfo?.heavy.time_label ?? "03:50"} ·{" "}
                      {heavyCount}문항 ·{" "}
                      {scheduleInfo?.heavy.search_label ?? "검색 포함"} · 다음
                      실행 {scheduleInfo?.heavy.next_label ?? "—"}
                      {!scheduleInfo?.heavy.enabled ? (
                        <span style={{ color: K.faint }}> (꺼짐)</span>
                      ) : null}
                    </span>
                    <Btn disabled={busy} onClick={() => startEdit("heavy")}>
                      변경
                    </Btn>
                  </>
                )}
              </div>
              <div className="mt-1 text-[11.5px]" style={{ color: K.faint }}>
                {lastRunSummary(scheduleInfo?.last_runs.heavy ?? null)}
              </div>
            </div>

            {(scheduleInfo?.conflicts.length ?? 0) > 0 ? (
              <p className="mt-2 text-[11.5px]" style={{ color: "#A32D2D" }}>
                경고:{" "}
                {scheduleInfo!.conflicts.map((c) => c.message).join(" · ")}
              </p>
            ) : null}
          </BrainCard>

          <div className="mb-3 grid grid-cols-1 gap-2.5 min-[801px]:grid-cols-2">
            <BrainCard>
              <div className="flex flex-wrap items-center gap-2">
                <Badge kind="src">light</Badge>
                <span className="flex-1 text-[13px] font-bold">점수 추이</span>
                <span className="text-[11.5px]" style={{ color: K.faint }}>
                  12점 만점 · 매일
                </span>
              </div>
              {lightTrend.length > 0 ? (
                <BarChart bars={lightTrend} height={56} />
              ) : (
                <p className="mt-2.5 text-[12px]" style={{ color: K.faint }}>
                  light 실행 기록이 없습니다.
                </p>
              )}
            </BrainCard>
            <BrainCard>
              <div className="flex flex-wrap items-center gap-2">
                <Badge kind="org">heavy</Badge>
                <span className="flex-1 text-[13px] font-bold">점수 추이</span>
                <span className="text-[11.5px]" style={{ color: K.faint }}>
                  8점 만점 · 주간
                </span>
              </div>
              {heavyTrend.length > 0 ? (
                <BarChart bars={heavyTrend} height={56} />
              ) : (
                <p className="mt-2.5 text-[12px]" style={{ color: K.faint }}>
                  heavy 실행 기록이 없습니다.
                </p>
              )}
            </BrainCard>
          </div>

          <div className="mb-3 grid grid-cols-1 gap-2 min-[701px]:grid-cols-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExam("light")}
              className="rounded-[10px] border px-3 py-3 text-left disabled:opacity-50"
              style={{ borderColor: K.line, background: K.panel }}
            >
              <div className="text-[13px] font-bold">light 실행</div>
              <div className="mt-0.5 text-[12px]" style={{ color: K.sub }}>
                {lightCount}문항 · 검색 없음
              </div>
              <div className="mt-1 text-[11px]" style={{ color: K.faint }}>
                예상 200~300원
              </div>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExam("heavy")}
              className="rounded-[10px] border px-3 py-3 text-left disabled:opacity-50"
              style={{ borderColor: K.line, background: K.panel }}
            >
              <div className="text-[13px] font-bold">heavy 실행</div>
              <div className="mt-0.5 text-[12px]" style={{ color: K.sub }}>
                {heavyCount}문항 · 검색 포함
              </div>
              <div className="mt-1 text-[11px]" style={{ color: K.faint }}>
                예상 800~1,000원
              </div>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExam("all")}
              className="rounded-[10px] border px-3 py-3 text-left disabled:opacity-50"
              style={{ borderColor: K.line, background: K.panel }}
            >
              <div className="text-[13px] font-bold">전체 실행</div>
              <div className="mt-0.5 text-[12px]" style={{ color: K.sub }}>
                {lightCount + heavyCount}문항
              </div>
              <div className="mt-1 text-[11px]" style={{ color: K.faint }}>
                예상 1,000~1,300원
              </div>
            </button>
          </div>

          <Toolbar>
            <div className="flex-1 text-[13px] font-bold">
              실행 결과{" "}
              <span
                className="text-[11.5px] font-normal"
                style={{ color: K.faint }}
              >
                {selectedRun
                  ? `${tierBadgeLabel(selectedRun.tier)} · ${formatDateTime(
                      selectedRun.finished_at ?? selectedRun.started_at
                    )}${
                      selectedScore != null && selectedMax != null
                        ? ` · ${selectedScore}/${selectedMax}점`
                        : ""
                    }${!selectedRun.tier ? " · 구 문항 기준" : ""}`
                  : "—"}
              </span>
            </div>
            {doneRuns.length > 1 ? (
              <select
                className="max-w-[220px] rounded-md border px-2 py-1 text-[12px]"
                style={{ borderColor: K.line, color: K.ink }}
                value={selectedRun?.id ?? ""}
                disabled={busy}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedRunId(id);
                  void loadResultsFor(id);
                }}
              >
                {doneRuns.slice(0, 12).map((r) => (
                  <option key={r.id} value={r.id}>
                    {tierBadgeLabel(r.tier)} {runScore(r)}/{runMax(r)} ·{" "}
                    {formatDateTime(r.finished_at ?? r.started_at)}
                  </option>
                ))}
              </select>
            ) : null}
            <Btn onClick={() => setShowCases((v) => !v)}>
              문항 관리 {activeCases.length}
            </Btn>
          </Toolbar>

          {showCases ? (
            <div className="mb-3">
              <ListCard>
                {cases.length === 0 ? (
                  <div
                    className="px-4 py-3 text-[12px]"
                    style={{ color: K.faint }}
                  >
                    등록된 문항이 없습니다.
                  </div>
                ) : (
                  cases.map((item) => {
                    const open = openCaseId === item.id;
                    return (
                      <div key={item.id}>
                        <div
                          className="flex items-center gap-2.5 border-b px-4 py-2.5"
                          style={{ borderColor: K.line2 }}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                            onClick={() =>
                              setOpenCaseId(open ? null : item.id)
                            }
                          >
                            <span
                              className="w-[22px] shrink-0 text-[11px]"
                              style={{ color: K.faint }}
                            >
                              {String(item.sort_order ?? 0).padStart(2, "0")}
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate text-[13px]"
                              style={{ color: item.is_active ? K.ink : K.faint }}
                            >
                              {item.question}
                            </span>
                            {item.tier ? (
                              <Badge
                                kind={item.tier === "heavy" ? "org" : "src"}
                              >
                                {item.tier}
                              </Badge>
                            ) : null}
                            {item.category ? (
                              <Badge kind="src">{item.category}</Badge>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void toggleCase(item)}
                            className="shrink-0 cursor-pointer text-[11.5px] font-bold underline-offset-2 hover:underline disabled:opacity-50"
                            style={{ color: item.is_active ? K.sub : K.luna }}
                          >
                            {item.is_active ? "제외" : "포함"}
                          </button>
                        </div>
                        {open ? (
                          <div
                            className="border-b px-4 py-3"
                            style={{
                              borderColor: K.line2,
                              background: "#fbfbfd"
                            }}
                          >
                            <div
                              className="mb-1 text-[11px] font-extrabold uppercase"
                              style={{ color: K.faint }}
                            >
                              must_pass (필수)
                            </div>
                            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed">
                              {item.must_pass?.trim() ||
                                item.expectation?.trim() ||
                                "—"}
                            </p>
                            <div
                              className="mb-1 mt-3 text-[11px] font-extrabold uppercase"
                              style={{ color: K.faint }}
                            >
                              quality (품질)
                            </div>
                            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed">
                              {item.quality?.trim() || "—"}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
                <div
                  className="flex flex-wrap items-center gap-2 px-4 py-2.5"
                  style={{ background: "#fbfbfd" }}
                >
                  <FieldInput
                    className="min-w-[200px] flex-1"
                    value={newQuestion}
                    placeholder="새 문항 질문"
                    onChange={(e) => setNewQuestion(e.target.value)}
                  />
                  <FieldInput
                    className="w-[120px]"
                    value={newCategory}
                    placeholder="분류"
                    onChange={(e) => setNewCategory(e.target.value)}
                  />
                  <Btn
                    primary
                    disabled={busy || !newQuestion.trim()}
                    onClick={() => void addCase()}
                  >
                    추가
                  </Btn>
                </div>
              </ListCard>
            </div>
          ) : null}

          {sortedResults.length === 0 ? (
            <p className="text-[12px]" style={{ color: K.faint }}>
              실행 결과가 아직 없습니다.
            </p>
          ) : (
            <>
              <ListCard>
                {sortedResults.map((result) => {
                  const kind = resultKind(result);
                  const open = openResultId === result.id;
                  return (
                    <div key={result.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenResultId(open ? null : result.id)
                        }
                        className="flex w-full cursor-pointer items-center gap-2.5 border-b px-4 py-2.5 text-left last:border-b-0"
                        style={{
                          borderColor: K.line2,
                          background: open ? "#fbfbfd" : undefined
                        }}
                      >
                        <span
                          className="w-[22px] shrink-0 text-[11px]"
                          style={{ color: K.faint }}
                        >
                          {String(result.case?.sort_order ?? 0).padStart(2, "0")}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-[13px]"
                          style={{
                            color:
                              kind === "must_fail" || kind === "fail"
                                ? K.sub
                                : K.ink
                          }}
                        >
                          {result.case?.question ?? "삭제된 문항"}
                        </span>
                        {result.case?.tier ? (
                          <Badge
                            kind={
                              result.case.tier === "heavy" ? "org" : "src"
                            }
                          >
                            {result.case.tier}
                          </Badge>
                        ) : null}
                        {result.case?.category ? (
                          <Badge kind="src">{result.case.category}</Badge>
                        ) : null}
                        {kind === "pass" ? (
                          <Badge kind="ok">합격</Badge>
                        ) : kind === "partial" ? (
                          <Badge kind="warn">품질미달</Badge>
                        ) : kind === "must_fail" ? (
                          <Badge kind="red">필수위반</Badge>
                        ) : kind === "fail" ? (
                          <Badge kind="red">실패</Badge>
                        ) : (
                          <Badge kind="src">미채점</Badge>
                        )}
                        {typeof result.score === "number" ? (
                          <span
                            className="w-8 shrink-0 text-right text-[11px]"
                            style={{ color: K.faint }}
                          >
                            {result.score}
                          </span>
                        ) : null}
                      </button>
                      {open ? (
                        <div
                          className="border-b px-4 py-3"
                          style={{
                            borderColor: K.line2,
                            background: "#fbfbfd"
                          }}
                        >
                          <div
                            className="mb-1 text-[11px] font-extrabold uppercase"
                            style={{ color: K.faint }}
                          >
                            루나의 답변
                          </div>
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                            {result.answer?.trim() || "—"}
                          </p>
                          <div
                            className="mb-1 mt-3 text-[11px] font-extrabold uppercase"
                            style={{ color: K.faint }}
                          >
                            채점 사유
                          </div>
                          <p className="text-[12.5px]" style={{ color: K.sub }}>
                            {result.memo?.trim() ||
                              result.auto_reason?.trim() ||
                              "—"}
                          </p>
                          {(result.case?.must_pass ||
                            result.case?.quality) && (
                            <>
                              <div
                                className="mb-1 mt-3 text-[11px] font-extrabold uppercase"
                                style={{ color: K.faint }}
                              >
                                기준
                              </div>
                              <p
                                className="text-[12px] leading-relaxed"
                                style={{ color: K.sub }}
                              >
                                <b>필수</b>{" "}
                                {result.case?.must_pass?.trim() || "—"}
                                <br />
                                <b>품질</b>{" "}
                                {result.case?.quality?.trim() || "—"}
                              </p>
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </ListCard>
              <p
                className="mt-2.5 text-center text-[12px]"
                style={{ color: K.faint }}
              >
                행 클릭 시 답변·사유·필수/품질 기준
              </p>
            </>
          )}
        </>
      ) : null}
    </KnowledgeShell>
  );
}
