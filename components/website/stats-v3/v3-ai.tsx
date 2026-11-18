"use client";

/**
 * AI — 「AI가 우리 사이트를 읽고, 답변에 쓰고, 사람을 보내 주나요?」
 * 맨 위는 날짜별 흐름(잘 되고 있나), 아래는 세 질문을 하나씩.
 *   ① AI가 우리 사이트를 읽어 갔나 — 로봇 기록(2026-11-16 부터)
 *   ② AI 답변에 우리가 나오나 — 사람이 직접 물어본 기록
 *   ③ AI 답변을 보고 사람이 왔나 — GA 출처가 AI 서비스인 방문
 */

import { Fragment, useMemo, useState } from "react";

import {
  botPrevReason,
  bucketRangeText,
  prevBotCount,
  visitPrevReason,
  type AiDayBucket,
  type AiPrevSlot
} from "@/components/website/stats-v3/v3-ai-days";
import {
  aiAnswer,
  botsDelta,
  botsPeriodBeforeSince,
  companyLabel,
  companyRows,
  GOOGLE_SUMMARY,
  readAiVisits,
  readBotsPayload,
  readTopInfo,
  searchEngineRows,
  visitBars,
  visitPages,
  visitSummary,
  type CompanyRow
} from "@/components/website/stats-v3/v3-ai-data";
import { answerView, type AnswerCell, type AnswerView } from "@/components/website/stats-v3/v3-answer-data";
import { axisLabel, LineChart, MultiLineChart } from "@/components/website/stats-v3/v3-chart";
import { titlesOf } from "@/components/website/stats-v3/v3-content-data";
import {
  Change,
  DeltaBlock,
  EmptyText,
  HBars,
  Intro,
  List,
  Source,
  StatusLine,
  TrendCard,
  type SourceState
} from "@/components/website/stats-v3/v3-parts";
import { dayText, inclusiveDays, rangeText } from "@/components/website/stats-v3/v3-period";
import type { V3ScreenProps } from "@/components/website/stats-v3/v3-screens";
import { trendFact } from "@/components/website/stats-v3/v3-trend";
import { previousIsOldSite, readActualRange } from "@/components/website/stats/stats-data";

const FIRST_QUESTIONS = 8;

function langOf(label: string): "국문" | "영문" | null {
  return label === "국문" || label === "영문" ? label : null;
}

function Lang({ label }: { label: string }) {
  const lang = langOf(label);
  return lang ? <span className="v3-badge">{lang}</span> : null;
}

/** 회사 · 쓰임 · 막대 · 숫자 · 증감 */
function CompanyBars({ rows }: { rows: CompanyRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <>
      {rows.map((row) => (
        <div className="v3-cbar" key={row.key}>
          <span>
            {row.name}
            <small>{row.purpose}</small>
          </span>
          <svg className="v3-rail" viewBox="0 0 100 7" preserveAspectRatio="none" aria-hidden="true">
            <rect width="100" height="7" className="v3-rail-bg" />
            <rect width={Math.min(100, (row.value / max) * 100)} height="7" className="v3-rail-fill" />
          </svg>
          <b>{row.value.toLocaleString("ko-KR")}</b>
          {row.change ? <Change delta={row.change} /> : <span />}
        </div>
      ))}
    </>
  );
}

/** 「로봇 기록은 11월 16일부터예요 …」 — 기간 앞쪽이 기록 전이면 몇 날치인지 밝힌다 */
function sinceNote(since: string | null, from: string, to: string, year: number): string | null {
  if (!since || from >= since) return null;
  if (to < since) return `로봇 기록은 ${dayText(since, year)}부터예요. 이 기간에는 기록이 없어요(0이 아니라 기록 시작 전).`;
  return `로봇 기록은 ${dayText(since, year)}부터예요. 이 숫자는 ${rangeText(since, to, year)} ${inclusiveDays(since, to)}일치예요.`;
}

/* ─────────────────────── 맨 위 흐름 ─────────────────────── */

function bucketLabel(bucket: AiDayBucket): string {
  return bucket.from === bucket.to ? axisLabel(bucket.from) : `${axisLabel(bucket.from)}~`;
}

