"use client";

/**
 * 행동 화면 — docs/mockups/website-stats-mockup-v2.html 의 「행동」
 *
 * 앞의 화면들이 「사람을 데려오는 일」이면 여기는 「데려온 다음」이다.
 * 최종 목표인 문의까지 가는지를 잰다.
 *
 * 지금 걷는 리포트로 못 만드는 자리가 셋 있다. 깔때기 가운데 두 칸,
 * 두 가지 분포, 요일 × 시간 히트맵이다. 억지로 채우지 않고 그 자리에 이유를
 * 적었다. 무엇이 왜 안 되는지는 behavior-data.ts 머리글에 모아 두었다.
 */

import { Fragment, useMemo } from "react";

import {
  buildBouncedEntries,
  buildDepthTrend,
  buildDwellSummary,
  buildDwellTrend,
  buildFunnel,
  buildHourHeat,
  buildLeadKpis,
  buildLeadTrend,
  buildNewVsReturning,
  HEAT_DAYS,
  LEAD_EVENTS,
  type FunnelStep,
  type HeatModel
} from "@/components/website/stats/behavior-data";
import {
  StatsChart,
  STATS_COLORS,
  STATS_MUTED
} from "@/components/website/stats/stats-chart";
import { dash, intText, launchMark, pickRows } from "@/components/website/stats/stats-data";
import { ChartSlot, SectionHead, type StatsData } from "@/components/website/stats/stats-slot";

/* ─────────────────────── 1. 문의까지 가는 길 ─────────────────────── */

function FunnelBar({ step }: { step: FunnelStep }) {
  if (step.value == null) {
    return (
      <div className="ws-fn-col ws-fn-col-none" title={step.reason ?? undefined}>
        <div className="ws-fn-none" />
        <b>—</b>
        <em>{step.label}</em>
      </div>
    );
  }

  return (
    <div className="ws-fn-col">
      <div className="ws-fn-fill" style={{ height: `${step.height}%` }} />
      <b>{dash(intText(step.value))}</b>
      <em>{step.label}</em>
      {step.share ? <u>{step.share}</u> : null}
    </div>
  );
}

