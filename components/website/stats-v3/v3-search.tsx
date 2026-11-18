"use client";

/**
 * 검색 — 「회사 이름을 모르는 사람도 찾아오나요?」 (목업 #view-search)
 * 목표 키워드 표는 target_keywords(3-8), 들어온 페이지는 query_page(3-5). 자료가 오기 전 응답이면 「준비 중」.
 */

import { useMemo } from "react";

import { readActualRange } from "@/components/website/stats/stats-data";
import { axisLabel, LineChart } from "@/components/website/stats-v3/v3-chart";
import { titlesOf } from "@/components/website/stats-v3/v3-content-data";
import { targetKeywordsView, type KeywordChange, type TargetKeywordsView } from "@/components/website/stats-v3/v3-keywords-data";
import { Change, DeltaBlock, Intro, LangBadge, List, PrepBadge, Spark, StatusLine, Badge } from "@/components/website/stats-v3/v3-parts";
import { rangeText } from "@/components/website/stats-v3/v3-period";
import type { V3ScreenProps } from "@/components/website/stats-v3/v3-screens";
import {
  genericClickSeries,
  newQueries,
  searchAnswer,
  searchGroups,
  searchLandingTop,
  searchRange,
  type SearchGroup
} from "@/components/website/stats-v3/v3-search-data";

/** 클릭은 작은 수라 눈금이 0.5 로 나올 수 있다 — 반올림해 1 이 두 번 찍히지 않게 */
function countTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function GroupNumber({ title, group }: { title: string; group: SearchGroup | null }) {
  return (
    <>
      <div className="v3-muted">{title}</div>
      <div className="v3-big-num">
        {group?.clicks ?? "—"}
        <span> 클릭 · {group?.impressions ?? "—"}회 노출</span>
      </div>
      {group ? <DeltaBlock delta={group.delta} /> : null}
    </>
  );
}

function KeywordChangeCell({ change }: { change: KeywordChange }) {
  if (change.type === "new") return <Badge>새로 잡힘</Badge>;
  if (change.type === "none") return <Badge>비교 불가</Badge>;
  return <Change delta={change.delta} />;
}

/** 목업과 같은 열. 순위·노출·클릭은 홈페이지가 계산한 target_keywords, 추이·들어온 페이지는 검색어 행 */
function TargetKeywords({ view, status }: { view: TargetKeywordsView; status: V3ScreenProps["status"] }) {
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
              ? `${payload.total}개 · 국문 ${ko} · 영문 ${en} · 10위 안 ${payload.top10}개 · 아직 안 보임 ${payload.not_seen}개`
              : "목표 키워드 목록을 아직 읽지 못했습니다"}
          </p>
        </div>
        <a className="v3-tiny" href="/website/stats/keywords">
          목표 키워드 설정 →
        </a>
      </div>
      {status !== "ready" ? (
        <StatusLine status={status} />
      ) : payload && payload.total === 0 ? (
        <p className="v3-tiny">
          목표 키워드가 아직 없습니다. <a href="/website/stats/keywords">설정에서 넣어 주세요 →</a>
        </p>
      ) : (
        <div className="v3-table-wrap">
          <table className="v3-target-table">
            <thead>
              <tr>
                <th>키워드</th>
                <th className="v3-num">노출</th>
                <th className="v3-num">클릭</th>
                <th className="v3-num">평균 순위</th>
                <th className="v3-num">증감</th>
                <th>들어온 페이지{view.hasLanding ? null : <> <PrepBadge /></>}</th>
                <th>추이</th>
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
                      <Spark
                        current={row.trend.current}
                        previous={row.trend.previous}
                        label={`${row.keyword} 날짜별 노출 추이`}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {payload && payload.total > 0 && payload.not_seen === payload.total ? (
            <p className="v3-tiny v3-target-foot">{payload.total}개 모두 아직 검색 결과에 안 보입니다.</p>
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
  const series = useMemo(() => genericClickSeries(bundle), [bundle]);
  const fresh = useMemo(() => newQueries(bundle), [bundle]);
  const landings = useMemo(() => searchLandingTop(bundle, titlesOf(catalog)), [bundle, catalog]);
  const answer = useMemo(() => searchAnswer(bundle), [bundle]);
  const keywords = useMemo(() => targetKeywordsView(bundle, titlesOf(catalog)), [bundle, catalog]);
  const visitRange = readActualRange(bundle);

  return (
    <>
      <Intro
        menu="검색"
        question="회사 이름을 모르는 사람도 찾아오나요?"
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
      <div className="v3-card">
        <div className="v3-card-head">
          <h2>어떤 말로 찾아오나요?</h2>
          {range ? (
            <span className="v3-tiny">
              {rangeText(range.from, range.to, year)} · 앞 기간 {rangeText(range.prevFrom, range.prevTo, year)}
            </span>
          ) : null}
        </div>
        {status !== "ready" ? (
          <StatusLine status={status} />
        ) : (
          <div className="v3-search-top">
            <div>
              <GroupNumber title="회사 이름 검색" group={groups?.brand ?? null} />
            </div>
            <div className="v3-search-general">
              <GroupNumber title="일반 명사 검색" group={groups?.generic ?? null} />
            </div>
            <div>
              <p className="v3-tiny">일반 명사 검색 클릭 추이</p>
              {series.dates.length > 1 ? (
                <LineChart
                  mini
                  two
                  labels={series.dates.map(axisLabel)}
                  current={series.current}
                  previous={series.previous}
                  format={countTick}
                  ariaLabel="일반 명사 검색 클릭 이번 기간과 앞 기간 추이"
                />
              ) : (
                <div className="v3-chart-empty">—</div>
              )}
            </div>
          </div>
        )}
      </div>
      <TargetKeywords view={keywords} status={status} />
      <div className="v3-two">
        <div className="v3-card">
          <div className="v3-card-head">
            <h2>새로 잡힌 검색어</h2>
            <span className="v3-tiny">목표 밖에서 발견한 말</span>
          </div>
          {fresh == null ? (
            <p className="v3-tiny">
              <Badge>비교 불가</Badge> 앞 기간 검색어 기록이 없어 새로 잡힌 말을 가릴 수 없습니다.
            </p>
          ) : (
            <List
              empty="이 기간에 새로 잡힌 검색어가 없습니다."
              items={fresh.map((row) => ({
                key: row.query,
                name: row.query,
                value: `${row.impressions.toLocaleString("ko-KR")}회 노출 · ${row.clicks.toLocaleString("ko-KR")}회 클릭`,
                tag: <Badge>새로 잡힘</Badge>
              }))}
            />
          )}
        </div>
        <div className="v3-card">
          <div className="v3-card-head">
            <h2>검색으로 많이 들어온 콘텐츠</h2>
            <span className="v3-tiny">
              {visitRange ? `${rangeText(visitRange.actualFrom, visitRange.actualTo, year)} ` : ""}방문 기준
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