/** 마우스 상자 첫 줄 — 묶음이면 두 날짜와 날 수. 로봇 기록이 묶음 중간부터면 그것도 밝힌다 */
function bucketHead(bucket: AiDayBucket, bots: boolean): string {
  const head = bucketRangeText(bucket, axisLabel);
  return bots && bucket.botDays > 0 && bucket.botDays < bucket.days ? `${head} · 로봇 기록 ${bucket.botDays}일` : head;
}

/** 7일 묶음인데 마지막 칸이 짧으면 그 칸이 낮아 보이는 까닭을 적는다 */
function shortBucketNote(buckets: AiDayBucket[]): string | null {
  if (buckets.length < 2 || buckets[0].days === 1) return null;
  const last = buckets[buckets.length - 1];
  if (last.days >= buckets[0].days) return null;
  return `7일씩 묶었어요. 마지막 칸(${bucketRangeText(last, axisLabel)})은 ${last.days}일뿐이라 낮아 보일 수 있어요. 흐름 문장은 하루 평균으로 견줬어요.`;
}

/**
 * 답에 씀 기록의 자료 상태. 받기 실패(none: 표가 없거나 읽기 실패)와 본 응답 실패(error)는 실패로 본다.
 * 그래야 받지 못했는데 「확인한 기록이 없어요」라고 쓰지 않는다
 */
function answersSource(state: V3ScreenProps["extras"]["answers"]["state"]): SourceState {
  if (state === "loading") return "loading";
  if (state === "ready") return "ready";
  return "error";
}

