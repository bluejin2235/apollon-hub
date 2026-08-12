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
  InfoBar
} from "@/components/luna/brain/shared";
import { clipText, K } from "@/lib/luna/knowledge-format";

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
};

type EvalCase = {
  id: string;
  question: string;
  expectation: string | null;
  category: string | null;
  sort_order: number | null;
  is_active: boolean;
};

type EvalResult = {
  id: string;
  case_id: string;
  answer: string | null;
  verdict: string | null;
  memo: string | null;
  auto_pass: boolean | null;
  auto_reason: string | null;
  case?: {
    id: string;
    question: string;
    category: string | null;
    sort_order: number | null;
  } | null;
};

function passed(result: EvalResult): boolean | null {
  if (result.verdict === "pass") return true;
  if (result.verdict === "fail") return false;
  if (typeof result.auto_pass === "boolean") return result.auto_pass;
  return null;
}

export function LunaBrainEval() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCases, setShowCases] = useState(false);
  const [openResultId, setOpenResultId] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [runRes, caseRes] = await Promise.all([
        brainFetch<{ runs?: EvalRun[] }>("/api/luna/eval/runs"),
        brainFetch<{ cases?: EvalCase[] }>("/api/luna/eval/cases")
      ]);
      const runList = runRes.runs ?? [];
      setRuns(runList);
      setCases(caseRes.cases ?? []);

      const latest = runList.find((r) => r.status === "done") ?? runList[0];
      if (latest) {
        const resultRes = await brainFetch<{ results?: EvalResult[] }>(
          `/api/luna/eval/results?run_id=${latest.id}`
        );
        setResults(resultRes.results ?? []);
      } else {
        setResults([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doneRuns = useMemo(
    () => runs.filter((r) => r.status === "done" && r.total),
    [runs]
  );
  const latestRun = doneRuns[0] ?? runs[0] ?? null;
  const previousRun = doneRuns[1] ?? null;

  const trend = useMemo(() => {
    const recent = doneRuns.slice(0, 4).reverse();
    return recent.map((run, i) => {
      const prev = i > 0 ? recent[i - 1] : null;
      const score = run.passed ?? 0;
      return {
        label: `${score}/${run.total ?? 0}`,
        value: score,
        tone:
          prev && (prev.passed ?? 0) > score ? ("down" as const) : undefined
      };
    });
  }, [doneRuns]);

  const delta =
    latestRun?.passed != null && previousRun?.passed != null
      ? latestRun.passed - previousRun.passed
      : null;

  const activeCases = cases.filter((c) => c.is_active);

  const sortedResults = useMemo(
    () =>
      results
        .slice()
        .sort(
          (a, b) => (a.case?.sort_order ?? 0) - (b.case?.sort_order ?? 0)
        ),
    [results]
  );

  async function runNow() {
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{
        skipped: boolean;
        reason?: string;
        passed?: number;
        total?: number;
      }>("/api/luna/eval/exam", {
        method: "POST",
        body: JSON.stringify({ force: true })
      });
      setNotice(
        res.skipped
          ? `건너뜀: ${res.reason ?? "실행 조건 미충족"}`
          : `실행 완료 · ${res.passed ?? 0}/${res.total ?? 0} 합격`
      );
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

  return (
    <KnowledgeShell>
      <InfoBar>
        개발용 안전장치입니다. 프롬프트가 바뀔 때 자동 실행되어 나빠졌는지만
        확인합니다 — 루나의 성장 평가가 아닙니다.
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-[13px] font-bold">점수 추이</span>
              <span className="text-[22px] font-bold">
                {latestRun?.passed ?? "—"}
                <span className="text-[13px]" style={{ color: K.faint }}>
                  /{latestRun?.total ?? "—"}
                </span>
              </span>
              {delta != null && delta !== 0 ? (
                <Badge kind={delta > 0 ? "ok" : "red"}>
                  {delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
                </Badge>
              ) : null}
            </div>
            {trend.length > 0 ? (
              <BarChart bars={trend} height={64} />
            ) : (
              <p className="mt-2.5 text-[12px]" style={{ color: K.faint }}>
                완료된 실행이 아직 없습니다.
              </p>
            )}
            <div className="mt-2.5 text-[11.5px]" style={{ color: K.faint }}>
              각 실행은 프롬프트 변경 직후 자동 수행 · 하락 시 되돌림 제안
            </div>
          </BrainCard>

          <Toolbar>
            <div className="flex-1 text-[13px] font-bold">
              최근 실행 결과{" "}
              <span
                className="text-[11.5px] font-normal"
                style={{ color: K.faint }}
              >
                {latestRun
                  ? `${formatDateTime(latestRun.finished_at ?? latestRun.started_at)}${
                      latestRun.note ? ` · ${clipText(latestRun.note, 30)}` : ""
                    }`
                  : "—"}
              </span>
            </div>
            <Btn onClick={() => setShowCases((v) => !v)}>
              문항 관리 {activeCases.length}
            </Btn>
            <Btn disabled={busy} onClick={() => void runNow()}>
              {busy ? "실행 중…" : "지금 실행"}
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
                  cases.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2.5 border-b px-4 py-2.5 last:border-b-0"
                      style={{ borderColor: K.line2 }}
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
                      {item.category ? (
                        <Badge kind="src">{item.category}</Badge>
                      ) : null}
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
                  ))
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
                  const ok = passed(result);
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
                          style={{ color: ok === false ? K.sub : K.ink }}
                        >
                          {result.case?.question ?? "삭제된 문항"}
                        </span>
                        {result.case?.category ? (
                          <Badge kind="src">{result.case.category}</Badge>
                        ) : null}
                        {ok == null ? (
                          <Badge kind="src">미채점</Badge>
                        ) : (
                          <Badge kind={ok ? "ok" : "red"}>
                            {ok ? "합격" : "실패"}
                          </Badge>
                        )}
                      </button>
                      {open ? (
                        <div
                          className="border-b px-4 py-3"
                          style={{ borderColor: K.line2, background: "#fbfbfd" }}
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
                행 클릭 시 루나의 답변 전문과 채점 사유
              </p>
            </>
          )}
        </>
      ) : null}
    </KnowledgeShell>
  );
}
