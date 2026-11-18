"use client";

/**
 * 검색 — 「회사 이름을 모르는 사람도 구글에서 우리를 찾나요?」
 * 맨 위는 날짜별 흐름(구글 클릭 · 노출 · 회사 이름 vs 일반 명사 · 목표 키워드), 아래는 이번 기간 숫자와 목록.
 * 구글 자료는 2~3일 늦게 들어온다. 숫자가 나오는 자리마다 「○월 ○일까지」를 밝힌다.
 */

import Link from "next/link";
import { useMemo } from "react";

import { previousIsOldSite, readActualRange, readGscLastDate, readLaunchDate, SITE_LAUNCH_DATE } from "@/components/website/stats/stats-data";
import { axisLabel, LineChart, MultiLineChart } from "@/components/website/stats-v3/v3-chart";
import { titlesOf } from "@/components/website/stats-v3/v3-content-data";
import { targetKeywordsView, type KeywordChange, type TargetKeywordsView } from "@/components/website/stats-v3/v3-keywords-data";
import { Badge, Change, DeltaBlock, Intro, LangBadge, List, PrepBadge, Spark, StatusLine, TrendCard } from "@/components/website/stats-v3/v3-parts";
import { dayText, rangeText } from "@/components/website/stats-v3/v3-period";
import type { V3ScreenProps } from "@/components/website/stats-v3/v3-screens";
import {
  brandSplitDays,
  gscDaySeries,
  hiddenQueryShare,
  newQueries,
  searchAnswer,
  searchGroups,
  searchLandingTop,
  searchRange,
  targetKeywordDays,
  type SearchGroup
} from "@/components/website/stats-v3/v3-search-data";
import { trendFact } from "@/components/website/stats-v3/v3-trend";
import type { StatsBundle } from "@/lib/website/stats";

/** 클릭은 작은 수라 눈금이 0.5 로 나올 수 있다 — 반올림해 1 이 두 번 찍히지 않게 */
function countTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 「구글 검색 숫자는 2~3일 늦게 들어와요. 지금은 11월 15일까지 있어요.」 */
function lagText(bundle: StatsBundle | null, year: number): string {
  const last = readGscLastDate(bundle);
  const range = readActualRange(bundle);
  if (!last) return "구글 검색 숫자는 2~3일 늦게 들어와요.";
  if (range && last >= range.actualTo) return `구글 검색 숫자는 2~3일 늦게 들어와요. 이 기간은 ${dayText(last, year)}까지 다 들어왔어요.`;
  return `구글 검색 숫자는 2~3일 늦게 들어와요. 지금은 ${dayText(last, year)}까지 있어요.`;
}

/** 「11월 16일 · 11월 17일은 검색어 자료가 아직 없어」 — 일별 합계만 있고 검색어 행이 없는 날 */
function missingText(dates: string[], year: number): string {
  const shown = dates.slice(0, 3).map((date) => dayText(date, year)).join(" · ");
  const more = dates.length > 3 ? ` 외 ${dates.length - 3}일` : "";
  return `${shown}${more}은 검색어 자료가 아직 없어`;
}

/**
 * 「어떤 말로 찾아오나요?」 옆 글: 실제로 견준 날 수를 밝힌다.
 * 두 기간 모두 검색어 자료가 있는 날 짝만 견주므로, 이번 기간 자료가 있는 날보다 적을 수 있다.
 */
function compareText(range: NonNullable<ReturnType<typeof searchRange>>, year: number): string {
  const span = range.from === range.to ? dayText(range.from, year) : rangeText(range.from, range.to, year);
  if (!range.prevFrom || !range.prevTo) {
    return `검색어 자료가 있는 ${range.currentDays}일(${span}) · 앞 기간은 같은 자리 날에 검색어 자료가 없어 견주지 않음`;
  }
  const prevSpan = range.prevFrom === range.prevTo ? dayText(range.prevFrom, year) : rangeText(range.prevFrom, range.prevTo, year);
  const skipped = range.currentDays - range.days;
  return `두 기간 모두 검색어 자료가 있는 ${range.days}일끼리 견줌 · 이번 ${span} · 앞 기간 ${prevSpan}${
    skipped > 0 ? ` · 앞 기간 자료가 없는 ${skipped}일은 뺌` : ""
  }`;
}

