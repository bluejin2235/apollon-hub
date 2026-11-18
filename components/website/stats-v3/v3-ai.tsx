"use client";

/**
 * AI — 「AI가 우리 글을 읽고, 쓰고, 사람을 보내 주나요?」 (목업 #view-ai)
 * ① 읽어 감 · ③ 사람이 옴은 실제 값, ② 답에 씀은 운영 수동 기록(stats/ai-answers). 기록 표가 없으면 「준비 중」.
 */

import { useEffect, useMemo, useState } from "react";

import {
  aiAnswer,
  answerColumns,
  botsDelta,
  botsPeriodBeforeSince,
  readAiVisits,
  readBars,
  readBotsPayload,
  readTop,
  visitBars,
  visitPages,
  visitSummary
} from "@/components/website/stats-v3/v3-ai-data";
import { answerView, type AnswerView } from "@/components/website/stats-v3/v3-answer-data";
import { titlesOf } from "@/components/website/stats-v3/v3-content-data";
import { getAiAnswerSummary } from "@/lib/website/api";
import type { AiAnswerSummary } from "@/lib/website/stats";
import { Change, DeltaBlock, HBars, Intro, List, PrepBadge, StatusLine } from "@/components/website/stats-v3/v3-parts";
import type { V3ScreenProps } from "@/components/website/stats-v3/v3-screens";

function langOf(label: string): "국문" | "영문" | null {
  return label === "국문" || label === "영문" ? label : null;
}

function Lang({ label }: { label: string }) {
  const lang = langOf(label);
  return lang ? <span className="v3-badge">{lang}</span> : null;
}

function ReadCard({ bundle, status, catalog }: Pick<V3ScreenProps, "bundle" | "status" | "catalog">) {
  const payload = useMemo(() => readBotsPayload(bundle), [bundle]);
  const bars = useMemo(() => readBars(payload), [payload]);
  const top = useMemo(() => readTop(payload, titlesOf(catalog)), [payload, catalog]);
  const before = botsPeriodBeforeSince(bundle);
  const total = payload?.ai.total.current ?? null;
  const asked = payload?.ai.askedTotal.current ?? null;
  const askedDelta = botsDelta(payload?.ai.askedTotal);

  return (
    <div className="v3-card">
      <div className="v3-fact-num">서로 다른 사실 ①</div>
      <h2 className="v3-fact-title">읽어 감</h2>
      <p className="v3-card-sub">AI 로봇이 글을 가져간 기록</p>
      {status !== "ready" ? (
        <StatusLine status={status} />
      ) : before ? (
        <p className="v3-tiny">로봇 기록은 2026-11-16 부터 있습니다. 기간을 바꿔 보세요.</p>
      ) : !payload ? (
        <StatusLine status="error" />
      ) : (
        <>
          <div className="v3-ai-stat">
            {total == null ? "—" : total.toLocaleString("ko-KR")}
            <small> 회</small>
          </div>
          <DeltaBlock delta={botsDelta(payload.ai.total)} />
          <div className="v3-ai-bars">
            <HBars rows={bars} max={Math.max(1, ...bars.map((bar) => bar.value ?? 0))} />
          </div>
          <div className="v3-highlight">
            <p className="v3-tiny">누군가 물어봐서 그 자리에서 읽어 간 횟수</p>
            <strong>{asked == null ? "—" : asked.toLocaleString("ko-KR")}</strong>
            <span className="v3-tiny">
              회 · 전체 {total == null ? "—" : total.toLocaleString("ko-KR")}회 중{" "}
              <Change delta={askedDelta} />
              {askedDelta.previous ? <small> 앞 기간 {askedDelta.previous}</small> : null}
            </span>
          </div>
          <p className="v3-ai-detail">
            질문의 내용은 알 수 없습니다. 구글 AI는 일반 구글 로봇과 구분되지 않습니다.
          </p>
          <h3>많이 읽어 간 콘텐츠</h3>
          <List
            empty="이 기간에 AI 로봇이 읽어 간 기록이 없습니다."
            items={top.map((row) => ({
              key: row.path,
              name: (
                <>
                  {row.title} <Lang label={row.langLabel} />
                </>
              ),
              value: row.count == null ? "—" : `${row.count.toLocaleString("ko-KR")}회`,
              change: row.delta
            }))}
          />
        </>
      )}
    </div>
  );
}

