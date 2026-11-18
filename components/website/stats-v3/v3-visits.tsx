"use client";

/**
 * 방문 패턴 — 「언제 오고, 어떻게 돌아다니나요?」 (목업 #view-pattern)
 * 요일과 시간대 · 나간 페이지는 아직 모으지 않아 「준비 중」, 처음/다시 · 문의하기 누름은 배지 떼고 실제 값.
 */

import { useMemo } from "react";

import { titlesOf } from "@/components/website/stats-v3/v3-content-data";
import { axisLabel, LineChart } from "@/components/website/stats-v3/v3-chart";
import { durationText } from "@/components/website/stats-v3/v3-data";
import {
  DeltaBlock,
  HBars,
  Intro,
  LangBadge,
  List,
  Metric,
  PrepBadge,
  StatusLine,
  type HBarRow
} from "@/components/website/stats-v3/v3-parts";
import { rangeText } from "@/components/website/stats-v3/v3-period";
import type { V3ScreenProps } from "@/components/website/stats-v3/v3-screens";
import {
  countryBars,
  depthTrend,
  deviceBars,
  dwellTrend,
  landingTop,
  newReturningBars,
  outcomes,
  visitCards,
  visitsAnswer,
  type MiniTrend
} from "@/components/website/stats-v3/v3-visits-data";
import { readActualRange } from "@/components/website/stats/stats-data";

const HEAT_DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const HEAT_SLOTS = ["00–03시", "03–06시", "06–09시", "09–12시", "12–15시", "15–18시", "18–21시", "21–24시"];

/** 요일 7줄 × 3시간 8칸. 시간대 자료를 모으기 전이라 칸은 「—」 */
function Heat() {
  return (
    <div className="v3-card">
      <div className="v3-card-head">
        <div>
          <h2>
            요일과 시간대 <PrepBadge />
          </h2>
          <p className="v3-card-sub">각 칸은 3시간 동안의 방문 횟수 · 일주일의 시간대별 방문</p>
        </div>
      </div>
      <div className="v3-table-wrap">
        <table className="v3-heat">
          <thead>
            <tr>
              <th>요일</th>
              {HEAT_SLOTS.map((slot) => (
                <th key={slot}>{slot}</th>
              ))}
              <th>증감</th>
            </tr>
          </thead>
          <tbody>
            {HEAT_DAYS.map((day) => (
              <tr key={day}>
                <td className="v3-day">{day}</td>
                {HEAT_SLOTS.map((slot) => (
                  <td key={slot} className="v3-heat-0">
                    —
                  </td>
                ))}
                <td>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="v3-legend v3-heat-legend">
        <span>적음</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className={`v3-heat-key v3-heat-${level}`} />
        ))}
        <span>많음 · 칸 안에 실제 횟수 표시</span>
      </div>
    </div>
  );
}

function MiniStat({
  title,
  value,
  unit,
  card,
  trend,
  format
}: {
  title: string;
  value: string | null;
  unit: string;
  card: ReturnType<typeof visitCards>[number] | undefined;
  trend: MiniTrend;
  format: (value: number) => string;
}) {
  return (
    <div className="v3-mini-stat">
      <div>
        <h3>{title}</h3>
        <div className="v3-big-num">
          {value ?? "—"}
          {value != null ? <span> {unit}</span> : null}
        </div>
        {card ? <DeltaBlock delta={card.delta} as="p" /> : null}
      </div>
      {trend.dates.length > 1 ? (
        <LineChart
          mini
          labels={trend.dates.map(axisLabel)}
          current={trend.current}
          previous={trend.previous}
          format={format}
          ariaLabel={`${title} 이번 기간과 앞 기간 추이`}
        />
      ) : (
        <div className="v3-chart-empty">—</div>
      )}
    </div>
  );
}

function barsMax(rows: HBarRow[], total: number | null): number {
  return Math.max(1, total ?? 0, ...rows.map((row) => row.value ?? 0));
}