function GroupNumber({ title, hint, group }: { title: string; hint: string; group: SearchGroup | null }) {
  if (!group) {
    // 검색어 행이 하나도 없으면 0번이 아니라 자료 없음
    return (
      <>
        <div className="v3-muted">{title}</div>
        <div className="v3-big-num">—</div>
        <p className="v3-metric-hint">{hint}</p>
        <p className="v3-metric-hint">검색어 자료가 아직 없어요. 0번이 아니에요.</p>
      </>
    );
  }
  return (
    <>
      <div className="v3-muted">{title}</div>
      <div className="v3-big-num">
        {group.clicks ?? "—"}
        <span> 번 눌림 · {group.impressions ?? "—"}번 보임</span>
      </div>
      <p className="v3-metric-hint">{hint}</p>
      <DeltaBlock delta={group.delta} />
    </>
  );
}

function KeywordChangeCell({ change }: { change: KeywordChange }) {
  if (change.type === "new") return <Badge>새로 잡힘</Badge>;
  if (change.type === "none") return <Badge>비교 불가</Badge>;
  if (change.type === "nopair") return <>—</>;
  return <Change delta={change.delta} />;
}

function SearchTrends({ bundle, today }: { bundle: StatsBundle | null; today: string }) {
  const year = Number(today.slice(0, 4));
  const clicks = useMemo(() => gscDaySeries(bundle, "clicks"), [bundle]);
  const impressions = useMemo(() => gscDaySeries(bundle, "impressions"), [bundle]);
  const splitImp = useMemo(() => brandSplitDays(bundle, "impressions"), [bundle]);
  const splitClk = useMemo(() => brandSplitDays(bundle, "clicks"), [bundle]);
  const target = useMemo(() => targetKeywordDays(bundle), [bundle]);
  const range = readActualRange(bundle);
  const unfair = previousIsOldSite(bundle)
    ? `앞 기간(${range ? rangeText(range.prevFrom, range.prevTo, year) : "앞 기간"})은 새 홈페이지를 열기 전이라 견줄 수 없어요.`
    : null;
  const lag = lagText(bundle, year);
  const labels = (dates: string[]) => dates.map(axisLabel);
  const prevHeads = (dates: (string | null)[]) => dates.map((date) => (date ? axisLabel(date) : null));

  const clickFact = trendFact({ name: "구글 검색에서 눌린 횟수", unit: "번", current: clicks.current, previous: clicks.previous, unfairReason: unfair });
  const impFact = trendFact({ name: "구글 검색에 보인 횟수", unit: "번", current: impressions.current, previous: impressions.previous, unfairReason: unfair });
  const genericFact = trendFact({
    name: "일반 명사 검색에 보인 횟수",
    unit: "번",
    current: splitImp.generic,
    previous: null,
    unfairReason: unfair ?? "검색어별 앞 기간 날짜 줄은 아직 그리지 않아요. 위 카드의 앞 기간 숫자를 보세요."
  });
  const genericClickFact = trendFact({
    name: "일반 명사 검색에서 눌린 횟수",
    unit: "번",
    current: splitClk.generic,
    previous: null,
    unfairReason: unfair ?? "검색어별 앞 기간 날짜 줄은 아직 그리지 않아요."
  });

  const many = clicks.dates.length > 1;
  return (
    <>
      <h2 className="v3-section-title">날짜별 흐름 · 잘 되고 있나요?</h2>
      <p className="v3-head-help">{lag}</p>
      <div className="v3-trends">
        <TrendCard title="구글 검색에서 눌린 횟수 · 날짜별" fact={clickFact}>
          {many ? (
            <LineChart
              mini
              labels={labels(clicks.dates)}
              dates={clicks.dates}
              prevDates={clicks.prevDates}
              current={clicks.current}
              previous={clicks.previous}
              prevReason={clicks.prevReasons}
              unit="번"
              format={countTick}
              ariaLabel="구글 검색 클릭 날짜별"
            />
          ) : (
            <div className="v3-chart-empty">—</div>
          )}
        </TrendCard>
        <TrendCard title="구글 검색에 보인 횟수 · 날짜별" fact={impFact}>
          {many ? (
            <LineChart
              mini
              labels={labels(impressions.dates)}
              dates={impressions.dates}
              prevDates={impressions.prevDates}
              current={impressions.current}
              previous={impressions.previous}
              prevReason={impressions.prevReasons}
              unit="번"
              format={countTick}
              ariaLabel="구글 검색 노출 날짜별"
            />
          ) : (
            <div className="v3-chart-empty">—</div>
          )}
        </TrendCard>
        <TrendCard
          title="회사 이름 vs 일반 명사 · 보인 횟수"
          fact={genericFact}
          note={`「구글이 숨긴 검색어」는 드물게 검색된 말이라 구글이 개인정보 보호로 글자를 보여 주지 않은 몫이에요.${
            splitImp.missing.length > 0 ? ` ${missingText(splitImp.missing, year)} 선을 비워 뒀어요(0이 아니에요).` : ""
          }`}
        >
          {many ? (
            <MultiLineChart
              mini
              dates={splitImp.dates}
              series={[
                { name: "회사 이름", values: splitImp.brand, previous: splitImp.prevBrand },
                { name: "일반 명사", values: splitImp.generic, previous: splitImp.prevGeneric },
                { name: "구글이 숨긴 검색어", values: splitImp.hidden, previous: splitImp.prevHidden }
              ]}
              prevTipHeads={prevHeads(splitImp.prevDates)}
              prevReason={splitImp.prevReasons}
              unit="번"
              format={countTick}
              ariaLabel="회사 이름 일반 명사 숨긴 검색어 노출 날짜별"
            />
          ) : (
            <div className="v3-chart-empty">—</div>
          )}
        </TrendCard>
        <TrendCard
          title="회사 이름 vs 일반 명사 · 눌린 횟수"
          fact={genericClickFact}
          note={splitClk.missing.length > 0 ? `${missingText(splitClk.missing, year)} 선을 비워 뒀어요(0이 아니에요).` : undefined}
        >
          {many ? (
            <MultiLineChart
              mini
              dates={splitClk.dates}
              series={[
                { name: "회사 이름", values: splitClk.brand, previous: splitClk.prevBrand },
                { name: "일반 명사", values: splitClk.generic, previous: splitClk.prevGeneric },
                { name: "구글이 숨긴 검색어", values: splitClk.hidden, previous: splitClk.prevHidden }
              ]}
              prevTipHeads={prevHeads(splitClk.prevDates)}
              prevReason={splitClk.prevReasons}
              unit="번"
              format={countTick}
              ariaLabel="회사 이름 일반 명사 숨긴 검색어 클릭 날짜별"
            />
          ) : (
            <div className="v3-chart-empty">—</div>
          )}
        </TrendCard>
        {target ? (
          <TrendCard
            title={`목표 키워드 ${target.keywords}개 · 보인 횟수`}
            fact={trendFact({
              name: "목표 키워드가 보인 횟수",
              unit: "번",
              current: target.current,
              previous: null,
              unfairReason: unfair ?? "흐름 판단은 아래 표의 증감을 보세요. 그래프 점선은 같은 자리 앞 기간 날 값이에요."
            })}
            wide
          >
            {target.dates.length > 1 ? (
              <LineChart
                mini
                two
                labels={labels(target.dates)}
                dates={target.dates}
                prevDates={target.prevDates}
                current={target.current}
                previous={target.previous}
                prevReason={target.prevReasons}
                unit="번"
                format={countTick}
                ariaLabel="목표 키워드 노출 날짜별"
              />
            ) : (
              <div className="v3-chart-empty">—</div>
            )}
          </TrendCard>
        ) : (
          <TrendCard
            title="목표 키워드 · 보인 횟수"
            fact={{
              tone: "none",
              text: "목표 키워드 숫자가 아직 0개로 나와요.",
              fair: false,
              fairText:
                "키워드 목록이 비었거나, 키워드를 넣은 날보다 앞선 기간을 빼고 세는 홈페이지 문제(고치는 중) 때문일 수 있어요."
            }}
            wide
          />
        )}
      </div>
    </>
  );
}

