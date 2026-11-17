"use client";

/**
 * 콘텐츠 — 「무엇을 많이, 오래 보나요?」 (목업 #view-content)
 * 글별 머문 시간 · 이 글로 들어온 검색어 · 하루(시간대) 추이는 아직 모으지 않아 「준비 중」.
 */

import { Fragment, useMemo, useState } from "react";

import { axisLabel, LineChart } from "@/components/website/stats-v3/v3-chart";
import {
  contentAnswer,
  contentCards,
  contentMoves,
  contentRows,
  filterAndSort,
  pageDaySeries,
  type ContentRow,
  type KindFilter,
  type LocaleFilter,
  type MoveRow,
  type SortKey
} from "@/components/website/stats-v3/v3-content-data";
import { intKo, pctNumber } from "@/components/website/stats-v3/v3-data";
import {
  Badge,
  Change,
  Intro,
  LangBadge,
  List,
  Metric,
  PrepBadge,
  SourceLegend,
  Stack,
  StatusLine,
  Track
} from "@/components/website/stats-v3/v3-parts";
import { rangeText } from "@/components/website/stats-v3/v3-period";
import type { V3ScreenProps } from "@/components/website/stats-v3/v3-screens";
import type { StatsBundle } from "@/lib/website/stats";

/** 목업 표는 15줄. 나머지는 「모두 보기」로 편다 */
const FIRST_ROWS = 15;

const KIND_CHIPS: KindFilter[] = ["전체", "워크", "인사이트", "메뉴 페이지"];
const LOCALE_CHIPS: { id: "ko" | "en"; label: string }[] = [
  { id: "ko", label: "국문" },
  { id: "en", label: "영문" }
];

function SortHead({
  id,
  label,
  sortKey,
  ascending,
  onSort
}: {
  id: SortKey;
  label: string;
  sortKey: SortKey;
  ascending: boolean;
  onSort: (id: SortKey) => void;
}) {
  const active = sortKey === id;
  return (
    <th className="v3-num" aria-sort={active ? (ascending ? "ascending" : "descending") : undefined}>
      <button type="button" className="v3-sort" onClick={() => onSort(id)}>
        {label} {active ? (ascending ? "↑" : "↓") : "↕"}
      </button>
    </th>
  );
}

function Detail({ row, bundle, year }: { row: ContentRow; bundle: StatsBundle | null; year: number }) {
  const series = useMemo(() => pageDaySeries(bundle, row.path), [bundle, row.path]);
  const first = series.dates[0];
  const last = series.dates[series.dates.length - 1];
  const many = series.dates.length > 1;
  return (
    <tr>
      <td colSpan={8} className="v3-detail-cell">
        <div className="v3-detail-grid">
          <div>
            <h3>
              {row.title} · {many ? "날짜별 추이" : "하루 추이"} {many ? null : <PrepBadge />}
            </h3>
            <p className="v3-tiny">{first ? `${rangeText(first, last, year)} · 조회` : "조회"}</p>
            {many ? (
              <LineChart
                mini
                labels={series.dates.map(axisLabel)}
                current={series.current}
                previous={series.previous}
                ariaLabel={`${row.title} 조회 이번 기간과 앞 기간 추이`}
              />
            ) : (
              <div className="v3-chart-empty">—</div>
            )}
          </div>
          <div>
            <h3>
              이 글로 들어온 검색어 <PrepBadge />
            </h3>
            <ul className="v3-list">
              <li>
                <span>—</span>
                <span className="v3-val">—</span>
              </li>
            </ul>
            <p className="v3-tiny">검색어와 페이지를 함께 받기 시작하면 표시합니다.</p>
          </div>
        </div>
      </td>
    </tr>
  );
}