export function V3Visits({ bundle, status, today, catalog }: V3ScreenProps) {
  const year = Number(today.slice(0, 4));
  const cards = useMemo(() => visitCards(bundle), [bundle]);
  const card = (id: string) => cards.find((item) => item.id === id);
  const landings = useMemo(() => landingTop(bundle, titlesOf(catalog)), [bundle, catalog]);
  const depth = useMemo(() => depthTrend(bundle), [bundle]);
  const dwell = useMemo(() => dwellTrend(bundle), [bundle]);
  const people = useMemo(() => newReturningBars(bundle), [bundle]);
  const devices = useMemo(() => deviceBars(bundle), [bundle]);
  const countries = useMemo(() => countryBars(bundle), [bundle]);
  const results = useMemo(() => outcomes(bundle), [bundle]);
  const answer = useMemo(() => visitsAnswer(bundle), [bundle]);
  const range = readActualRange(bundle);
  const visitors = card("visitors");
  const visitorTotal = visitors?.value ? Number(visitors.value.replace(/,/g, "")) : null;
  const dwellCard = card("dwell");

  return (
    <>
      <Intro
        menu="방문 패턴"
        question="언제 오고, 어떻게 돌아다니나요?"
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
      <div className="v3-metrics">
        {cards.map((item) => (
          <Metric key={item.id} label={item.label} value={item.value} unit={item.unit} delta={item.delta} />
        ))}
      </div>
      <Heat />
      <div className="v3-card">
        <div className="v3-two">
          <div>
            <h2>들어온 페이지 상위 5개</h2>
            {status === "ready" ? (
              <List
                items={landings.map((row) => ({
                  key: row.path,
                  name: (
                    <>
                      {row.title} <LangBadge lang={row.lang} />
                    </>
                  ),
                  value: `${row.sessions.toLocaleString("ko-KR")}회`,
                  change: row.delta
                }))}
              />
            ) : (
              <StatusLine status={status} />
            )}
          </div>
          <div>
            <div className="v3-card-head">
              <h2>
                나간 페이지 상위 5개 <PrepBadge />
              </h2>
            </div>
            <p className="v3-tiny">—</p>
          </div>
        </div>
        <div className="v3-mini-stats">
          <MiniStat
            title="한 번에 본 페이지 수"
            value={card("depth")?.value ?? null}
            unit="개"
            card={card("depth")}
            trend={depth}
            format={(v) => v.toFixed(1)}
          />
          <MiniStat
            title="평균 머문 시간"
            value={dwellCard?.value ?? null}
            unit={dwellCard?.unit ?? "초"}
            card={dwellCard}
            trend={dwell}
            format={(v) => durationText(v) ?? ""}
          />
        </div>
      </div>
      <div className="v3-card">
        <div className="v3-card-head">
          <h2>어떤 사람이 오나요?</h2>
          <span className="v3-tiny">
            {range ? `${rangeText(range.actualFrom, range.actualTo, year)} · ` : ""}방문자 기준
          </span>
        </div>
        <div className="v3-patterns">
          <div>
            <h3>처음 / 다시</h3>
            {people ? <HBars rows={people} max={barsMax(people, visitorTotal)} /> : <p className="v3-tiny">—</p>}
          </div>
          <div>
            <h3>기기</h3>
            <HBars rows={devices} max={barsMax(devices, visitorTotal)} />
          </div>
          <div>
            <h3>나라</h3>
            <HBars rows={countries} max={barsMax(countries, visitorTotal)} />
          </div>
        </div>
      </div>
      <div className="v3-card">
        <div className="v3-card-head">
          <h2>성과</h2>
          <span className="v3-tiny">각각 별도로 센 횟수 · 서로 이어지는 단계가 아닙니다</span>
        </div>
        <div className="v3-conversion">
          {results.map((item) => (
            <div key={item.id}>
              <h3>{item.title}</h3>
              <p className="v3-tiny">{item.sub}</p>
              <div className="v3-big-num">
                {item.value == null ? "—" : item.value.toLocaleString("ko-KR")}
                {item.value != null ? <span> {item.unit}</span> : null}
              </div>
              <DeltaBlock delta={item.delta} as="p" />
              {item.note ? <p className="v3-tiny">{item.note}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
