"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { DeltaMark } from "@/components/website/stats/delta-mark";
import {
  MetricHintButton,
  MetricHintPanel,
  type MetricHint
} from "@/components/website/stats/metric-hint";
import { BEHAVIOR_KINDS } from "@/components/website/stats/behavior-data";
import { BehaviorScreen } from "@/components/website/stats/behavior-screen";
import { CONTENT_KINDS } from "@/components/website/stats/content-data";
import { ContentScreen } from "@/components/website/stats/content-screen";
import { SEARCH_KINDS } from "@/components/website/stats/search-data";
import { SearchScreen } from "@/components/website/stats/search-screen";
import {
  StatsChart,
  STATS_COLORS,
  STATS_MUTED,
  STATS_TEXT
} from "@/components/website/stats/stats-chart";
import {
  launchMark,
  pickRows,
  readActualRange,
  readLaunchDate,
  SITE_LAUNCH_DATE,
  type ActualCompareRange
} from "@/components/website/stats/stats-data";
import {
  ChartSlot,
  SectionHead,
  type LoadStatus,
  type StatsData
} from "@/components/website/stats/stats-slot";
import {
  TODO_LEVEL_LABEL,
  loadSummaryBrief
} from "@/components/website/stats/summary-brief-cache";
import {
  buildCountry,
  buildDevice,
  buildKeywords,
  buildKpis,
  buildLanguage,
  buildSourceDaily,
  buildSourcePie,
  buildSourceQuality,
  buildSummaryBriefFacts,
  buildTrend,
  keywordsBasisText,
  summaryBriefFingerprint,
  SUMMARY_KINDS
} from "@/components/website/stats/summary-data";
import {
  AI_QUESTION_COLORS,
  AI_QUESTION_SAMPLE,
  SUMMARY_LIMIT_NOTE
} from "@/components/website/stats/summary-sample";
import "./stats.css";
import { getStatsBundle, getStatsRealtime, type StatsBriefResult } from "@/lib/website/api";
import {
  PERIOD_PRESETS,
  STATS_SCREENS,
  type PeriodPresetId,
  type StatsBundle,
  type StatsScreenId,
  type StatsSyncKindStatus,
  type StatsSyncStatus
} from "@/lib/website/stats";

/** 화면마다 필요한 kind 가 다르다. 안 쓰는 것까지 받지 않는다 */
const KINDS_BY_SCREEN: Partial<Record<StatsScreenId, string[]>> = {
  summary: SUMMARY_KINDS,
  content: CONTENT_KINDS,
  search: SEARCH_KINDS,
  behavior: BEHAVIOR_KINDS
};

/** 요약 화면 KPI. summary 는 카드 안 한 줄, 나머지는 물음표 패널에만 나온다. */
const SUMMARY_HINTS: MetricHint[] = [
  {
    id: "visit",
    title: "일별 사용자 합계(중복 포함)",
    summary: "날짜별 사용자 수를 더한 값",
    definition:
      "하루마다 센 사용자(totalUsers)를 기간 동안 더한 값입니다. 같은 사람이 여러 날에 오면 날마다 다시 셉니다. 기간 고유 사용자와 같지 않습니다.",
    criterion: "늘어나는 추세인지가 중요합니다. 고유 방문자로 읽지 마세요.",
    action: "줄었다면 검색 순위와 색인 상태를 먼저 보세요.",
    limit:
      "GA4 기간 고유 사용자를 따로 받지 않아 일별 합계만 보입니다. 세션·조회수처럼 날짜끼리 더해도 되는 지표와 다릅니다. 광고 차단 프로그램을 쓰면 빠집니다."
  },
  {
    id: "imp",
    title: "검색 노출",
    summary: "구글 결과에 보인 횟수",
    definition: "구글 검색 결과에 우리가 보인 횟수입니다. 눌리지 않아도 셉니다.",
    criterion: "노출이 늘고 클릭이 안 늘면 제목이 안 걸리는 것입니다.",
    action: "검색 화면에서 클릭률이 낮은 검색어의 제목을 다시 쓰세요.",
    limit: "구글이 3일 늦게 줍니다."
  },
  {
    id: "ai",
    title: "AI 유입",
    summary: "AI 답변으로 들어온 방문",
    definition: "ChatGPT·Gemini·Claude·Perplexity 답변을 통해 들어온 방문입니다.",
    criterion: "아직 전체의 1% 안팎이 보통입니다. 다만 오래 머물고 여러 장을 봅니다.",
    action: "AI 노출 화면의 빈틈 질문으로 글을 쓰면 늘어납니다.",
    limit: "유입처를 남기지 않는 방문이 35~70%라 적게 잡힙니다."
  },
  {
    id: "bounce",
    title: "이탈률",
    summary: "아무것도 안 누르고 나간 비율",
    definition: "들어와서 아무것도 누르지 않고 나간 비율입니다.",
    criterion: "보통 40~60%. 70%를 넘으면 다음으로 갈 길이 없다는 뜻입니다.",
    action: "그 페이지에 관련 콘텐츠를 연결하면 내려갑니다.",
    limit: "한 장을 오래 읽고 나간 것도 이탈로 잡힙니다."
  },
  {
    id: "lead",
    title: "문의",
    summary: "Let's Talk 폼으로 온 건수",
    definition: "Let's Talk 폼으로 실제 보내진 건수입니다.",
    criterion: "이 사이트의 최종 목표입니다. 방문이 늘어도 0이면 길이 막힌 것입니다.",
    action: "행동 화면의 깔때기에서 어디서 끊기는지 보세요.",
    limit: "메일이나 전화로 오는 문의는 잡히지 않습니다."
  }
];

