"use client";

/**
 * 요약 — 「방향이 맞게 가고 있나요?」 (목업 #view-overview)
 * 루나 요약은 지금 요약 화면과 같은 API 문단을 그대로 보인다.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  buildSummaryBriefFacts,
  summaryBriefFingerprint
} from "@/components/website/stats/summary-data";
import { loadSummaryBrief } from "@/components/website/stats/summary-brief-cache";
import type { SummaryCardId } from "@/components/website/stats/stats-labels";
import type { StatsData } from "@/components/website/stats/stats-slot";
import { axisLabel, LineChart } from "@/components/website/stats-v3/v3-chart";
import { actionsInRange, chartMarks, markDate, prevDatesOf, visitsOf } from "@/components/website/stats-v3/v3-data";
import { briefLines, overviewAnswer, overviewCards, overviewTrend } from "@/components/website/stats-v3/v3-overview-data";
import { Intro, Metric, PrepBadge, StatusLine } from "@/components/website/stats-v3/v3-parts";
import { dayText, rangeText } from "@/components/website/stats-v3/v3-period";
import type { V3ScreenProps } from "@/components/website/stats-v3/v3-screens";
import { createStatsAction, type StatsBriefResult } from "@/lib/website/api";

const CARDS: { id: SummaryCardId; label: ReactNode; unit: string }[] = [
  { id: "visit", label: "방문자", unit: "명" },
  { id: "genericClick", label: "일반 명사 검색 클릭", unit: "회" },
  {
    id: "searchToArticle",
    label: (
      <>
        검색으로 온 사람 중<br />
        글로 바로 들어온 비율
      </>
    ),
    unit: "%"
  },
  { id: "ai", label: "AI에서 온 방문", unit: "회" },
  { id: "inquiryClick", label: "문의 · 문의하기 누름", unit: "회" }
];

function VisitTrend({ bundle, status, actions, today }: Pick<V3ScreenProps, "bundle" | "status" | "actions" | "today">) {
  const trend = useMemo(() => overviewTrend(bundle), [bundle]);
  const visitors = visitsOf(bundle).current;
  const year = Number(today.slice(0, 4));
  const oneDay = trend.dates.length === 1;
  const marks = useMemo(() => chartMarks(trend.dates, actions.items, bundle), [trend.dates, actions.items, bundle]);
  const first = trend.dates[0];
  const last = trend.dates[trend.dates.length - 1];
  const people = visitors == null ? "—" : `${visitors.toLocaleString("ko-KR")}명`;

  return (
    <div className="v3-card">
      <div className="v3-card-head">
        <div>
          <h2>방문자 추이 {oneDay ? <PrepBadge /> : null}</h2>
          <p className="v3-card-sub">
            {oneDay
              ? `하루 방문자 ${people} · 시간대마다 같은 사람을 다시 셀 수 있어 아래 합계와 다릅니다.`
              : `방문자 ${people} · 날마다 같은 사람을 다시 셀 수 있어 날짜별 합계와 다릅니다.`}
          </p>
        </div>
        {first ? (
          <span className="v3-tiny">
            {oneDay ? `${dayText(first, year)} · 시간대별` : `${rangeText(first, last, year)} · 날짜별`}
          </span>
        ) : null}
      </div>
      {status !== "ready" ? (
        <StatusLine status={status} />
      ) : oneDay ? (
        <div className="v3-chart-empty">—</div>
      ) : trend.dates.length === 0 ? (
        <StatusLine status="ready" />
      ) : (
        <LineChart
          labels={trend.dates.map(axisLabel)}
          dates={trend.dates}
          prevDates={prevDatesOf(bundle, trend.dates)}
          current={trend.current}
          previous={trend.previous}
          unit="명"
          marks={marks}
          ariaLabel="방문자 이번 기간과 앞 기간 추이 및 조치 기록"
        />
      )}
    </div>
  );
}

type BriefState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: StatsBriefResult }
  | { status: "error" };

/** 지금 요약 화면(summary-screen.tsx)의 useSummaryBrief 와 같다 — 같은 기간 · 같은 숫자는 같은 캐시를 쓴다 */
function useSummaryBrief(data: StatsData, from: string, to: string): { state: BriefState; retry: () => void } {
  const [retryTick, setRetryTick] = useState(0);
  const [state, setState] = useState<BriefState>({ status: "idle" });

  useEffect(() => {
    if (data.status === "loading") {
      setState({ status: "loading" });
      return;
    }
    if (data.status === "error") {
      setState({ status: "error" });
      return;
    }
    const facts = buildSummaryBriefFacts(data.bundle, from, to);
    if (!facts) {
      setState({ status: "idle" });
      return;
    }
    const fingerprint = summaryBriefFingerprint(facts);
    let cancelled = false;
    setState({ status: "loading" });
    void loadSummaryBrief(facts.from, facts.to, fingerprint, facts).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data?.summary) {
        setState({ status: "error" });
        return;
      }
      setState({ status: "ready", data: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, [data.bundle, data.status, from, to, retryTick]);

  return { state, retry: () => setRetryTick((n) => n + 1) };
}

export function LunaAndTasks({ state, onRetry }: { state: BriefState; onRetry: () => void }) {
  const todos = state.status === "ready" ? state.data.todos.slice(0, 3) : [];
  return (
    <div className="v3-two">
      <div className="v3-card v3-summary-card">
        <div className="v3-card-head">
          <h2>루나 요약</h2>
          <span className="v3-tiny">앞 기간과 달라진 점</span>
        </div>
        {state.status === "ready" ? (
          <ul className="v3-summary-lines">
            {briefLines(state.data.summary).map((line, index) => (
              <li key={line}>
                <span className="v3-n">{String(index + 1).padStart(2, "0")}</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {state.status === "loading" ? <p className="v3-tiny">요약을 만드는 중입니다…</p> : null}
        {state.status === "idle" ? <p className="v3-tiny">이 기간에는 읽을 새 홈페이지 숫자가 없습니다.</p> : null}
        {state.status === "error" ? (
          <p className="v3-tiny">
            요약을 만들지 못했습니다{" "}
            <button type="button" className="v3-ghost" onClick={onRetry}>
              다시 시도
            </button>
          </p>
        ) : null}
      </div>
      <div className="v3-card">
        <div className="v3-card-head">
          <h2>이번 주 할 일</h2>
          <span className="v3-tiny">먼저 할 세 가지</span>
        </div>
        {todos.length > 0 ? (
          <ul className="v3-tasks">
            {todos.map((item) => (
              <li key={`${item.level}-${item.title}`}>
                <span className="v3-check" />
                <span>{item.title}</span>
                {item.area ? <span className="v3-task-who">{item.area}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="v3-tiny">
            {state.status === "loading"
              ? "루나가 고르는 중입니다…"
              : state.status === "ready"
                ? "이번 기간에는 따로 할 일이 없습니다."
                : "루나 요약이 있어야 할 일을 고릅니다."}
          </p>
        )}
      </div>
    </div>
  );
}

function Records({ bundle, actions, from, to, today }: Pick<V3ScreenProps, "bundle" | "actions" | "from" | "to" | "today">) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(today);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const items = useMemo(() => actionsInRange(actions.items, bundle, from, to), [actions.items, bundle, from, to]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  function open() {
    setDate(today);
    setText("");
    setError(null);
    dialog.current?.showModal();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const title = text.trim();
    if (!date || !title) return;
    setSaving(true);
    setError(null);
    const result = await createStatsAction({ action_date: date, title, category: null, note: null });
    setSaving(false);
    if (!result.ok) {
      setError("기록하지 못했습니다. 잠시 뒤 다시 해 주세요.");
      return;
    }
    dialog.current?.close();
    actions.reload();
    setToast("조치 기록을 추가했습니다.");
  }

  return (
    <div className="v3-card">
      <div className="v3-card-head">
        <h2>조치 기록</h2>
        <button type="button" className="v3-ghost" onClick={open}>
          + 기록 추가
        </button>
      </div>
      {items.length > 0 ? (
        <div className="v3-records">
          {items.map((item) => (
            <span key={item.id}>
              <b>{markDate(item.action_date)}</b>
              {item.title}
            </span>
          ))}
        </div>
      ) : (
        <p className="v3-tiny">
          {actions.status === "loading"
            ? "불러오는 중입니다"
            : actions.status === "error"
              ? "조치 기록을 불러오지 못했습니다."
              : "이 기간에 적은 조치가 없습니다."}
        </p>
      )}
      <div className="v3-record-note">같은 날짜의 기록은 차트에서 하나의 세로선에 함께 표시합니다.</div>

      <dialog ref={dialog} className="v3-dialog">
        <form onSubmit={submit}>
          <h2>조치 기록 추가</h2>
          <label>
            날짜
            <input type="date" value={date} max={today} required onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            한 일
            <input
              value={text}
              placeholder="예: 작품 소개 문장 수정"
              maxLength={60}
              required
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {error ? <p className="v3-dialog-error">{error}</p> : null}
          <div className="v3-dialog-actions">
            <button type="button" className="v3-ghost" onClick={() => dialog.current?.close()}>
              닫기
            </button>
            <button type="submit" className="v3-primary" disabled={saving}>
              기록 추가
            </button>
          </div>
        </form>
      </dialog>
      {toast ? (
        <div className="v3-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export function V3Overview(props: V3ScreenProps) {
  const { bundle, status, from, to } = props;
  const cards = useMemo(() => overviewCards(bundle), [bundle]);
  const answer = useMemo(() => overviewAnswer(bundle), [bundle]);
  const brief = useSummaryBrief({ bundle, status }, from, to);

  return (
    <>
      <Intro
        menu="요약"
        question="방향이 맞게 가고 있나요?"
        answer={
          answer ? (
            <>
              {answer.lead}
              <em>{answer.em}</em>
            </>
          ) : (
            "—"
          )
        }
      />
      <div className="v3-metrics">
        {CARDS.map((spec) => {
          const card = cards.get(spec.id);
          return (
            <Metric
              key={spec.id}
              label={spec.label}
              value={card?.value ?? null}
              unit={spec.unit}
              delta={card?.delta}
              hint={card?.hint ?? undefined}
              prep={status === "ready" && !card}
            />
          );
        })}
      </div>
      <VisitTrend {...props} />
      <LunaAndTasks state={brief.state} onRetry={brief.retry} />
      <Records {...props} />
    </>
  );
}