function useAnswerSummary(from: string, to: string): { view: AnswerView | null; state: "loading" | "ready" | "none" } {
  const [summary, setSummary] = useState<AiAnswerSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    void getAiAnswerSummary({ from, to, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      // 표가 아직 없거나(DB 적용 전) 읽기 실패면 「준비 중」으로 둔다
      setSummary(result.ok ? result.data : null);
      setState(result.ok ? "ready" : "none");
    });
    return () => controller.abort();
  }, [from, to]);
  const view = useMemo(() => answerView(summary), [summary]);
  return { view, state };
}

function DiffCell({ diff }: { diff: number | null }) {
  if (diff == null) return <span className="v3-muted">—</span>;
  if (diff === 0) return <span className="v3-change flat">0</span>;
  return <span className={`v3-change ${diff > 0 ? "up" : "down"}`}>{diff > 0 ? `▲ ${diff}` : `▼ ${-diff}`}</span>;
}

/** ② 답에 씀 — 운영이 주 1회 직접 물어본 기록. 기록이 없으면 목업 칸 배치만 두고 「—」 */
function AnswerCard({ from, to }: { from: string; to: string }) {
  const { view, state } = useAnswerSummary(from, to);
  if (view) {
    const rate = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
    const pp =
      view.questionsMentionedBefore != null && view.questionsCheckedBefore
        ? Math.round(
            (rate(view.questionsMentioned, view.questionsChecked) -
              rate(view.questionsMentionedBefore, view.questionsCheckedBefore)) *
              10
          ) / 10
        : null;
    return (
      <div className="v3-card">
        <div className="v3-fact-num">서로 다른 사실 ②</div>
        <h2 className="v3-fact-title">답에 씀</h2>
        <p className="v3-card-sub">직접 물어본 표본 기준 · 주 1회 확인 · {view.latest} 회차</p>
        <div className="v3-ai-stat">
          {view.questionsMentioned.toLocaleString("ko-KR")}
          <small> / {view.questionsChecked.toLocaleString("ko-KR")}개 질문</small>
        </div>
        <div className="v3-delta">
          {pp == null ? (
            <span className="v3-badge">비교 불가</span>
          ) : (
            <span className={`v3-change ${pp > 0 ? "up" : pp < 0 ? "down" : "flat"}`}>
              {pp > 0 ? "▲" : pp < 0 ? "▼" : ""} {Math.abs(pp)}%p
            </span>
          )}
          <small>
            {view.questionsMentionedBefore != null
              ? `앞 회차 ${view.questionsMentionedBefore}개 질문 · 언급 비율 ${rate(view.mentioned, view.checked).toFixed(1)}%`
              : `언급 비율 ${rate(view.mentioned, view.checked).toFixed(1)}% · 앞 회차 기록 없음`}
          </small>
        </div>
        <h3>어떤 질문에 우리 이름이 나왔나요?</h3>
        <p className="v3-tiny">○ 언급함 · × 언급 없음 · 바뀐 질문 먼저</p>
        <table className="v3-ai-table">
          <thead>
            <tr>
              <th>질문</th>
              {view.columns.map((name) => (
                <th key={name}>{name}</th>
              ))}
              <th className="v3-num">증감</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.question}</td>
                {row.cells.map((cell, i) => (
                  <td key={view.columns[i]}>{cell == null ? "—" : cell ? "○" : "×"}</td>
                ))}
                <td className="v3-num">
                  <DiffCell diff={row.diff} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.citedTop.length > 0 ? (
          <>
            <h3>근거로 쓰인 우리 페이지</h3>
            <List
              items={view.citedTop.map((item) => ({
                key: item.url,
                name: item.url.replace(/^https?:\/\/(www\.)?apollonworks\.com/, "") || "/",
                value: `${item.count}회`
              }))}
            />
          </>
        ) : null}
        <div className="v3-highlight">
          <b>이름 언급과 페이지 인용도 구분해요.</b>
          <p className="v3-tiny">
            이름만 나오고 링크가 없을 수 있습니다. 답변에 실제로 쓰인 페이지를 함께 기록합니다.
            {view.wrongFacts > 0 ? ` 틀린 사실 ${view.wrongFacts}건이 기록돼 있습니다.` : ""}
          </p>
        </div>
      </div>
    );
  }
  const columns = answerColumns();
  if (state === "loading") {
    return (
      <div className="v3-card">
        <div className="v3-fact-num">서로 다른 사실 ②</div>
        <h2 className="v3-fact-title">답에 씀</h2>
        <StatusLine status="loading" />
      </div>
    );
  }
  return (
    <div className="v3-card">
      <div className="v3-fact-num">서로 다른 사실 ②</div>
      <h2 className="v3-fact-title">
        답에 씀 <PrepBadge />
      </h2>
      <p className="v3-card-sub">직접 물어본 표본 기준 · 주 1회 확인</p>
      <div className="v3-ai-stat">
        —
      </div>
      <h3>어떤 질문에 우리 이름이 나왔나요?</h3>
      <p className="v3-tiny">○ 언급함 · × 언급 없음</p>
      <table className="v3-ai-table">
        <thead>
          <tr>
            <th>질문</th>
            {columns.map((name) => (
              <th key={name}>{name}</th>
            ))}
            <th className="v3-num">증감</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>—</td>
            {columns.map((name) => (
              <td key={name}>—</td>
            ))}
            <td className="v3-num">—</td>
          </tr>
        </tbody>
      </table>
      <div className="v3-highlight">
        <b>이름 언급과 페이지 인용도 구분해요.</b>
        <p className="v3-tiny">이름만 나오고 링크가 없을 수 있습니다. 답변에 실제로 쓰인 페이지를 함께 기록합니다.</p>
      </div>
    </div>
  );
}

