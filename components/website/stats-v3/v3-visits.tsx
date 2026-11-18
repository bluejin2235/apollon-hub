"use client";

/**
 * 방문 패턴 — 「언제 오고, 어떻게 돌아다니나요?」 (목업 #view-pattern)
 * 요일과 시간대는 hourly(자료가 오기 전 응답이면 「준비 중」), 나간 페이지는 BigQuery 전이라 「준비 중」, 처음/다시 · 문의하기 누름은 실제 값.
 */

import { useMemo } from "react";

import { titlesOf } from "@/components/website/stats-v3/v3-content-data";
import { axisLabel, LineChart } from "@/components/website/stats-v3/v3-chart";
import { durationText, prevDatesOf } from "@/components/website/stats-v3/v3-data";
import {
  Change,
  DeltaBlock,
  HBars,
  Intro,
  LangBadge,
  Metric,
  PrepBadge,
  EmptyText,
  NotComparable,
  SourceLegend,
  Stack,
  StatusLine,
  useSourceState,
  type HBarRow
} from "@/components/website/stats-v3/v3-parts";
import { dayText, rangeText } from "@/components/website/stats-v3/v3-period";
import type { V3ScreenProps } from "@/components/website/stats-v3/v3-screens";
import {
  countryBars,
  depthTrend,
  deviceBars,
  dwellTrend,
  entryRows,
  exitRows,
  newReturningBars,
  PAGE_EXIT_SINCE,
  outcomes,
  visitCards,
  visitsAnswer,
  type MiniTrend
} from "@/components/website/stats-v3/v3-visits-data";
import { makeCountDelta, previousIsOldSite, readActualRange } from "@/components/website/stats/stats-data";
import { hourGrid, peakCell } from "@/components/website/stats-v3/v3-fill-data";

const HEAT_DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const HEAT_SLOTS = ["00–03시", "03–06시", "06–09시", "09–12시", "12–15시", "15–18시", "18–21시", "21–24시"];

/** 0~4 단계. 0 은 방문 없음 */
function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