/** 목표 키워드 표 — 순위·노출·클릭은 홈페이지가 계산한 target_keywords, 추이·들어온 페이지는 검색어 행 */
function TargetKeywords({ view, status, lag }: { view: TargetKeywordsView; status: V3ScreenProps["status"]; lag: string }) {
  const payload = view.payload;
  const ko = view.rows.filter((row) => row.lang === "ko").length;
  const en = view.rows.length - ko;
  return (
    <div className="v3-card">
      <div className="v3-card-head">
        <div>
          <h2>목표 키워드{payload ? null : <> <PrepBadge /></>}</h2>
          <p className="v3-card-sub">
            {payload
              ? `${payload.total}개 · 국문 ${ko} · 영문 ${en} · 10위 안 ${payload.top10}개 · 아직 검색 결과에 안 보임 ${payload.not_seen}개`
              : "목표 키워드 목록을 아직 읽지 못했어요"}
          </p>
          <p className="v3-tiny">
            {lag}
            {view.compareNote ? ` · ${view.compareNote}` : ""}
          </p>
        </div>
        <Link className="v3-tiny" href="/website/stats/keywords">
          목표 키워드 설정 →
        </Link>
      </div>
      {status !== "ready" ? (
        <StatusLine status={status} />
      ) : payload && payload.total === 0 ? (
        <p className="v3-tiny">
          이 기간 목표 키워드가 0개로 나와요. 키워드 목록이 비었거나, 키워드를 넣은 날보다 앞선 기간을 빼고 세는 홈페이지
          문제(고치는 중) 때문일 수 있어요. <Link href="/website/stats/keywords">설정에서 목록 확인 →</Link>
        </p>
      ) : (
        <div className="v3-table-wrap">
          <table className="v3-target-table">
            <thead>
              <tr>
                <th>키워드</th>
                <th className="v3-num">보인 횟수</th>
                <th className="v3-num">눌린 횟수</th>
                <th className="v3-num">평균 순위</th>
                <th className="v3-num">앞 기간보다</th>
                <th>들어온 페이지{view.hasLanding ? null : <> <PrepBadge /></>}</th>
                <th>날짜별</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.length === 0 ? (
                <tr>
                  <td className="v3-keyword">—</td>
                  <td className="v3-num">—</td>
                  <td className="v3-num">—</td>
                  <td className="v3-num">—</td>
                  <td className="v3-num">—</td>
                  <td className="v3-keyword-page">—</td>
                  <td>—</td>
                </tr>
              ) : (
                view.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="v3-keyword">{row.keyword}</td>
                    <td className="v3-num">{row.impressions.toLocaleString("ko-KR")}</td>
                    <td className="v3-num">{row.clicks.toLocaleString("ko-KR")}</td>
                    <td className="v3-num">{row.position ? `${row.position}위` : "—"}</td>
                    <td className="v3-num">
                      <KeywordChangeCell change={row.change} />
                    </td>
                    <td className="v3-keyword-page">{row.landing ?? "—"}</td>
                    <td>
                      <Spark current={row.trend.current} previous={row.trend.previous} label={`${row.keyword} 날짜별 노출 추이`} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {payload && payload.total > 0 && payload.not_seen === payload.total ? (
            <p className="v3-tiny v3-target-foot">{payload.total}개 모두 아직 검색 결과에 안 보여요.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function V3Search({ bundle, status, today, catalog }: V3ScreenProps) {
  const year = Number(today.slice(0, 4));
  const groups = useMemo(() => searchGroups(bundle), [bundle]);
  const range = useMemo(() => searchRange(bundle), [bundle]);
  const hidden = useMemo(() => hiddenQueryShare(bundle), [bundle]);
  const fresh = useMemo(() => newQueries(bundle), [bundle]);
  const landings = useMemo(() => searchLandingTop(bundle, titlesOf(catalog)), [bundle, catalog]);
  const answer = useMemo(() => searchAnswer(bundle), [bundle]);
  const keywords = useMemo(() => targetKeywordsView(bundle, titlesOf(catalog)), [bundle, catalog]);
  const visitRange = readActualRange(bundle);
  const lag = lagText(bundle, year);
  const launch = readLaunchDate(bundle) ?? SITE_LAUNCH_DATE;

  return (
    <>
      <Intro
        menu="검색"
        question="회사 이름을 모르는 사람도 구글에서 우리를 찾나요?"
        answer={
          answer ? (
            <>
              <em>{answer.em}</em>
              {answer.tail}
            </>
          ) : (
            "—"
          )
        }
      />
      {status === "ready" ? <SearchTrends bundle={bundle} today={today} /> : null}
      <div className="v3-card">
        <div className="v3-card-head">
          <h2>어떤 말로 찾아오나요?</h2>
          {range ? <span className="v3-tiny">{compareText(range, year)}</span> : null}
        </div>
        <p className="v3-head-help">
          <b>보인 횟수</b>: 구글 검색 결과에 우리 사이트가 나온 횟수 · <b>눌린 횟수</b>: 그걸 보고 누른 횟수 · {lag}
        </p>
        {status !== "ready" ? (
          <StatusLine status={status} />
        ) : (
          <div className="v3-search-top">
            <div>
              <GroupNumber title="회사 이름 검색" hint="「아폴론」처럼 우리 이름으로 찾은 것" group={groups?.brand ?? null} />
            </div>
            <div className="v3-search-general">
              <GroupNumber
                title="일반 명사 검색"
                hint="「미디어아트 회사」처럼 우리 이름 없이 찾은 것 · 새 손님이 오는 길"
                group={groups?.generic ?? null}
              />
            </div>
            <div>
              <div className="v3-muted">구글이 숨긴 검색어</div>
              {hidden ? (
                <>
                  <div className="v3-big-num">
                    {(hidden.clicks - hidden.listedClicks).toLocaleString("ko-KR")}
                    <span> 번 눌림 · {(hidden.impressions - hidden.listedImpressions).toLocaleString("ko-KR")}번 보임</span>
                  </div>
                  <p className="v3-metric-hint">
                    구글 전체 {hidden.clicks.toLocaleString("ko-KR")}번 눌림 · {hidden.impressions.toLocaleString("ko-KR")}번 보임
                    가운데, 드물게 검색된 말은 구글이 개인정보 보호로 글자를 숨겨요. 그래서 회사 이름과 일반 명사를 더해도 전체보다
                    적어요.
                  </p>
                  {hidden.missing.length > 0 ? (
                    <p className="v3-metric-hint">{missingText(hidden.missing, year)} 이 칸 숫자에서 뺐어요.</p>
                  ) : null}
                </>
              ) : (
                <div className="v3-big-num">—</div>
              )}
            </div>
          </div>
        )}
      </div>
      <TargetKeywords view={keywords} status={status} lag={lag} />
      <div className="v3-two">
        <div className="v3-card">
          <div className="v3-card-head">
            <h2>새로 보인 검색어</h2>
            <span className="v3-tiny">
              목표 키워드 밖에서 처음 보인 말{fresh != null && range ? ` · 같은 자리 앞 기간 날에도 자료가 있는 ${range.days}일만 봄` : ""}
            </span>
          </div>
          {fresh == null ? (
            <p className="v3-tiny">
              <Badge>비교 불가</Badge>{" "}
              {visitRange && previousIsOldSite(bundle)
                ? `앞 기간(${rangeText(visitRange.prevFrom, visitRange.prevTo, year)})은 새 홈페이지를 열기 전${launch ? `(${dayText(launch, year)} 오픈)` : ""}이라, 이번에 처음 보인 말인지 견줄 기록이 없어요.`
                : "같은 자리 앞 기간 날에 검색어 자료가 없어 처음 보인 말인지 가릴 수 없어요."}
            </p>
          ) : (
            <List
              empty="이 기간에 새로 보인 검색어가 없어요."
              items={fresh.map((row) => ({
                key: row.query,
                name: row.query,
                value: `${row.impressions.toLocaleString("ko-KR")}번 보임 · ${row.clicks.toLocaleString("ko-KR")}번 눌림`,
                tag: <Badge>새로 보임</Badge>
              }))}
            />
          )}
        </div>
        <div className="v3-card">
          <div className="v3-card-head">
            <h2>검색으로 많이 들어온 페이지</h2>
            <span className="v3-tiny">
              {visitRange ? `${rangeText(visitRange.actualFrom, visitRange.actualTo, year)} ` : ""}방문 기준 (GA)
            </span>
          </div>
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
        </div>
      </div>
    </>
  );
}
