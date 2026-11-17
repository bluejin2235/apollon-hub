"use client";

/**
 * 검색 — 「회사 이름을 모르는 사람도 찾아오나요?」 (목업 #view-search)
 * 목표 키워드 표 · 들어온 페이지(검색어×페이지)는 아직 모으지 않아 「준비 중」.
 */

import { useMemo } from "react";

import { shortDate } from "@/components/website/stats/stats-data";
import { LineChart } from "@/components/website/stats-v3/v3-chart";
import { titlesOf } from "@/components/website/stats-v3/v3-content-data";
import { DeltaBlock, Intro, LangBadge, List, PrepBadge, StatusLine, Badge } from "@/components/website/stats-v3/v3-parts";
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

/** 목업과 같은 열. 목록(3-8)이 정해지기 전이라 한 줄을 「—」로 둔다 */
function TargetKeywords() {
  return (
    <div className="v3-card">
      <div className="v3-card-head">
        <div>
          <h2>
            목표 키워드 <PrepBadge />
          </h2>
          <p className="v3-card-sub">먼저 지켜볼 12개 · 실제 목록은 20~30개로 정합니다</p>
        </div>
      </div>
      <div className="v3-table-wrap">
        <table className="v3-target-table">
          <thead>
            <tr>
              <th>키워드</th>
              <th className="v3-num">노출</th>
              <th className="v3-num">클릭</th>
              <th className="v3-num">평균 순위</th>
              <th className="v3-num">증감</th>
              <th>
                들어온 페이지 <PrepBadge />
              </th>
              <th>추이</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="v3-keyword">—</td>
              <td className="v3-num">—</td>
              <td className="v3-num">—</td>
              <td className="v3-num">—</td>
              <td className="v3-num">—</td>
              <td className="v3-keyword-page">—</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
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
                  labels={series.dates.map(shortDate)}
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
      <TargetKeywords />
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
            <span className="v3-tiny">방문 기준</span>
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