function Funnel({ data }: { data: StatsData }) {
  const steps = useMemo(() => buildFunnel(data.bundle), [data.bundle]);
  const missing = steps.filter((step) => step.reason);
  const anyValue = steps.some((step) => step.value != null);

  return (
    <div className="ws-sec">
      <SectionHead title="문의까지 가는 길" stamp="어제까지" />
      <p className="ws-note">
        단계마다 얼마나 빠져나가는지 봅니다. 가장 크게 줄어드는 곳이 손볼 자리입니다.
      </p>
      <div className="ws-card">
        <ChartSlot status={data.status} empty={!anyValue} height={210}>
          <div className="ws-fn">
            {steps.map((step) => (
              <FunnelBar key={step.id} step={step} />
            ))}
          </div>
        </ChartSlot>
        {missing.map((step) => (
          <p className="ws-blocked ws-blocked-gap" key={step.id}>
            <b>{step.label}</b> — {step.reason}
          </p>
        ))}
        <p className="ws-foot">
          칸마다 「들어옴의 몇 %」로 적었습니다. 가운데 두 칸을 셀 수 없어 칸끼리 이어지는
          감소율은 내지 않았습니다. 사람 수는 하루 단위 값을 기간만큼 더한 것이라, 여러 날
          온 사람은 여러 번 세어집니다. 문의는 메일이나 전화로 오는 것은 잡히지 않습니다.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────── 2. 머문 시간 · 본 페이지 수 ─────────────────────── */

const DIST_NOTE =
  "구간별 분포는 만들 수 없습니다. GA4 는 세션 하나하나를 주지 않고 하루 평균만 주어 구간으로 가를 원자료가 없습니다. 대신 평균이 어떻게 움직이는지 보입니다.";

function DwellAndDepth({ data }: { data: StatsData }) {
  const dwell = useMemo(() => buildDwellTrend(data.bundle), [data.bundle]);
  const depth = useMemo(() => buildDepthTrend(data.bundle), [data.bundle]);
  const summary = useMemo(() => buildDwellSummary(data.bundle), [data.bundle]);
  const mark = useMemo(
    () => launchMark(pickRows(data.bundle, "daily", "ga4", "current")),
    [data.bundle]
  );

  return (
    <div className="ws-sec ws-g2">
      <div className="ws-card">
        <div className="ws-ct">평균 머문 시간 추이</div>
        <p className="ws-cs">이번 기간 평균 {summary.avgSeconds ?? "—"}</p>
        <ChartSlot status={data.status} empty={dwell.length === 0}>
          <StatsChart
            type="line"
            data={dwell}
            xKey="date"
            mark={mark ?? undefined}
            format={(value) => `${Math.round(value)}초`}
            series={[{ key: "seconds", name: "머문 시간", color: STATS_COLORS[0] }]}
          />
        </ChartSlot>
        <p className="ws-blocked ws-blocked-gap">{DIST_NOTE}</p>
      </div>
      <div className="ws-card">
        <div className="ws-ct">세션당 본 페이지 추이</div>
        <p className="ws-cs">이번 기간 평균 {summary.avgPages ?? "—"}</p>
        <ChartSlot status={data.status} empty={depth.length === 0}>
          <StatsChart
            type="line"
            data={depth}
            xKey="date"
            mark={mark ?? undefined}
            format={(value) => `${value.toFixed(1)}장`}
            series={[{ key: "pages", name: "본 페이지", color: STATS_COLORS[2] }]}
          />
        </ChartSlot>
        <p className="ws-blocked ws-blocked-gap">{DIST_NOTE}</p>
      </div>
    </div>
  );
}

/* ─────────────────────── 3. 언제 오나 ─────────────────────── */

/**
 * 목업처럼 CSS grid 로 직접 그린다. 차트 라이브러리를 쓰지 않는다.
 * 칸 하나가 요일 × 시간 하나다.
 */
function HeatGrid({ model }: { model: HeatModel }) {
  return (
    <div className="ws-hm">
      <div />
      {Array.from({ length: 24 }, (_, hour) => (
        <div className="ws-hm-hour" key={hour}>
          {hour % 3 === 0 ? hour : ""}
        </div>
      ))}
      {model.grid.map((row, day) => (
        <Fragment key={HEAT_DAYS[day]}>
          <div className="ws-hm-lbl">{HEAT_DAYS[day]}</div>
          {row.map((value, hour) => (
            <i
              key={hour}
              style={{
                background:
                  value == null
                    ? undefined
                    : `rgba(42, 120, 214, ${0.06 + Math.min(value / model.max, 1) * 0.88})`
              }}
              title={`${HEAT_DAYS[day]} ${hour}시 · ${value ?? "—"}`}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function WhenTheyCome({ data }: { data: StatsData }) {
  const heat = useMemo(() => buildHourHeat(data.bundle), [data.bundle]);

  return (
    <div className="ws-sec">
      <SectionHead title="언제 오나" />
      <p className="ws-note">
        진할수록 방문이 많은 시간입니다. 새 글을 올릴 시간을 정할 때 씁니다.
      </p>
      <div className="ws-card">
        {heat ? (
          <HeatGrid model={heat} />
        ) : (
          <p className="ws-blocked">
            아직 걷지 않아 그릴 수 없습니다. 지금 GA4 리포트에 시간 차원이 없습니다.
            <code>hourly</code> 리포트 하나를 더하면 켜집니다 —
            <code> dimensions [date, hour] · metrics [totalUsers, sessions]</code>. 요일은
            날짜에서 계산하므로 따로 걷지 않아도 됩니다. 화면은 이미 그 값을 받도록 되어
            있어 리포트만 더하면 됩니다.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── 4. 이탈 · 신규와 재방문 ─────────────────────── */

function ExitAndReturn({ data }: { data: StatsData }) {
  const bounced = useMemo(() => buildBouncedEntries(data.bundle), [data.bundle]);
  const returning = useMemo(() => buildNewVsReturning(data.bundle), [data.bundle]);
  const mark = useMemo(
    () => launchMark(pickRows(data.bundle, "daily", "ga4", "current")),
    [data.bundle]
  );

  return (
    <div className="ws-sec ws-g2">
      <div className="ws-card">
        <div className="ws-ct">들어와서 바로 나간 세션 — 진입 페이지별</div>
        <ChartSlot status={data.status} empty={bounced.rows.length === 0}>
          <StatsChart
            type="hbar"
            data={bounced.rows}
            xKey="name"
            labelWidth={150}
            series={[{ key: "value", name: "이탈 세션", colorByPoint: bounced.colors }]}
          />
        </ChartSlot>
        <p className="ws-blocked ws-blocked-gap">
          목업의 「많이 나가는 페이지」와 다릅니다. GA4 Data API 에 나감(exits) 지표가
          아예 없습니다. Explorations 화면과 BigQuery 내보내기에만 있어 리포트를 더해도
          받을 수 없습니다. 그래서 진입 페이지 기준으로 「들어와서 아무것도 안 하고 나간
          세션」을 세었습니다.
        </p>
      </div>
      <div className="ws-card">
        <div className="ws-ct">신규와 재방문</div>
        <ChartSlot status={data.status} empty={returning.length === 0}>
          <StatsChart
            type="bar"
            data={returning}
            xKey="date"
            legend
            mark={mark ?? undefined}
            series={[
              { key: "fresh", name: "신규", color: STATS_COLORS[0], stackId: "a" },
              { key: "again", name: "재방문", color: STATS_COLORS[2], stackId: "a" }
            ]}
          />
        </ChartSlot>
        <p className="ws-foot">
          재방문은 방문에서 신규를 뺀 것입니다. 광고 차단 프로그램이나 다른 기기로 오면
          신규로 다시 잡힙니다.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────── 5. 문의 · 뉴스레터 · 인재풀 ─────────────────────── */

function Submissions({ data }: { data: StatsData }) {
  const kpis = useMemo(() => buildLeadKpis(data.bundle), [data.bundle]);
  const trend = useMemo(() => buildLeadTrend(data.bundle), [data.bundle]);
  const mark = useMemo(
    () => launchMark(pickRows(data.bundle, "event", "ga4", "current")),
    [data.bundle]
  );

  return (
    <div className="ws-sec">
      <SectionHead title="문의 · 뉴스레터 · 인재풀" stamp="폼 제출 기준" />
      <div className="ws-kpis ws-kpis-3">
        {kpis.map((kpi) => (
          <div className="ws-kpi" key={kpi.id}>
            <div className="ws-lab">
              <span className="ws-lab-text">{kpi.label}</span>
            </div>
            <div className="ws-val">{kpi.value}</div>
            <div className={`ws-delta ws-${kpi.tone}`}>{kpi.delta ?? "—"}</div>
            <p className="ws-kpi-sub">{kpi.sub}</p>
          </div>
        ))}
      </div>
      <div className="ws-card ws-card-gap">
        <div className="ws-ct">제출 추이</div>
        <ChartSlot status={data.status} empty={trend.length === 0} height={170}>
          <StatsChart
            type="bar"
            data={trend}
            xKey="date"
            height={170}
            legend
            mark={mark ?? undefined}
            series={LEAD_EVENTS.map((event) => ({
              key: event.id,
              name: event.label,
              color: event.color,
              stackId: "a"
            }))}
          />
        </ChartSlot>
        <p className="ws-foot">
          세 값은 폼이 실제로 보내졌을 때 사이트가 쏘는 이벤트를 센 것입니다 —
          <code> generate_lead</code> · <code>newsletter_signup</code> ·
          <code> talent_signup</code>. 사람 수가 아니라 건수입니다. 메일이나 전화로 오는
          문의는 잡히지 않습니다.
        </p>
      </div>
    </div>
  );
}

export function BehaviorScreen({ data }: { data: StatsData }) {
  return (
    <>
      <p className="ws-note">
        앞의 화면들이 「사람을 데려오는 일」이면 이 화면은 「데려온 다음」입니다. 들어온
        사람이 무엇을 하고, 최종 목표인 문의까지 가는지를 잽니다.
      </p>
      <Funnel data={data} />
      <DwellAndDepth data={data} />
      <WhenTheyCome data={data} />
      <ExitAndReturn data={data} />
      <Submissions data={data} />
      <p className="ws-foot">
        이 화면은 GA4 값만 씁니다. 사이트 공개 전이라 아직 한 줄도 걷히지 않아 대부분이
        빈 상태입니다. 정상입니다. 구간별 분포와 요일 × 시간, 페이지 나감은 지금 리포트로
        만들 수 없어 그 자리에 이유를 적었습니다.
      </p>
    </>
  );
}