function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function addIsoDays(iso: string, delta: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return utc.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1 + months, day));
  return utc.toISOString().slice(0, 10);
}

function rangeForPreset(preset: PeriodPresetId, today: string): { from: string; to: string } {
  if (preset === "yesterday") {
    const day = addIsoDays(today, -1);
    return { from: day, to: day };
  }
  if (preset === "7d") return { from: addIsoDays(today, -6), to: today };
  if (preset === "30d") return { from: addIsoDays(today, -29), to: today };
  if (preset === "3m") return { from: addMonths(today, -3), to: today };
  if (preset === "6m") return { from: addMonths(today, -6), to: today };
  if (preset === "1y") return { from: addMonths(today, -12), to: today };
  return { from: addIsoDays(today, -29), to: today };
}

function isoParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** 시작·끝 포함 일수 */
function inclusiveDays(from: string, to: string): number {
  const a = isoParts(from);
  const b = isoParts(to);
  const start = Date.UTC(a.y, a.m - 1, a.d);
  const end = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((end - start) / 86_400_000) + 1;
}

/** 고른 기간 바로 앞의 같은 길이 */
function previousRange(from: string, to: string): { from: string; to: string } {
  const length = inclusiveDays(from, to);
  const prevTo = addIsoDays(from, -1);
  const prevFrom = addIsoDays(prevTo, -(length - 1));
  return { from: prevFrom, to: prevTo };
}

/** 올해가 아니면 해를 붙인다. 11월 11일 · 2025년 11월 11일 */
function dayText(iso: string, todayYear: number): string {
  const { y, m, d } = isoParts(iso);
  const year = y !== todayYear ? `${y}년 ` : "";
  return `${year}${m}월 ${d}일`;
}

/** 같은 달이면 끝 날짜의 달을 빼 11월 5일~11일 로 적는다 */
function rangeText(from: string, to: string, todayYear: number): string {
  if (from === to) return dayText(from, todayYear);
  const a = isoParts(from);
  const b = isoParts(to);
  const start = dayText(from, todayYear);
  if (a.y === b.y && a.m === b.m) return `${start}~${b.d}일`;
  const endYear = a.y !== b.y ? `${b.y}년 ` : "";
  return `${start}~${endYear}${b.m}월 ${b.d}일`;
}

/** 앞 기간 끝 글자의 받침으로 「와/과」를 고른다. 괄호는 건너뛴다. */
function compareParticle(text: string): "와" | "과" {
  for (let i = text.length - 1; i >= 0; i--) {
    const code = text.charCodeAt(i);
    if (code < 0xac00 || code > 0xd7a3) continue;
    return (code - 0xac00) % 28 === 0 ? "와" : "과";
  }
  return "와";
}