function VisitCard({ bundle, status, catalog }: Pick<V3ScreenProps, "bundle" | "status" | "catalog">) {
  const visits = useMemo(() => readAiVisits(bundle), [bundle]);
  const summary = useMemo(() => visitSummary(bundle), [bundle]);
  const bars = useMemo(() => visitBars(visits), [visits]);
  const pages = useMemo(() => visitPages(visits, titlesOf(catalog)), [visits, catalog]);

  return (
    <div className="v3-card">
      <div className="v3-fact-num">서로 다른 사실 ③</div>
      <h2 className="v3-fact-title">사람이 옴</h2>
      <p className="v3-card-sub">AI 답변을 따라 홈페이지로 온 방문</p>
      {status !== "ready" ? (
        <StatusLine status={status} />
      ) : !summary ? (
        <StatusLine status="error" />
      ) : (
        <>
          <div className="v3-ai-stat">
            {summary.total.toLocaleString("ko-KR")}
            <small> 회</small>
          </div>
          <DeltaBlock delta={summary.delta} />
          <div className="v3-ai-bars">
            <HBars rows={bars} max={Math.max(1, ...bars.map((bar) => bar.value ?? 0))} />
          </div>
          <h3>도착한 콘텐츠</h3>
          <List
            empty="이 기간에 AI 서비스에서 들어온 방문이 없습니다."
            items={pages.map((row) => ({
              key: row.path,
              name: (
                <>
                  {row.title} {row.unknown ? null : <Lang label={row.langLabel} />}
                </>
              ),
              value: `${row.sessions.toLocaleString("ko-KR")}회`,
              change: row.delta
            }))}
          />
        </>
      )}
      <div className="v3-highlight">
        <p>앱에서 온 방문은 잡히지 않아 실제보다 적습니다.</p>
        <p className="v3-tiny">출처가 남지 않은 방문은 직접 방문에 포함될 수 있습니다.</p>
      </div>
    </div>
  );
}

export function V3Ai({ bundle, status, catalog, from, to }: V3ScreenProps) {
  const answer = useMemo(() => aiAnswer(bundle), [bundle]);
  return (
    <>
      <Intro
        menu="AI"
        question="AI가 우리 글을 읽고, 쓰고, 사람을 보내 주나요?"
        answer={
          answer ? (
            <>
              {answer.lead}
              <em>{answer.em}</em>
              {answer.tail}
            </>
          ) : (
            "—"
          )
        }
      />
      <div className="v3-ai-grid">
        <ReadCard bundle={bundle} status={status} catalog={catalog} />
        <AnswerCard from={from} to={to} />
        <VisitCard bundle={bundle} status={status} catalog={catalog} />
      </div>
    </>
  );
}