/** 요일 7줄 × 3시간 8칸 (hourly). 자료가 오기 전 응답이면 칸은 「—」 */
function Heat({ bundle }: { bundle: V3ScreenProps["bundle"] }) {
  const grid = useMemo(() => hourGrid(bundle), [bundle]);
  const prevGrid = useMemo(() => (previousIsOldSite(bundle) ? null : hourGrid(bundle, "previous")), [bundle]);
  const peak = grid ? peakCell(grid) : null;
  const state = useSourceState();
  if (state !== "ready") {
    // 본 응답이 오기 전 · 실패면 「준비 중」 빈 표 대신 상태만
    return (
      <div className="v3-card">
        <div className="v3-card-head">
          <h2>요일과 시간대</h2>
        </div>
        <StatusLine status={state} />
      </div>
    );
  }
  if (grid) {
    return (
      <div className="v3-card">
        <div className="v3-card-head">
          <div>
            <h2>요일과 시간대</h2>
            <p className="v3-card-sub">
              각 칸은 3시간 동안의 방문자 수 · 서울 시각{peak ? ` · 가장 많은 때 ${peak}` : ""}
            </p>
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
              {HEAT_DAYS.map((day, d) => {
                const dayTotal = grid.cells[d].reduce((a, b) => a + b, 0);
                const prevTotal = prevGrid ? prevGrid.cells[d].reduce((a, b) => a + b, 0) : null;
                return (
                  <tr key={day}>
                    <td className="v3-day">{day}</td>
                    {HEAT_SLOTS.map((slot, b) => {
                      const value = grid.cells[d][b];
                      return (
                        <td key={slot} className={`v3-heat-${heatLevel(value, grid.max)}`}>
                          {value > 0 ? value.toLocaleString("ko-KR") : "·"}
                        </td>
                      );
                    })}
                    <td>
                      {prevTotal == null ? (
                        <NotComparable />
                      ) : (
                        <Change delta={makeCountDelta(dayTotal, prevTotal, true, `${prevTotal}명`)} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="v3-legend v3-heat-legend">
          <span>적음</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={`v3-heat-key v3-heat-${level}`} />
          ))}
          <span>많음 · 칸 안에 실제 방문자 수 표시</span>
        </div>
      </div>
    );
  }
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
  format,
  tipFormat,
  tipUnit,
  bundle
}: {
  title: string;
  value: string | null;
  unit: string;
  card: ReturnType<typeof visitCards>[number] | undefined;
  trend: MiniTrend;
  format: (value: number) => string;
  tipFormat?: (value: number) => string;
  tipUnit?: string;
  bundle: V3ScreenProps["bundle"];
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
          dates={trend.dates}
          prevDates={prevDatesOf(bundle, trend.dates)}
          current={trend.current}
          previous={trend.previous}
          format={format}
          tipFormat={tipFormat}
          unit={tipUnit}
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

export function V3Visits({ bundle, status, fresh, today, catalog }: V3ScreenProps) {
  const year = Number(today.slice(0, 4));
  const cards = useMemo(() => visitCards(bundle), [bundle]);
  const card = (id: string) => cards.find((item) => item.id === id);
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
        question="어디로 들어와서, 어떻게 돌아다니고, 어디로 나가나요?"
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
      <Flow bundle={bundle} status={status} catalog={catalog} today={today} />
      <div className="v3-metrics">
        {cards.map((item) => (
          <Metric
            key={item.id}
            label={item.label}
            value={item.value}
            unit={item.unit}
            delta={item.delta}
            hint={fresh ? (item.hint ?? undefined) : undefined}
          />
        ))}
      </div>
      <Heat bundle={bundle} />
      <div className="v3-card">
        <h2>한 번 와서 얼마나 보나요?</h2>
        <div className="v3-mini-stats">
          <MiniStat
            title="한 번에 본 페이지 수"
            value={card("depth")?.value ?? null}
            unit="개"
            card={card("depth")}
            trend={depth}
            format={(v) => v.toFixed(1)}
            tipFormat={(v) => `${v.toFixed(1)}개`}
            bundle={bundle}
          />
          <MiniStat
            title="평균 머문 시간"
            value={dwellCard?.value ?? null}
            unit={dwellCard?.unit ?? "초"}
            card={dwellCard}
            trend={dwell}
            format={(v) => durationText(v) ?? ""}
            tipFormat={(v) => durationText(v) ?? ""}
            bundle={bundle}
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

/** 맨 위 — 어디로 들어와서 어디로 나갔나. 들어온 곳은 GA 첫 페이지, 나간 곳은 우리 코드로 모으는 page_exit */
function Flow({ bundle, status, catalog, today }: Pick<V3ScreenProps, "bundle" | "status" | "catalog" | "today">) {
  const year = Number(today.slice(0, 4));
  const entries = useMemo(() => entryRows(bundle, titlesOf(catalog)), [bundle, catalog]);
  const exits = useMemo(() => exitRows(bundle, titlesOf(catalog)), [bundle, catalog]);
  const range = readActualRange(bundle);
  const exitStartsLate = range ? range.actualFrom < PAGE_EXIT_SINCE : true;
  return (
    <div className="v3-card">
      <div className="v3-card-head">
        <h2>어디로 들어와서 어디로 나갔나</h2>
        {range ? <span className="v3-tiny">{rangeText(range.actualFrom, range.actualTo, year)}</span> : null}
      </div>
      {status !== "ready" ? (
        <StatusLine status={status} />
      ) : (
        <div className="v3-flow">
          <div>
            <h3>처음 들어온 페이지</h3>
            <p className="v3-tiny">
              방문이 시작된 페이지 · 전체 {entries.total.toLocaleString("ko-KR")}회 중 몫 · 막대는 어디서 왔는지
            </p>
            {entries.rows.length === 0 ? (
              <EmptyText>이 기간에는 값이 없어요.</EmptyText>
            ) : (
              entries.rows.map((row) => (
                <div className="v3-flow-row" key={row.path}>
                  <span>
                    {row.title} <LangBadge lang={row.lang} />
                    <small>
                      {row.sources
                        ? `검색 ${row.sources[0]}% · AI ${row.sources[1]}% · 직접 ${row.sources[2]}% · 기타 ${row.sources[3]}%`
                        : "어디서 왔는지 기록 없음"}
                    </small>
                  </span>
                  {row.sources ? <Stack parts={row.sources} /> : <span />}
                  <b>
                    {row.sessions.toLocaleString("ko-KR")}회<small>{row.share}%</small>
                  </b>
                </div>
              ))
            )}
            <SourceLegend />
            {entries.unknown > 0 ? (
              <p className="v3-tiny">GA가 첫 페이지를 남기지 못한 방문 {entries.unknown.toLocaleString("ko-KR")}회는 목록에서 뺐어요.</p>
            ) : null}
          </div>
          <div>
            <h3>마지막으로 보고 나간 페이지</h3>
            {exits.rows.length === 0 ? (
              <div className="v3-empty-slot">
                <strong>나간 페이지는 {dayText(PAGE_EXIT_SINCE, year)}부터 모읍니다</strong>
                <p className="v3-tiny">
                  방문자가 사이트를 떠날 때 마지막으로 본 페이지를 우리 코드로 기록해요. 그 앞 기간은 기록이 없어 비어
                  있어요(0이 아니에요). 어림한 숫자는 넣지 않아요.
                </p>
              </div>
            ) : (
              <>
                <p className="v3-tiny">방문이 끝난 페이지 · 전체 {exits.total.toLocaleString("ko-KR")}회 중 몫</p>
                {exits.comparable ? null : (
                  <p className="v3-tiny">
                    <NotComparable /> · 나간 페이지는 {dayText(PAGE_EXIT_SINCE, year)}부터 모음
                  </p>
                )}
                {exits.rows.map((row) => (
                  <div className="v3-flow-row" key={row.path}>
                    <span>
                      {row.title} <LangBadge lang={row.lang} />
                    </span>
                    {exits.comparable ? <Change delta={row.delta} /> : <span />}
                    <b>
                      {row.exits.toLocaleString("ko-KR")}회<small>{row.share}%</small>
                    </b>
                  </div>
                ))}
                {exitStartsLate ? (
                  <p className="v3-tiny">{dayText(PAGE_EXIT_SINCE, year)} 앞 날짜는 기록이 없어 빠져 있어요.</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