function compareLine(
  preset: PeriodPresetId,
  from: string,
  to: string,
  today: string,
  api: ActualCompareRange | null
): string {
  const todayYear = Number(today.slice(0, 4));
  if (!api) {
    if (!from || !to || from > to) return "";
    const prev = previousRange(from, to);
    const currentMark = preset === "yesterday" ? " (어제)" : "";
    const before = `${rangeText(prev.from, prev.to, todayYear)}${preset === "yesterday" ? " (그저께)" : ""}`;
    return `${rangeText(from, to, todayYear)}${currentMark} ↔ ${before}${compareParticle(before)} 비교`;
  }
  if (api.actualFrom > api.actualTo) return "";

  const yesterday =
    preset === "yesterday" && !api.clipped && api.actualFrom === api.actualTo && api.prevFrom === api.prevTo;
  const current = api.clipped
    ? `오픈 후 ${inclusiveDays(api.actualFrom, api.actualTo)}일 (${rangeText(api.actualFrom, api.actualTo, todayYear)})`
    : `${rangeText(api.actualFrom, api.actualTo, todayYear)}${yesterday ? " (어제)" : ""}`;
  const before = `${rangeText(api.prevFrom, api.prevTo, todayYear)}${yesterday ? " (그저께)" : ""}`;
  return `${current} ↔ ${before}${compareParticle(before)} 비교`;
}

/** 앞 기간 시작이 오픈일보다 앞이면 옛 사이트 구간이다. 오픈일이 없으면 표시하지 않는다. */
function previousStartsBeforeLaunch(from: string, to: string): boolean {
  if (!SITE_LAUNCH_DATE || !from || !to || from > to) return false;
  return previousRange(from, to).from < SITE_LAUNCH_DATE;
}

function ScreenShell({
  id,
  children
}: {
  id: StatsScreenId;
  children?: ReactNode;
}) {
  const screen = STATS_SCREENS.find((item) => item.id === id);
  if (!screen) return null;
  return (
    <section className="ws-screen">
      <h2 className="ws-pt">{screen.label}</h2>
      <p className="ws-lede">{screen.lede}</p>
      {children}
    </section>
  );
}

const AI_SLOTS = ["읽어 감", "답에 씀", "사람이 옴"] as const;

/** 수집 전 AI 화면. 숫자는 넣지 않는다. */
function AiScreen() {
  const screen = STATS_SCREENS.find((item) => item.id === "ai");
  if (!screen) return null;
  return (
    <section className="ws-screen">
      <h2 className="ws-pt">{screen.lede}</h2>
      <div className="ws-kpis ws-kpis-3">
        {AI_SLOTS.map((name) => (
          <div key={name} className="ws-kpi">
            <div className="ws-lab">{name}</div>
            <p className="ws-kpi-sub">아직 수집하지 않습니다</p>
          </div>
        ))}
      </div>
    </section>
  );
}

type BriefState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: StatsBriefResult }
  | { status: "error" };

/**
 * 루나 총평·할 일. 숫자만 API 에 넘기고, 같은 기간·같은 지문은 localStorage 캐시.
 */