function AiTrends({ bundle, extras, today }: Pick<V3ScreenProps, "bundle" | "extras" | "today">) {
  const year = Number(today.slice(0, 4));
  const payload = useMemo(() => readBotsPayload(bundle), [bundle]);
  const visits = useMemo(() => readAiVisits(bundle), [bundle]);
  const view = useMemo(() => answerView(extras.answers.summary), [extras.answers.summary]);
  const range = readActualRange(bundle);
  const days = extras.aiDays;
  const since = payload?.since ?? days.since ?? null;
  const oldSiteReason = range
    ? `앞 기간(${rangeText(range.prevFrom, range.prevTo, year)})은 새 홈페이지를 열기 전이라 견줄 수 없어요.`
    : "앞 기간 기록이 없어요.";

  // ① 로봇 — 날짜별 회사 갈래. 많이 온 회사 넷 + 나머지
  const botBuckets = days.buckets.filter((bucket) => bucket.botsByCompany);
  const companyTotals = new Map<string, number>();
  for (const bucket of botBuckets)
    for (const [key, value] of Object.entries(bucket.botsByCompany ?? {})) companyTotals.set(key, (companyTotals.get(key) ?? 0) + value);
  const topCompanies = [...companyTotals.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  const shown = topCompanies.slice(0, 4);
  const restKeys = topCompanies.slice(4);
  // 같은 자리 앞 기간 칸: 마우스 상자에서 견줄 값. 아직 받는 중이면 slot 이 없다(「앞 기간 불러오는 중」)
  const slotOf = (bucket: AiDayBucket): AiPrevSlot | null => {
    const at = days.buckets.indexOf(bucket);
    return at >= 0 ? (days.previous?.[at] ?? null) : null;
  };
  const prevOf = (bucket: AiDayBucket): AiDayBucket | null => slotOf(bucket)?.bucket ?? null;
  // 값과 까닭이 늘 맞게 같은 판단(prevBotCount · botPrevReason)을 쓴다
  const prevCompany = (bucket: AiDayBucket, keys: string[]): number | null => prevBotCount(slotOf(bucket), keys);
  const botSeries = [
    ...shown.map((key) => ({
      name: companyLabel(key, true),
      values: botBuckets.map((b) => b.botsByCompany?.[key] ?? 0),
      previous: botBuckets.map((b) => prevCompany(b, [key]))
    })),
    ...(restKeys.length > 0
      ? [
          {
            name: "그 밖 회사",
            values: botBuckets.map((b) => restKeys.reduce((acc, key) => acc + (b.botsByCompany?.[key] ?? 0), 0)),
            previous: botBuckets.map((b) => prevCompany(b, restKeys))
          }
        ]
      : [])
  ];
  // 점마다 실제 까닭: 비교 기간 밖 · 새 홈페이지 열기 전 · 로봇 기록 시작 전 · 받지 못함 · 불러오는 중
  const botPrevReasons = botBuckets.map((b) => botPrevReason(slotOf(b)));
  const prevHead = (bucket: AiDayBucket, bots: boolean): string | null => {
    const before = prevOf(bucket);
    return before ? bucketHead(before, bots) : null;
  };
  const visitPrevReasons = days.buckets.map((b) => visitPrevReason(slotOf(b)));
  const botPrev = payload?.ai.total.previous ?? null;
  const botFact =
    payload && botPrev != null
      ? trendFact({ name: "AI 로봇이 읽어 간 횟수", unit: "회", current: [payload.ai.total.current], previous: [botPrev] })
      : trendFact({
          name: "AI 로봇이 읽어 간 횟수",
          unit: "회",
          current: days.buckets.map((b) => b.botsTotal),
          days: days.buckets.map((b) => b.botDays),
          previous: null,
          unfairReason: since ? `로봇 기록은 ${dayText(since, year)}부터라 앞 기간 기록이 없어요.` : "앞 기간 기록이 없어요.",
          startsOn: since ? dayText(since, year) : null
        });

  // ③ 방문 — 날짜별
  const visitPrev = visits?.previous?.total ?? null;
  const oldSite = previousIsOldSite(bundle);
  const visitFact =
    visits && visitPrev != null && !oldSite
      ? trendFact({ name: "AI 답변을 보고 온 방문", unit: "회", current: [visits.current.total], previous: [visitPrev] })
      : trendFact({
          name: "AI 답변을 보고 온 방문",
          unit: "회",
          current: days.buckets.map((b) => b.visits),
          days: days.buckets.map((b) => b.days),
          previous: null,
          unfairReason: oldSite ? oldSiteReason : "앞 기간 기록이 없어요."
        });

  // ② 답에 나옴 — 확인 회차별
  const answerFact = view
    ? view.questionsMentionedBefore != null && view.questionsMentionedComparable != null
      ? trendFact({
          name: "AI 답변에 우리 이름이 나온 질문",
          unit: "개",
          current: [view.questionsMentionedComparable],
          previous: [view.questionsMentionedBefore]
        })
      : {
          tone: "none" as const,
          text: `AI 답변에 우리 이름이 나온 질문: ${view.questionsChecked}개 중 ${view.questionsMentioned}개. 확인을 ${view.rounds}번만 해서 흐름은 아직 없어요.`,
          fair: false,
          fairText: "같은 질문을 다시 물어본 기록이 쌓이면 늘었는지 줄었는지 보여요."
        }
    : {
        tone: "none" as const,
        text: "AI 답변에 우리가 나오는지: 이 기간에 확인한 기록이 없어요.",
        fair: false,
        fairText: "사람이 AI에 직접 물어본 날이 이 기간 안에 있어야 보여요."
      };

  const loading = days.state === "loading";
  const failed = days.state === "error";
  // 로봇 · 방문 흐름 카드는 날짜별 자료(aiDays)가 준비됐을 때만 「기록이 없어요」 같은 문장을 쓴다
  const daysSource: SourceState = loading ? "loading" : failed ? "error" : "ready";
  const weekNote = shortBucketNote(days.buckets);

  return (
    <>
      <h2 className="v3-section-title">날짜별 흐름 · 잘 되고 있나요?</h2>
      <div className="v3-trends">
        <Source state={daysSource}>
        <TrendCard title="AI 로봇이 읽어 간 횟수 · 회사별" fact={botFact} note={weekNote ?? undefined} wide>
          {loading ? (
            <StatusLine status="loading" />
          ) : failed ? (
            <StatusLine status="error" />
          ) : botBuckets.length > 1 ? (
            <MultiLineChart
              dates={botBuckets.map((b) => b.from)}
              labels={botBuckets.map(bucketLabel)}
              tipHeads={botBuckets.map((b) => bucketHead(b, true))}
              prevTipHeads={botBuckets.map((b) => prevHead(b, true))}
              prevReason={botPrevReasons}
              series={botSeries}
              unit="회"
              ariaLabel="AI 로봇이 읽어 간 횟수 회사별 날짜별"
            />
          ) : (
            <p className="v3-tiny">
              {botBuckets.length === 1
                ? `${bucketLabel(botBuckets[0])} 하루만 기록이 있어 선을 그릴 수 없어요.`
                : "이 기간에는 로봇 기록이 없어요."}
            </p>
          )}
        </TrendCard>
        </Source>
        <Source state={daysSource}>
        <TrendCard
          title="AI 답변을 보고 온 방문 · 날짜별"
          fact={visitFact}
          note={`AI 앱에서 누르면 출처가 안 남는 경우가 많아 실제보다 적게 잡혀요.${weekNote ? ` ${weekNote}` : ""}`}
        >
          {loading ? (
            <StatusLine status="loading" />
          ) : failed ? (
            <StatusLine status="error" />
          ) : days.buckets.length > 1 ? (
            <LineChart
              mini
              two
              labels={days.buckets.map(bucketLabel)}
              dates={days.buckets.map((b) => b.from)}
              tipHeads={days.buckets.map((b) => bucketHead(b, false))}
              prevTipHeads={days.buckets.map((b) => prevHead(b, false))}
              prevReason={visitPrevReasons}
              current={days.buckets.map((b) => b.visits)}
              previous={days.buckets.map((b) => prevOf(b)?.visits ?? null)}
              unit="회"
              ariaLabel="AI 답변을 보고 온 방문 날짜별"
            />
          ) : (
            <p className="v3-tiny">하루짜리 기간이라 선을 그리지 않아요.</p>
          )}
        </TrendCard>
        </Source>
        <Source state={answersSource(extras.answers.state)}>
          <TrendCard title="AI 답변에 우리가 나온 질문 · 확인할 때마다" fact={answerFact} />
        </Source>
      </div>
    </>
  );
}

/* ─────────────────────── ① 읽어 갔나 ─────────────────────── */

function ReadCard({ bundle, status, catalog, from, to, today }: Pick<V3ScreenProps, "bundle" | "status" | "catalog" | "from" | "to" | "today">) {
  const year = Number(today.slice(0, 4));
  const payload = useMemo(() => readBotsPayload(bundle), [bundle]);
  const companies = useMemo(() => companyRows(payload), [payload]);
  const engines = useMemo(() => searchEngineRows(payload), [payload]);
  const top = useMemo(() => readTopInfo(payload, titlesOf(catalog)), [payload, catalog]);
  const before = botsPeriodBeforeSince(bundle);
  const range = readActualRange(bundle);
  const note = sinceNote(payload?.since ?? null, range?.actualFrom ?? from, range?.actualTo ?? to, year);
  const total = payload?.ai.total.current ?? null;
  const asked = payload?.ai.askedTotal.current ?? null;
  const askedDelta = botsDelta(payload?.ai.askedTotal);

  return (
    <div className="v3-card">
      <h2 className="v3-fact-title">AI가 우리 사이트를 읽어 갔나</h2>
      <p className="v3-card-sub">AI 회사의 로봇이 우리 페이지를 가져간 횟수예요.</p>
      {status !== "ready" ? (
        <StatusLine status={status} />
      ) : before ? (
        <p className="v3-tiny">{note ?? "로봇 기록이 시작되기 전 기간이에요."}</p>
      ) : !payload ? (
        <StatusLine status="error" />
      ) : (
        <>
          {note ? <p className="v3-tiny">{note}</p> : null}
          <div className="v3-ai-stat">
            {total == null ? "—" : total.toLocaleString("ko-KR")}
            <small> 회</small>
          </div>
          <DeltaBlock delta={botsDelta(payload.ai.total)} />
          <p className="v3-group-label">AI 회사별 · 무엇에 쓰는 로봇인지</p>
          <div className="v3-ai-bars">
            {companies.length > 0 ? <CompanyBars rows={companies} /> : <EmptyText>이 기간에 온 AI 로봇이 없어요.</EmptyText>}
          </div>
          <div className="v3-highlight">
            <p className="v3-tiny">누가 AI에게 물어봐서, AI가 그 자리에서 우리 페이지를 연 횟수</p>
            <strong>{asked == null ? "—" : asked.toLocaleString("ko-KR")}</strong>
            <span className="v3-tiny">
              회 · 전체 {total == null ? "—" : total.toLocaleString("ko-KR")}회 중 <Change delta={askedDelta} />
              {askedDelta.previous ? <small> 앞 기간 {askedDelta.previous}</small> : null}
            </span>
          </div>
          {engines.length > 0 ? (
            <>
              <p className="v3-group-label">참고 · 검색 엔진 로봇 (AI 아님, 위 합계에 안 들어감)</p>
              <CompanyBars rows={engines} />
            </>
          ) : null}
          <p className="v3-ai-detail">
            로봇 이름은 로봇이 스스로 밝힌 이름이라 흉내 낸 가짜가 섞일 수 있어요. 구글의 AI는 일반 구글 검색 로봇과 같은
            이름으로 와서 따로 셀 수 없어요.
          </p>
          <h3>많이 읽어 간 페이지</h3>
          <List
            empty="이 기간에 AI 로봇이 읽어 간 페이지 기록이 없어요."
            items={top.rows.map((row) => ({
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
          {top.internal > 0 ? (
            <p className="v3-tiny">
              홈페이지가 많이 읽힌 주소 {top.listed}개만 보내 주는데, 그중 {top.internal}개는 사진 파일 주소라 뺐어요.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ─────────────────────── ② 답에 나오나 ─────────────────────── */

function columnNote(label: string, checked: number, questions: number): string | null {
  if (checked === 0) return "확인 안 함";
  if (checked < questions) return `${checked}개만 확인`;
  if (label === GOOGLE_SUMMARY) return "제미나이 앱 아님";
  return null;
}

function CellDetail({ label, question, cell }: { label: string; question: string; cell: AnswerCell }) {
  return (
    <>
      <p>
        <b>
          {label} · 「{question}」
        </b>{" "}
        {cell.mentioned ? "답변에 우리 이름이 나왔어요." : "답변에 우리 이름이 안 나왔어요."}
        {cell.rank != null ? ` 답 속 ${cell.rank}번째로 나왔어요.` : ""}
      </p>
      {cell.excerpt ? <p className="v3-quote">{cell.excerpt}</p> : null}
      {cell.cited.length > 0 ? (
        <>
          <p>근거로 쓴 우리 페이지</p>
          <ul>
            {cell.cited.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {url.replace(/^https?:\/\/(www\.)?apollonworks\.com/, "") || "/"}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {cell.wrongNote ? <p>틀린 내용: {cell.wrongNote}</p> : null}
      {!cell.detailSent ? (
        <p className="v3-tiny">
          이 답의 글과 근거 주소는 확인할 때 적어 두었지만, 홈페이지가 아직 이 화면으로 넘겨주지 않아요. 홈페이지 수정이
          필요해요.
        </p>
      ) : null}
    </>
  );
}

function AnswerTable({ view }: { view: AnswerView }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rows = all ? view.rows : view.rows.slice(0, FIRST_QUESTIONS);
  return (
    <>
      <table className="v3-ai-table">
        <thead>
          <tr>
            <th>질문</th>
            {view.columns.map((col) => {
              const note = columnNote(col.label, col.checked, view.questionsChecked);
              return (
                <th key={col.label}>
                  {col.label}
                  {note ? <span className="v3-th-note">{note}</span> : null}
                </th>
              );
            })}
            <th className="v3-num">앞 회차보다</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const openAt = view.columns.findIndex((col) => open === `${row.id}|${col.label}`);
            return (
              <Fragment key={row.id}>
                <tr>
                  <td>{row.question}</td>
                  {row.cells.map((cell, i) => {
                    const id = `${row.id}|${view.columns[i].label}`;
                    if (cell.mentioned == null)
                      return (
                        <td key={id}>
                          <span className="v3-unchecked">확인 안 함</span>
                        </td>
                      );
                    if (!cell.mentioned && !cell.wrong) return <td key={id}>×</td>;
                    return (
                      <td key={id}>
                        <button
                          type="button"
                          className="v3-cell-button"
                          aria-expanded={open === id}
                          aria-label={`${view.columns[i].label} 답변 자세히`}
                          onClick={() => setOpen(open === id ? null : id)}
                        >
                          {cell.mentioned ? "○" : "×"}
                          {cell.wrong ? "!" : ""}
                        </button>
                      </td>
                    );
                  })}
                  <td className="v3-num">
                    {row.diff == null ? (
                      <span className="v3-muted">—</span>
                    ) : row.diff === 0 ? (
                      <span className="v3-change flat">0</span>
                    ) : (
                      <span className={`v3-change ${row.diff > 0 ? "up" : "down"}`}>{row.diff > 0 ? `▲ ${row.diff}` : `▼ ${-row.diff}`}</span>
                    )}
                  </td>
                </tr>
                {openAt >= 0 ? (
                  <tr>
                    <td colSpan={view.columns.length + 2} className="v3-answer-detail">
                      <CellDetail label={view.columns[openAt].label} question={row.question} cell={row.cells[openAt]} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {view.rows.length > FIRST_QUESTIONS ? (
        <p className="v3-tiny">
          <button type="button" className="v3-ghost" onClick={() => setAll((value) => !value)}>
            {all ? `${FIRST_QUESTIONS}개만 보기` : `질문 모두 보기 (${view.rows.length}개)`}
          </button>
        </p>
      ) : null}
    </>
  );
}

function AnswerCard({ extras, today }: Pick<V3ScreenProps, "extras" | "today">) {
  const year = Number(today.slice(0, 4));
  const view = useMemo(() => answerView(extras.answers.summary), [extras.answers.summary]);
  const head = (
    <>
      <h2 className="v3-fact-title">AI 답변에 우리가 나오나</h2>
      <p className="v3-card-sub">사람이 AI에게 직접 물어보고 답을 적은 기록이에요.</p>
    </>
  );
  if (extras.answers.state === "error" || extras.answers.state === "none") {
    return (
      <div className="v3-card v3-ai-wide">
        {head}
        <StatusLine status="error" />
      </div>
    );
  }
  if (extras.answers.state === "loading") {
    return (
      <div className="v3-card v3-ai-wide">
        {head}
        <StatusLine status="loading" />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="v3-card v3-ai-wide">
        {head}
        <p className="v3-tiny">이 기간에 AI에게 직접 물어본 기록이 없어요. 물어본 날이 이 기간 안에 있어야 보여요.</p>
      </div>
    );
  }
  const rate = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
  const pp =
    view.questionsMentionedBefore != null && view.questionsMentionedComparable != null && view.questionsCheckedBefore
      ? Math.round(
          (rate(view.questionsMentionedComparable, view.questionsCheckedBefore) -
            rate(view.questionsMentionedBefore, view.questionsCheckedBefore)) *
            10
        ) / 10
      : null;
  return (
    <div className="v3-card v3-ai-wide">
      {head}
      <div className="v3-highlight">
        <b>어떻게 모았나 · 얼마나 믿을 만한가</b>
        <p className="v3-tiny">
          {dayText(view.latest, year)}에 사람이 질문 {view.questionsChecked}개를 AI에 하나씩 물어보고 답을 적었어요 (이 기간
          확인 {view.rounds}회). AI 답은 물을 때마다 조금씩 달라서, 한 번 물어본 결과는 참고용이에요. 같은 질문을 여러 번
          물어본 기록이 쌓여야 흐름을 믿을 수 있어요.
        </p>
      </div>
      <div className="v3-ai-stat">
        {view.questionsMentioned.toLocaleString("ko-KR")}
        <small> / {view.questionsChecked.toLocaleString("ko-KR")}개 질문에서 우리 이름이 나옴</small>
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
            ? `앞 회차 ${view.questionsMentionedBefore}개 질문`
            : "앞 회차 기록 없음 · 처음 확인한 결과"}
        </small>
      </div>
      <h3>AI마다</h3>
      <List
        items={view.columns.map((col) => ({
          key: col.label,
          name: (
            <>
              {col.label}
              {col.label === GOOGLE_SUMMARY ? <span className="v3-muted"> · 구글 검색 결과 위 AI 요약, 제미나이 앱 아님</span> : null}
            </>
          ),
          value:
            col.checked === 0
              ? "확인 안 함"
              : col.checked < view.questionsChecked
                ? `${col.mentioned} / ${col.checked}개 (${col.checked}개만 확인)`
                : `${col.mentioned} / ${col.checked}개 질문`
        }))}
      />
      <h3>AI마다 얼마나 확인했나</h3>
      <p className="v3-tiny">
        마지막으로 물어본 날, 전체 질문 {view.questionsTotal}개 중 물어본 질문 수, 사람이 「틀림」으로 적은 답 수예요. 물어본
        질문이 적거나 오래됐으면 그 AI 결과는 덜 믿을 만해요.
      </p>
      <div className="v3-table-wrap">
        <table>
          <thead>
            <tr>
              <th>AI</th>
              <th>마지막 확인</th>
              <th className="v3-num">확인한 질문</th>
              <th className="v3-num">틀린 내용</th>
            </tr>
          </thead>
          <tbody>
            {view.reliability.map((item) => (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td>{item.lastChecked ? dayText(item.lastChecked, year) : "이 기간 확인 안 함"}</td>
                <td className="v3-num">
                  {item.checked != null
                    ? `${item.checked} / ${item.total}개`
                    : item.lastChecked
                      ? "모름 (예전 회차라 질문 수를 못 받음)"
                      : "—"}
                </td>
                <td className="v3-num">{item.wrong != null ? `${item.wrong}건` : item.lastChecked ? "모름" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>어떤 질문에 우리 이름이 나왔나요?</h3>
      <p className="v3-tiny">○ 나옴 · × 안 나옴 · 「확인 안 함」은 그 AI에 물어보지 않은 것 · ○를 누르면 어떻게 나왔는지 보여요 · ! 틀린 내용 있음</p>
      <AnswerTable view={view} />
      {view.citedTop.length > 0 ? (
        <>
          <h3>답변이 근거로 쓴 우리 페이지 (모든 답 합계)</h3>
          <List
            items={view.citedTop.map((item) => ({
              key: item.url,
              name: item.url.replace(/^https?:\/\/(www\.)?apollonworks\.com/, "") || "/",
              value: `${item.count}회`
            }))}
          />
        </>
      ) : null}
      {view.wrongFacts > 0 ? <p className="v3-tiny">틀린 내용이 {view.wrongFacts}건 적혀 있어요. 표에서 !가 붙은 칸을 눌러 보세요.</p> : null}
    </div>
  );
}

/* ─────────────────────── ③ 사람이 왔나 ─────────────────────── */

function VisitCard({ bundle, status, catalog }: Pick<V3ScreenProps, "bundle" | "status" | "catalog">) {
  const visits = useMemo(() => readAiVisits(bundle), [bundle]);
  const summary = useMemo(() => visitSummary(bundle), [bundle]);
  const bars = useMemo(() => visitBars(visits), [visits]);
  const pages = useMemo(() => visitPages(visits, titlesOf(catalog)), [visits, catalog]);

  return (
    <div className="v3-card">
      <h2 className="v3-fact-title">AI 답변을 보고 사람이 왔나</h2>
      <p className="v3-card-sub">ChatGPT 같은 AI 답변 속 링크를 눌러 우리 사이트에 들어온 방문이에요.</p>
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
          <h3>처음 들어온 페이지</h3>
          <List
            empty="이 기간에 AI 서비스에서 들어온 방문이 없어요."
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
        <p>실제로는 이 숫자보다 많을 수 있어요.</p>
        <p className="v3-tiny">
          AI 앱에서 링크를 누르면 어디서 왔는지 안 남는 경우가 많아요. 그런 방문은 「직접 방문」으로 잡혀요.
        </p>
      </div>
    </div>
  );
}

export function V3Ai({ bundle, status, catalog, from, to, today, extras }: V3ScreenProps) {
  const answer = useMemo(() => aiAnswer(bundle), [bundle]);
  return (
    <>
      <Intro
        menu="AI"
        question="AI가 우리 사이트를 읽고, 답변에 쓰고, 사람을 보내 주나요?"
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
      <AiTrends bundle={bundle} extras={extras} today={today} />
      <div className="v3-ai-grid">
        <ReadCard bundle={bundle} status={status} catalog={catalog} from={from} to={to} today={today} />
        <VisitCard bundle={bundle} status={status} catalog={catalog} />
        <AnswerCard extras={extras} today={today} />
      </div>
    </>
  );
}
