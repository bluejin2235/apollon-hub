"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { MetricHint } from "@/components/website/stats/metric-hint";
import "./stats.css";
import { getStats } from "@/lib/website/api";
import {
  PERIOD_PRESETS,
  STATS_SCREENS,
  type PeriodPresetId,
  type StatsScreenId
} from "@/lib/website/stats";

const HINTS = {
  visit: {
    title: "방문",
    summary: "사이트에 들어온 사람 수. 같은 사람은 하루 한 번입니다.",
    definition: "사이트에 들어온 사람의 수입니다. 같은 사람이 여러 번 와도 하루 한 번으로 셉니다.",
    criterion: "늘어나는 추세인지가 중요합니다.",
    action: "줄었다면 검색 순위와 색인 상태를 먼저 보세요.",
    limit: "광고 차단 프로그램을 쓰면 빠집니다."
  },
  imp: {
    title: "검색 노출",
    summary: "구글 결과에 우리가 보인 횟수입니다. 클릭하지 않아도 셉니다.",
    definition: "구글 검색 결과에 우리가 보인 횟수입니다. 눌리지 않아도 셉니다.",
    criterion: "노출이 늘고 클릭이 안 늘면 제목이 안 걸리는 것입니다.",
    action: "검색 화면에서 클릭률이 낮은 검색어의 제목을 다시 쓰세요.",
    limit: "구글이 3일 늦게 줍니다."
  },
  ai: {
    title: "AI 유입",
    summary: "ChatGPT·Gemini·Claude·Perplexity 답변을 통해 들어온 방문입니다.",
    definition: "ChatGPT·Gemini·Claude·Perplexity 답변을 통해 들어온 방문입니다.",
    criterion: "아직 전체의 1% 안팎이 보통입니다. 다만 오래 머물고 여러 장을 봅니다.",
    action: "AI 노출 화면의 빈틈 질문으로 글을 쓰면 늘어납니다.",
    limit: "유입처를 남기지 않는 방문이 35~70%라 적게 잡힙니다."
  },
  bounce: {
    title: "이탈률",
    summary: "들어와서 아무것도 누르지 않고 나간 비율입니다.",
    definition: "들어와서 아무것도 누르지 않고 나간 비율입니다.",
    criterion: "보통 40~60%. 70%를 넘으면 다음으로 갈 길이 없다는 뜻입니다.",
    action: "그 페이지에 관련 콘텐츠를 연결하면 내려갑니다.",
    limit: "한 장을 오래 읽고 나간 것도 이탈로 잡힙니다."
  },
  lead: {
    title: "문의",
    summary: "Let's Talk 폼으로 실제 보내진 건수입니다.",
    definition: "Let's Talk 폼으로 실제 보내진 건수입니다.",
    criterion: "이 사이트의 최종 목표입니다. 방문이 늘어도 0이면 길이 막힌 것입니다.",
    action: "행동 화면의 깔때기에서 어디서 끊기는지 보세요.",
    limit: "메일이나 전화로 오는 문의는 잡히지 않습니다."
  }
} as const;

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
    <section>
      <h2 className="ws-pt">{screen.label}</h2>
      <p className="ws-lede">{screen.lede}</p>
      {children}
    </section>
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
              <span>
                <span className="ws-dot" />
                지금
              </span>
              <b>—</b>
              <span>자리만 둡니다</span>
            </div>
          </div>
        </div>

        {screen === "summary" ? (
          <ScreenShell id="summary">
            <div className="ws-kpis">
              <div className="ws-kpi">
                <MetricHint {...HINTS.visit}>
                  <div className="ws-val">—</div>
                </MetricHint>
              </div>
              <div className="ws-kpi">
                <MetricHint {...HINTS.imp}>
                  <div className="ws-val">—</div>
                </MetricHint>
              </div>
              <div className="ws-kpi">
                <MetricHint {...HINTS.ai}>
                  <div className="ws-val">—</div>
                </MetricHint>
              </div>
              <div className="ws-kpi">
                <MetricHint {...HINTS.bounce}>
                  <div className="ws-val">—</div>
                </MetricHint>
              </div>
              <div className="ws-kpi">
                <MetricHint {...HINTS.lead}>
                  <div className="ws-val">—</div>
                </MetricHint>
              </div>
            </div>
          </ScreenShell>
        ) : null}

        {screen === "content" ? <ScreenShell id="content" /> : null}
        {screen === "search" ? <ScreenShell id="search" /> : null}
        {screen === "ai-visibility" ? <ScreenShell id="ai-visibility" /> : null}
        {screen === "ai-crawler" ? <ScreenShell id="ai-crawler" /> : null}
        {screen === "behavior" ? <ScreenShell id="behavior" /> : null}
      </div>
    </div>
  );
}