function useSummaryBrief(data: StatsData, from: string, to: string): {
  state: BriefState;
  retry: () => void;
} {
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

    void loadSummaryBrief(from, to, fingerprint, facts).then((result) => {
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

  return {
    state,
    retry: () => setRetryTick((n) => n + 1)
  };
}

function LunaBlock({
  state,
  onRetry
}: {
  state: BriefState;
  onRetry: () => void;
}) {
  if (state.status === "idle") return null;

  return (
    <div className="ws-luna">
      <div className="ws-who">루나가 읽은 이번 기간</div>
      {state.status === "loading" ? <p>요약을 만드는 중입니다…</p> : null}
      {state.status === "ready" ? <p>{state.data.summary}</p> : null}
      {state.status === "error" ? (
        <div className="ws-luna-fail">
          <p>요약을 만들지 못했습니다</p>
          <button type="button" className="ws-retry" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SummaryKpis({ data }: { data: StatsData }) {
  const panelId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = SUMMARY_HINTS.find((hint) => hint.id === openId) ?? null;
  const kpis = useMemo(() => buildKpis(data.bundle), [data.bundle]);

  return (
    <div className="ws-sec">
      <SectionHead title="이번 기간" />
      <div className="ws-kpis">
        {SUMMARY_HINTS.map((hint) => {
          const kpi = kpis.find((item) => item.id === hint.id);
          return (
            <div className="ws-kpi" key={hint.id}>
              <div className="ws-lab">
                <span className="ws-lab-text">{hint.title}</span>
                <MetricHintButton
                  hint={hint}
                  open={openId === hint.id}
                  panelId={panelId}
                  onToggle={() => setOpenId((current) => (current === hint.id ? null : hint.id))}
                />
              </div>
              <div className="ws-val">{kpi?.value ?? "—"}</div>
              <DeltaMark
                delta={kpi?.delta ?? null}
                tone={kpi?.tone ?? "flat"}
                previous={kpi?.previous ?? null}
              />
              <p className="ws-kpi-sub">{hint.summary}</p>
              {kpi && kpi.spark.length > 0 ? (
                <StatsChart
                  type="spark"
                  data={kpi.spark}
                  dataKey="v"
                  color={kpi.sparkColor}
                  height={26}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {open ? (
        <MetricHintPanel id={panelId} hint={open} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}

function TrendAndSources({ data }: { data: StatsData }) {
  const trend = useMemo(() => buildTrend(data.bundle), [data.bundle]);
  const pie = useMemo(() => buildSourcePie(data.bundle), [data.bundle]);
  const mark = useMemo(
    () => launchMark(pickRows(data.bundle, "daily", "ga4", "current"), undefined, readLaunchDate(data.bundle)),
    [data.bundle]
  );

  return (
    <div className="ws-sec ws-g2">
      <div className="ws-card">
        <div className="ws-ct">일별 사용자 추이 — 실선 이번 기간, 점선 지난 기간</div>
        <ChartSlot
          status={data.status}
          empty={trend.length === 0}
          showLaunchNote={Boolean(mark)}
        >
          <StatsChart
            type="line"
            data={trend}
            xKey="date"
            mark={mark ?? undefined}
            series={[
              { key: "current", name: "이번 기간", color: STATS_COLORS[0] },
              { key: "previous", name: "지난 기간", color: STATS_TEXT, dashed: true }
            ]}
          />
        </ChartSlot>
      </div>
      <div className="ws-card">
        <div className="ws-ct">경로별 비중</div>
        <ChartSlot status={data.status} empty={pie.length === 0}>
          <StatsChart type="doughnut" data={pie} legend />
        </ChartSlot>
      </div>
    </div>
  );
}

function HowTheyArrived({ data }: { data: StatsData }) {
  const daily = useMemo(() => buildSourceDaily(data.bundle), [data.bundle]);
  const quality = useMemo(() => buildSourceQuality(data.bundle), [data.bundle]);
  const mark = useMemo(
    () =>
      launchMark(pickRows(data.bundle, "channel", "ga4", "current"), undefined, readLaunchDate(data.bundle)),
    [data.bundle]
  );

  return (
    <div className="ws-sec">
      <SectionHead title="어디로 들어왔나" />
      <p className="ws-note">
        경로마다 사람의 성격이 다릅니다. 수보다 평균 세션 시간과 참여율을 같이 보세요.
      </p>
      <div className="ws-g2">
        <div className="ws-card">
          <div className="ws-ct">경로별 일별 추이</div>
          <ChartSlot
            status={data.status}
            empty={daily.rows.length === 0}
            showLaunchNote={Boolean(mark)}
          >
            <StatsChart
              type="line"
              data={daily.rows}
              xKey="date"
              legend
              mark={mark ?? undefined}
              series={daily.series}
            />
          </ChartSlot>
        </div>
        <div className="ws-card">
          <div className="ws-ct">경로별 질 — 오른쪽 위일수록 좋음</div>
          {/* 목업은 세로가 「본 페이지 수」였지만 GA4 channel 리포트에 없다 */}
          <p className="ws-cs">가로 평균 세션 시간(초) · 세로 참여율(%) · 원 크기 세션 수</p>
          <ChartSlot status={data.status} empty={quality.length === 0}>
            <StatsChart
              type="scatter"
              groups={quality}
              yDomain={[0, 100]}
              sizeRange={[40, 700]}
              legend
            />
          </ChartSlot>
        </div>
      </div>
    </div>
  );
}

function WhoCame({ data }: { data: StatsData }) {
  const country = useMemo(() => buildCountry(data.bundle), [data.bundle]);
  const device = useMemo(() => buildDevice(data.bundle), [data.bundle]);
  const language = useMemo(() => buildLanguage(data.bundle), [data.bundle]);

  return (
    <div className="ws-sec ws-g3">
      <div className="ws-card">
        <div className="ws-ct">국가</div>
        <ChartSlot status={data.status} empty={country.length === 0} height={150}>
          <StatsChart
            type="hbar"
            data={country}
            xKey="name"
            height={150}
            labelWidth={52}
            series={[{ key: "value", name: "일별 사용자 합계", color: STATS_COLORS[0] }]}
          />
        </ChartSlot>
      </div>
      <div className="ws-card">
        <div className="ws-ct">기기</div>
        <ChartSlot status={data.status} empty={device.length === 0} height={150}>
          <StatsChart type="doughnut" data={device} height={150} legend />
        </ChartSlot>
      </div>
      <div className="ws-card">
        <div className="ws-ct">언어별 페이지</div>
        <ChartSlot status={data.status} empty={language.length === 0} height={150}>
          <StatsChart type="doughnut" data={language} height={150} legend />
        </ChartSlot>
      </div>
    </div>
  );
}

function WhatWordsBrought({ data }: { data: StatsData }) {
  const keywords = useMemo(() => buildKeywords(data.bundle), [data.bundle]);
  const basisText = data.status === "ready" ? keywordsBasisText(keywords) : null;

  return (
    <div className="ws-sec">
      <SectionHead title="어떤 말로 들어왔나" />
      <div className="ws-g2">
        <div className="ws-card">
          <div className="ws-ct">
            <span className="ws-sw" style={{ background: STATS_COLORS[0] }} />
            검색엔진 — 노출 대비 클릭
            {basisText ? <span className="ws-stamp">{basisText}</span> : null}
          </div>
          <ChartSlot status={data.status} empty={keywords.rows.length === 0}>
            <StatsChart
              type="hbar"
              data={keywords.rows}
              xKey="name"
              labelWidth={128}
              legend
              series={[
                { key: "impressions", name: "노출", color: STATS_MUTED },
                { key: "clicks", name: "클릭", color: STATS_COLORS[0] }
              ]}
            />
            <p className="ws-foot">노출 막대가 긴데 클릭 막대가 짧으면 제목이 안 걸리는 것입니다.</p>
          </ChartSlot>
        </div>
        <div className="ws-card">
          <div className="ws-ct">
            <span className="ws-sw" style={{ background: STATS_COLORS[2] }} />
            AI — 질문별 언급 (4개 AI 중)
          </div>
          {/*
            임시 값이다. AI에 직접 물어 답변에 나오는지 세는 표가 아직 없다.
            website_stats 에는 이 값을 담을 kind 가 없어 연결할 곳이 없다.
          */}
          <StatsChart
            type="hbar"
            data={AI_QUESTION_SAMPLE}
            xKey="name"
            labelWidth={128}
            max={4}
            series={[{ key: "count", name: "언급한 AI", colorByPoint: AI_QUESTION_COLORS }]}
          />
          <p className="ws-foot">임시 값입니다. AI 노출을 세는 표를 아직 만들지 않았습니다.</p>
        </div>
      </div>
    </div>
  );
}

function TodoList({ state }: { state: BriefState }) {
  if (state.status !== "ready" || state.data.todos.length === 0) return null;

  return (
    <div className="ws-sec">
      <SectionHead title="이번 기간 할 일" />
      <div className="ws-card">
        <ul className="ws-todo">
          {state.data.todos.map((item) => (
            <li key={`${item.level}-${item.title}`}>
              <span className={`ws-tag ws-tag-${item.level}`}>{TODO_LEVEL_LABEL[item.level]}</span>
              <div>
                {item.title}
                <div className="ws-t2">{item.reason}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * 요약 화면 전체.
 * KPI·추이·경로·국가·기기·언어·검색어는 website_stats 를 읽는다.
 * 루나 총평·할 일은 숫자만 Anthropic 에 넘긴다. AI 질문 막대만 아직 임시 값.
 */
function SummaryScreen({ data, from, to }: { data: StatsData; from: string; to: string }) {
  const brief = useSummaryBrief(data, from, to);

  return (
    <>
      <LunaBlock state={brief.state} onRetry={brief.retry} />
      <SummaryKpis data={data} />
      <TrendAndSources data={data} />
      <HowTheyArrived data={data} />
      <WhoCame data={data} />
      <WhatWordsBrought data={data} />
      <TodoList state={brief.state} />
      <p className="ws-foot">{SUMMARY_LIMIT_NOTE}</p>
    </>
  );
}

type LiveVisitors = {
  count: number | null;
  pages: string[];
};

const LIVE_TITLE_TAILS = [" | 아폴론이머시브웍스", " | Apollon Immersive Works"];
const LIVE_ROLL_MS = 4_000;

/** 제목 끝의 사이트 이름을 떼고, 빈 값과 (other) 는 뺀다 */
function cleanLiveTitle(name: string): string | null {
  let text = name.trim();
  if (!text || text === "(other)") return null;
  let tail = LIVE_TITLE_TAILS.find((item) => text.endsWith(item));
  while (tail) {
    text = text.slice(0, -tail.length).trim();
    tail = LIVE_TITLE_TAILS.find((item) => text.endsWith(item));
  }
  if (!text || text === "(other)") return null;
  return text;
}

function liveTitles(pages: { name: string }[]): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const page of pages) {
    const title = cleanLiveTitle(page.name);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

/**
 * GA4 Realtime — 30초마다. 오류여도 통계 화면은 멈추지 않는다.
 *
 * Realtime 은 pagePath 가 없어 unifiedScreenName(페이지 제목) 을 그대로 쓴다.
 * 경로 → 워크·인사이트 제목 매핑은 할 수 없다.
 */
function useLiveVisitors(): LiveVisitors {
  const [live, setLive] = useState<LiveVisitors>({ count: null, pages: [] });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function pull() {
      const result = await getStatsRealtime(controller.signal);
      if (cancelled) return;
      if (!result.ok || result.data.activeUsers === null) {
        setLive({ count: null, pages: [] });
        return;
      }
      const count = result.data.activeUsers;
      const names = liveTitles(result.data.pages);
      setLive((prev) => {
        const samePages =
          prev.pages.length === names.length && prev.pages.every((page, i) => page === names[i]);
        if (prev.count === count && samePages) return prev;
        return { count, pages: samePages ? prev.pages : names };
      });
    }

    void pull();
    const timer = setInterval(() => {
      void pull();
    }, 30_000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return live;
}

/** 제목이 둘 이상일 때만 넘긴다. 하나면 그 제목을 그대로 둔다. */
function LiveTitleRoll({ titles }: { titles: string[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (titles.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % titles.length);
    }, LIVE_ROLL_MS);
    return () => clearInterval(timer);
  }, [titles]);

  const title = titles[index] ?? titles[0];
  if (!title) return null;
  return (
    <span className="ws-live-title" key={`${index}-${title}`}>
      {title}
    </span>
  );
}

const SYNC_TIME_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

/** 서울 시간 「M월 D일 HH:mm」 */
function syncTimeText(iso: string): string {
  const parts = SYNC_TIME_FORMAT.formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("month")}월 ${pick("day")}일 ${pick("hour")}:${pick("minute")}`;
}

function syncKindName(item: StatsSyncKindStatus): string {
  const source = item.source === "ga4" ? "GA" : item.source === "gsc" ? "검색" : item.source;
  return `${source}·${item.kind}`;
}

function okTimes(kinds: StatsSyncKindStatus[]): string[] {
  return kinds
    .map((item) => item.last_ok_at)
    .filter((value): value is string => value !== null)
    .sort();
}

type SyncLine = { tone: "fail" | "warn" | null; text: string };

/** 수집 상태 한 줄. 실패 → 늦음 → 마지막 수집 순서로 하나만 */
function syncMainLine(kinds: StatsSyncKindStatus[]): SyncLine | null {
  if (kinds.length === 0) return null;

  const failed = kinds.filter((item) => item.failed);
  if (failed.length > 0) {
    const names = failed.map(syncKindName).join(", ");
    const error = failed.find((item) => item.last_error)?.last_error;
    const errorHead = error ? `${error.slice(0, 60)}${error.length > 60 ? "…" : ""}` : null;
    return {
      tone: "fail",
      text: errorHead ? `수집 실패 · ${names} · ${errorHead}` : `수집 실패 · ${names}`
    };
  }

  const times = okTimes(kinds);
  if (kinds.some((item) => item.overdue)) {
    const oldest = kinds.some((item) => item.last_ok_at === null) ? null : times[0];
    return {
      tone: "warn",
      text: oldest ? `수집 늦음 · 마지막 수집 ${syncTimeText(oldest)}` : "수집 늦음 · 수집 기록 없음"
    };
  }

  const latest = times[times.length - 1];
  return latest ? { tone: null, text: `마지막 수집 ${syncTimeText(latest)}` } : null;
}

function SyncStatusLine({ status }: { status: StatsSyncStatus | null }) {
  if (!status) return null;
  const main = syncMainLine(status.kinds);
  const gaMissing = status.ga_daily_data_missing;
  if (!main && !gaMissing) return null;

  return (
    <div className="ws-sync" role="status">
      {main ? <span className={main.tone ?? undefined}>{main.text}</span> : null}
      {gaMissing ? (
        <span className="warn">
          {status.ga_daily_latest_date
            ? `GA 최근 데이터 없음 (마지막 ${status.ga_daily_latest_date})`
            : "GA 최근 데이터 없음"}
        </span>
      ) : null}
    </div>
  );
}

export function WebsiteStats({ screen }: { screen: StatsScreenId }) {
  const today = useMemo(() => seoulToday(), []);
  const [preset, setPreset] = useState<PeriodPresetId>("yesterday");
  const initial = rangeForPreset("yesterday", today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [bundle, setBundle] = useState<StatsBundle | null>(null);
  const [syncStatus, setSyncStatus] = useState<StatsSyncStatus | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const kinds = KINDS_BY_SCREEN[screen];
  const live = useLiveVisitors();

  useEffect(() => {
    if (!kinds) {
      setBundle(null);
      setStatus("ready");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");

    void getStatsBundle({ from, to, kinds, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setBundle(null);
          setSyncStatus(null);
          setStatus("error");
          return;
        }
        setBundle(result.data.bundle);
        setSyncStatus(result.data.sync_status);
        setStatus("ready");
      }
    );

    return () => {
      controller.abort();
    };
  }, [from, to, kinds]);

  const data: StatsData = { bundle, status };
  const apiRange = readActualRange(bundle);
  const compareText = compareLine(preset, from, to, today, apiRange);
  const showOldSite = apiRange?.prevIncludesPreLaunch ?? previousStartsBeforeLaunch(from, to);

  function applyPreset(next: PeriodPresetId) {
    setPreset(next);
    if (next === "custom") return;
    const range = rangeForPreset(next, today);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <div className="ws">
      <div className="ws-main">
        <div className="ws-bar">
          <div className="ws-bar-row">
            <div>
              <div className="ws-seg" role="group" aria-label="기간">
                {PERIOD_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={preset === item.id ? "on" : undefined}
                    onClick={() => applyPreset(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <SyncStatusLine status={syncStatus} />
            <div className="ws-live">
              <span className="ws-dot" aria-hidden />
              <span>
                지금 방문객 {live.count === null ? "—" : <b>{live.count}</b>}
                {live.count === null ? null : "명"}
              </span>
              <small>최근 30분</small>
              {live.pages.length > 0 ? (
                <span className="ws-live-watch">
                  <span>보고 있는 콘텐츠</span>
                  <LiveTitleRoll titles={live.pages} />
                </span>
              ) : null}
            </div>
          </div>
          {compareText ? (
            <p className="ws-compare">
              <span>{compareText}</span>
              {showOldSite ? <span className="ws-stamp">앞 기간은 옛 사이트</span> : null}
            </p>
          ) : null}
          {preset === "custom" ? (
            <div className="ws-custom">
              <label>
                시작
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                끝
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={today}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="ws-bar-spacer" aria-hidden="true" />

        <div className="ws-body">
          {screen === "summary" ? (
          <ScreenShell id="summary">
            <SummaryScreen data={data} from={from} to={to} />
          </ScreenShell>
          ) : null}

          {screen === "content" ? (
            <ScreenShell id="content">
              <ContentScreen data={data} />
            </ScreenShell>
          ) : null}
          {screen === "search" ? (
            <ScreenShell id="search">
              <SearchScreen data={data} />
            </ScreenShell>
          ) : null}
          {screen === "ai" ? <AiScreen /> : null}
          {screen === "behavior" ? (
            <ScreenShell id="behavior">
              <BehaviorScreen data={data} />
            </ScreenShell>
          ) : null}
        </div>
      </div>
    </div>
  );
}