function ContentTable({ rows, bundle, year }: { rows: ContentRow[]; bundle: StatsBundle | null; year: number }) {
  const [kind, setKind] = useState<KindFilter>("전체");
  const [locale, setLocale] = useState<LocaleFilter>(null);
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [ascending, setAscending] = useState(false);
  /** undefined 면 맨 위 줄을 펼친다(목업 첫 모습). 빈 글자는 모두 접음 */
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [all, setAll] = useState(false);
  const shown = useMemo(
    () => filterAndSort(rows, kind, locale, sortKey, ascending),
    [rows, kind, locale, sortKey, ascending]
  );
  const visible = all ? shown : shown.slice(0, FIRST_ROWS);
  const open = expanded === undefined ? shown[0]?.path : expanded;
  const maxViews = Math.max(0, ...rows.map((row) => row.views ?? 0));

  function sortBy(id: SortKey) {
    if (id === sortKey) setAscending((value) => !value);
    else {
      setSortKey(id);
      setAscending(false);
    }
  }

  return (
    <>
      <div className="v3-chips">
        {KIND_CHIPS.map((item) => (
          <button
            key={item}
            type="button"
            className={kind === item ? "v3-chip active" : "v3-chip"}
            aria-pressed={kind === item}
            onClick={() => setKind(item)}
          >
            {item}
          </button>
        ))}
        <span className="v3-chip-gap" />
        {LOCALE_CHIPS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={locale === item.id ? "v3-chip active" : "v3-chip"}
            aria-pressed={locale === item.id}
            onClick={() => setLocale(locale === item.id ? null : item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="v3-card-head">
        <span className="v3-tiny">제목을 누르면 자세히 볼 수 있어요</span>
        <SourceLegend />
      </div>
      <div className="v3-table-wrap">
        <table>
          <thead>
            <tr>
              <th>순위</th>
              <th>제목</th>
              <SortHead id="views" label="조회" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th className="v3-num">
                평균 머문 시간 <PrepBadge />
              </th>
              <SortHead id="entries" label="여기로 들어온 수" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th>주로 어디서</th>
              <SortHead id="bounce" label="그냥 나간 비율" sortKey={sortKey} ascending={ascending} onSort={sortBy} />
              <th className="v3-num">증감</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={8} className="v3-tiny">
                  이 기간에는 값이 없습니다.
                </td>
              </tr>
            ) : null}
            {visible.map((row, index) => {
              const isOpen = row.path === open;
              return (
                <Fragment key={row.path}>
                  <tr className={isOpen ? "v3-selected-row" : undefined}>
                    <td className="v3-rank">{index + 1}</td>
                    <td className="v3-titlecell">
                      <button
                        type="button"
                        className="v3-title-button"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? "" : row.path)}
                      >
                        {isOpen ? "⌄" : "›"} {row.title}
                      </button>
                      <LangBadge lang={row.locale} />
                      <div className="v3-type">{row.kind}</div>
                    </td>
                    <td className="v3-num">
                      <span className="v3-bar-num">
                        <Track value={row.views ?? 0} max={maxViews} />
                        {intKo(row.views) ?? "—"}
                      </span>
                    </td>
                    <td className="v3-num">—</td>
                    <td className="v3-num">{intKo(row.entries) ?? "—"}</td>
                    <td>
                      {row.sources ? (
                        <>
                          <Stack parts={row.sources} />
                          <div className="v3-source-label">
                            검색 {row.sources[0]} · AI {row.sources[1]}
                          </div>
                        </>
                      ) : (
                        <div className="v3-source-label">—</div>
                      )}
                    </td>
                    <td className="v3-num">{row.bounce == null ? "—" : `${pctNumber(row.bounce)}%`}</td>
                    <td className="v3-num">{row.isNew ? <Badge>새 글</Badge> : <Change delta={row.delta.views} />}</td>
                  </tr>
                  {isOpen ? <Detail row={row} bundle={bundle} year={year} /> : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length > FIRST_ROWS ? (
        <p className="v3-tiny">
          <button type="button" className="v3-ghost" onClick={() => setAll((value) => !value)}>
            {all ? "15개만 보기" : `모두 보기 (${shown.length.toLocaleString("ko-KR")}개)`}
          </button>
        </p>
      ) : null}
    </>
  );
}

function Moves({ title, rows, empty }: { title: string; rows: MoveRow[]; empty: string }) {
  return (
    <div className="v3-card">
      <div className="v3-card-head">
        <h2>{title}</h2>
        <span className="v3-tiny">지난 기간 대비</span>
      </div>
      <List
        empty={empty}
        items={rows.map((row) => ({
          key: row.path,
          name: (
            <>
              {row.title} <LangBadge lang={row.locale} />
            </>
          ),
          value: null,
          change: row.delta
        }))}
      />
    </div>
  );
}

export function V3Content({ bundle, status, from, to, today, catalog }: V3ScreenProps) {
  const year = Number(today.slice(0, 4));
  const cards = useMemo(() => contentCards(bundle), [bundle]);
  const rows = useMemo(() => contentRows(bundle, catalog, from, to), [bundle, catalog, from, to]);
  const moves = useMemo(() => contentMoves(rows, bundle), [rows, bundle]);
  const answer = useMemo(() => contentAnswer(rows, bundle), [rows, bundle]);
  const compareEmpty = rows.length === 0 ? "이 기간에는 값이 없습니다." : "앞 기간과 견줄 수 있는 콘텐츠가 없습니다.";

  return (
    <>
      <Intro
        menu="콘텐츠"
        question="무엇을 많이, 오래 보나요?"
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
      <div className="v3-metrics">
        {cards.map((card) => (
          <Metric key={card.id} label={card.label} value={card.value} unit={card.unit} delta={card.delta} />
        ))}
      </div>
      <div className="v3-card">
        <div className="v3-card-head">
          <h2>많이 본 콘텐츠</h2>
          <span className="v3-tiny">숫자 제목을 누르면 순서가 바뀝니다</span>
        </div>
        {status === "ready" ? <ContentTable rows={rows} bundle={bundle} year={year} /> : <StatusLine status={status} />}
      </div>
      <div className="v3-two">
        <Moves title="오른 콘텐츠" rows={moves.up} empty={compareEmpty} />
        <Moves title="내린 콘텐츠" rows={moves.down} empty={compareEmpty} />
      </div>
    </>
  );
}
