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

function runScore(run: EvalRun): number {
  if (typeof run.score_sum === "number") return Number(run.score_sum);
  return run.passed ?? 0;
}

function runMax(run: EvalRun): number {
  if (typeof run.score_max === "number" && run.score_max > 0) {
    return Number(run.score_max);
  }
  return run.total ?? 0;
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
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [runTier, setRunTier] = useState<"all" | "light" | "heavy">("all");

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

  const lightTrend = useMemo(() => {
    const recent = doneRuns
      .filter((r) => r.tier === "light" || (!r.tier && (r.total ?? 0) >= 10))
      .slice(0, 4)
      .reverse();
    return recent.map((run, i) => {
      const prev = i > 0 ? recent[i - 1] : null;
      const score = runScore(run);
      const max = runMax(run);
      return {
        label: `${score}/${max}`,
        value: score,
        tone:
          prev && runScore(prev) > score ? ("down" as const) : undefined
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
        tone:
          prev && runScore(prev) > score ? ("down" as const) : undefined
      };
    });
  }, [doneRuns]);

  const latestRun = doneRuns[0] ?? runs[0] ?? null;
  const previousSameTier = useMemo(() => {
    if (!latestRun) return null;
    return (
      doneRuns.find(
        (r) =>
          r.id !== latestRun.id &&
          (r.tier ?? null) === (latestRun.tier ?? null)
      ) ?? doneRuns[1] ?? null
    );
  }, [doneRuns, latestRun]);

  const delta =
    latestRun && previousSameTier
      ? runScore(latestRun) - runScore(previousSameTier)
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
      const body: { force: boolean; tier?: string } = { force: true };
      if (runTier === "light" || runTier === "heavy") body.tier = runTier;
      const res = await brainFetch<{
        skipped: boolean;
        reason?: string;
        passed?: number;
        total?: number;
        score_sum?: number;
        score_max?: number;
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
          : `실행 완료 · ${score}점`
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
        매일 light(검색 없음)·매주 heavy(검색 포함)로 나눕니다. 필수 위반은
        프롬프트 문제, 품질 미달은 자습 재료입니다.
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

          <BrainCard>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-[13px] font-bold">최근 실행</span>
              <span className="text-[22px] font-bold">
                {latestRun ? runScore(latestRun) : "—"}
                <span className="text-[13px]" style={{ color: K.faint }}>
                  /{latestRun ? runMax(latestRun) : "—"}
                </span>
              </span>
              {latestRun?.tier ? (
                <Badge kind={latestRun.tier === "heavy" ? "org" : "src"}>
                  {latestRun.tier}
                </Badge>
              ) : null}
              {delta != null && delta !== 0 ? (
                <Badge kind={delta > 0 ? "ok" : "red"}>
                  {delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
                </Badge>
              ) : null}
            </div>
            <div className="mt-2.5 text-[11.5px]" style={{ color: K.faint }}>
              필수 위반 시 즉시 알림 · 품질 미달은 자습 · 점수 상승은 알림 없음
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
            <select
              className="rounded-md border px-2 py-1 text-[12px]"
              style={{ borderColor: K.line, color: K.ink }}
              value={runTier}
              onChange={(e) =>
                setRunTier(e.target.value as "all" | "light" | "heavy")
              }
              disabled={busy}
            >
              <option value="all">전체</option>
              <option value="light">light만</option>
              <option value="heavy">heavy만</option>
            </select>
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
