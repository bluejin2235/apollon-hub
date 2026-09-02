"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import {
  MetricHintButton,
  MetricHintPanel,
  type MetricHint
} from "@/components/website/stats/metric-hint";
import {
  StatsChart,
  STATS_COLORS,
  STATS_TEXT
} from "@/components/website/stats/stats-chart";
import {
  AI_QUESTION_COLORS,
  AI_QUESTION_SAMPLE,
  COUNTRY_SAMPLE,
  DEVICE_SAMPLE,
  KEYWORD_IMPRESSION_COLOR,
  KEYWORD_SAMPLE,
  KPI_SAMPLE,
  LANGUAGE_SAMPLE,
  LUNA_SAMPLE,
  SOURCE_DAILY_SAMPLE,
  SOURCE_PIE_SAMPLE,
  SOURCE_QUALITY_SAMPLE,
  SUMMARY_LIMIT_NOTE,
  TODO_SAMPLE,
  TREND_SAMPLE
} from "@/components/website/stats/summary-sample";
import "./stats.css";
import { getStats } from "@/lib/website/api";
import {
  PERIOD_PRESETS,
  STATS_SCREENS,
  type PeriodPresetId,
  type StatsScreenId
} from "@/lib/website/stats";

/** 요약 화면 KPI. summary 는 카드 안 한 줄, 나머지는 물음표 패널에만 나온다. */
const SUMMARY_HINTS: MetricHint[] = [
  {
    id: "visit",
    title: "방문",
    summary: "들어온 사람 수",
    definition: "사이트에 들어온 사람의 수입니다. 같은 사람이 여러 번 와도 하루 한 번으로 셉니다.",
    criterion: "늘어나는 추세인지가 중요합니다.",
    action: "줄었다면 검색 순위와 색인 상태를 먼저 보세요.",
    limit: "광고 차단 프로그램을 쓰면 빠집니다."
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
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: addIsoDays(today, -6), to: today };
  if (preset === "30d") return { from: addIsoDays(today, -29), to: today };
  if (preset === "3m") return { from: addMonths(today, -3), to: today };
  if (preset === "6m") return { from: addMonths(today, -6), to: today };
  if (preset === "1y") return { from: addMonths(today, -12), to: today };
  return { from: addIsoDays(today, -29), to: today };
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

function SectionHead({ title, stamp }: { title: string; stamp?: string }) {
  return (
    <div className="ws-sech">
      <h3>{title}</h3>
      {stamp ? <span className="ws-stamp">{stamp}</span> : null}
    </div>
  );
}

/** 목업의 .luna — 루나 총평 */
function LunaBlock() {
  return (
    <div className="ws-luna">
      <div className="ws-who">{LUNA_SAMPLE.who}</div>
      <p>{LUNA_SAMPLE.text}</p>
    </div>
  );
}

function SummaryKpis() {
  const panelId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = SUMMARY_HINTS.find((hint) => hint.id === openId) ?? null;

  return (
    <div className="ws-sec">
      <SectionHead title="이번 기간" stamp="방문 어제까지 · 검색 8월 28일까지" />
      <div className="ws-kpis">
        {SUMMARY_HINTS.map((hint) => {
          const kpi = KPI_SAMPLE.find((item) => item.id === hint.id);
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
              <div className={`ws-delta ws-${kpi?.tone ?? "flat"}`}>{kpi?.delta ?? "—"}</div>
              <p className="ws-kpi-sub">{hint.summary}</p>
              {kpi ? (
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

function TrendAndSources() {
  return (
    <div className="ws-sec ws-g2">
      <div className="ws-card">
        <div className="ws-ct">방문 추이 — 실선 이번 기간, 점선 지난 기간</div>
        <StatsChart
          type="line"
          data={TREND_SAMPLE}
          xKey="date"
          series={[
            { key: "current", name: "이번 기간", color: STATS_COLORS[0] },
            { key: "previous", name: "지난 기간", color: STATS_TEXT, dashed: true }
          ]}
        />
      </div>
      <div className="ws-card">
        <div className="ws-ct">경로별 비중</div>
        <StatsChart type="doughnut" data={SOURCE_PIE_SAMPLE} legend />
      </div>
    </div>
  );
}

function HowTheyArrived() {
  return (
    <div className="ws-sec">
      <SectionHead title="어디로 들어왔나" />
      <p className="ws-note">
        경로마다 사람의 성격이 다릅니다. 수보다 머문 시간과 본 페이지 수를 같이 보세요.
      </p>
      <div className="ws-g2">
        <div className="ws-card">
          <div className="ws-ct">경로별 일별 추이</div>
          <StatsChart
            type="line"
            data={SOURCE_DAILY_SAMPLE}
            xKey="date"
            legend
            series={[
              { key: "search", name: "검색", color: STATS_COLORS[0] },
              { key: "direct", name: "직접", color: STATS_COLORS[1] },
              { key: "ai", name: "AI", color: STATS_COLORS[2] },
              { key: "sns", name: "SNS", color: STATS_COLORS[3] }
            ]}
          />
        </div>
        <div className="ws-card">
          <div className="ws-ct">경로별 질 — 오른쪽 위일수록 좋음</div>
          <p className="ws-cs">가로 머문 시간(초) · 세로 본 페이지 수 · 원 크기 방문 수</p>
          <StatsChart
            type="scatter"
            groups={SOURCE_QUALITY_SAMPLE}
            xDomain={[0, 160]}
            yDomain={[0, 4]}
            sizeRange={[40, 700]}
            legend
          />
        </div>
      </div>
      <p className="ws-foot">
        AI로 들어온 사람이 가장 오래, 가장 깊이 봅니다. 수는 적어도 질이 높습니다.
      </p>
    </div>
  );
}

function WhoCame() {
  return (
    <div className="ws-sec ws-g3">
      <div className="ws-card">
        <div className="ws-ct">국가</div>
        <StatsChart
          type="hbar"
          data={COUNTRY_SAMPLE}
          xKey="name"
          height={150}
          labelWidth={52}
          series={[{ key: "value", name: "방문", color: STATS_COLORS[0] }]}
        />
      </div>
      <div className="ws-card">
        <div className="ws-ct">기기</div>
        <StatsChart type="doughnut" data={DEVICE_SAMPLE} height={150} legend />
      </div>
      <div className="ws-card">
        <div className="ws-ct">언어별 페이지</div>
        <StatsChart type="doughnut" data={LANGUAGE_SAMPLE} height={150} legend />
      </div>
    </div>
  );
}

function WhatWordsBrought() {
  return (
    <div className="ws-sec">
      <SectionHead title="어떤 말로 들어왔나" stamp="검색 8월 28일 · AI 8월 30일" />
      <div className="ws-g2">
        <div className="ws-card">
          <div className="ws-ct">
            <span className="ws-sw" style={{ background: STATS_COLORS[0] }} />
            검색엔진 — 노출 대비 클릭
          </div>
          <StatsChart
            type="hbar"
            data={KEYWORD_SAMPLE}
            xKey="name"
            labelWidth={128}
            legend
            series={[
              { key: "impressions", name: "노출", color: KEYWORD_IMPRESSION_COLOR },
              { key: "clicks", name: "클릭", color: STATS_COLORS[0] }
            ]}
          />
          <p className="ws-foot">노출 막대가 긴데 클릭 막대가 짧으면 제목이 안 걸리는 것입니다.</p>
        </div>
        <div className="ws-card">
          <div className="ws-ct">
            <span className="ws-sw" style={{ background: STATS_COLORS[2] }} />
            AI — 질문별 언급 (4개 AI 중)
          </div>
          <StatsChart
            type="hbar"
            data={AI_QUESTION_SAMPLE}
            xKey="name"
            labelWidth={128}
            max={4}
            series={[{ key: "count", name: "언급한 AI", colorByPoint: AI_QUESTION_COLORS }]}
          />
          <p className="ws-foot">0으로 뜬 질문이 다음 글감입니다.</p>
        </div>
      </div>
    </div>
  );
}

function TodoList() {
  return (
    <div className="ws-sec">
      <SectionHead title="이번 기간 할 일" stamp="루나가 뽑음" />
      <div className="ws-card">
        <ul className="ws-todo">
          {TODO_SAMPLE.map((item) => (
            <li key={item.title}>
              <span className={`ws-tag ws-tag-${item.level}`}>{item.levelLabel}</span>
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

/** 요약 화면 전체. 값은 전부 임시다 — summary-sample.ts */
function SummaryScreen() {
  return (
    <>
      <LunaBlock />
      <SummaryKpis />
      <TrendAndSources />
      <HowTheyArrived />
      <WhoCame />
      <WhatWordsBrought />
      <TodoList />
      <p className="ws-foot">{SUMMARY_LIMIT_NOTE}</p>
    </>
  );
}

export function WebsiteStats({ screen }: { screen: StatsScreenId }) {
  const today = useMemo(() => seoulToday(), []);
  const [preset, setPreset] = useState<PeriodPresetId>("30d");
  const initial = rangeForPreset("30d", today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  useEffect(() => {
    let cancelled = false;
    void getStats({ from, to, kind: "daily" }).then((result) => {
      if (cancelled || !result.ok) return;
    });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

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
            <div className="ws-live" aria-label="지금 접속">
              <span className="ws-dot" aria-hidden />
              <span>지금 보고 있는 사람 —</span>
            </div>
          </div>
        </div>

        <div className="ws-bar-spacer" aria-hidden="true" />

        <div className="ws-body">
          {screen === "summary" ? (
          <ScreenShell id="summary">
            <SummaryScreen />
          </ScreenShell>
          ) : null}

          {screen === "content" ? <ScreenShell id="content" /> : null}
          {screen === "search" ? <ScreenShell id="search" /> : null}
          {screen === "ai-visibility" ? <ScreenShell id="ai-visibility" /> : null}
          {screen === "ai-crawler" ? <ScreenShell id="ai-crawler" /> : null}
          {screen === "behavior" ? <ScreenShell id="behavior" /> : null}
        </div>
      </div>
    </div>
  );
}
