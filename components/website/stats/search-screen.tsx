"use client";

/**
 * 검색 화면 — docs/mockups/website-stats-mockup-v2.html 의 「검색」
 *
 * apollonworks.com 하나의 데이터다. 「새 사이트」와 「옛 사이트」로 나누지
 * 않는다. 같은 도메인이고 어느 시점에 내용이 바뀌었을 뿐이다.
 * 그 시점은 추이 그래프의 세로선 하나로 알린다.
 *
 * 다만 검색어·국가·기기·페이지는 날짜가 없다. 옛 CSV 가 기간 합계로만 줘서
 * 기간으로 자를 수 없다. 그 자리에는 담은 기간을 적어 둔다.
 */

import { useMemo } from "react";

import {
  buildBrandSplit,
  buildKeywordMap,
  buildKeywordTable,
  buildLangSplit,
  buildRankSpread,
  buildSearchCountry,
  buildSearchDevice,
  buildSearchKpis,
  buildSearchTrend,
  QUERY_GROUP_COLOR,
  QUERY_GROUP_LABEL,
  RANK_COLORS,
  searchDaily,
  searchOverallPeriod
} from "@/components/website/stats/search-data";
import {
  StatsChart,
  STATS_COLORS,
  STATS_MUTED
} from "@/components/website/stats/stats-chart";
import { launchMark, periodText } from "@/components/website/stats/stats-data";
import { ChartSlot, SectionHead, type StatsData } from "@/components/website/stats/stats-slot";

/** 기간 안에 값이 없을 때 — 기간을 넓히면 나온다 */
const RANGE_HINT = "고른 기간에 값이 없습니다. 기간을 넓혀 보세요.";

/** 날짜 없는 합계를 쓰는 자리 */
const OVERALL_HINT = "아직 걷힌 검색어가 없습니다.";

function OverallStamp({ period }: { period: { from: string; to: string } | null }) {
  const text = periodText(period);
  return <span className="ws-stamp">{text ?? "기간과 무관한 합계"}</span>;
}

/** 노출·클릭·클릭률·평균 순위 + 추이 */
function Overview({ data }: { data: StatsData }) {
  const kpis = useMemo(() => buildSearchKpis(data.bundle), [data.bundle]);
  const trend = useMemo(() => buildSearchTrend(data.bundle), [data.bundle]);
  const mark = useMemo(() => launchMark(searchDaily(data.bundle)), [data.bundle]);

  return (
    <div className="ws-sec">
      <SectionHead title="구글 검색에서 얼마나 보이나" />
      <p className="ws-note">
        고른 기간의 검색 성과입니다. 변화는 그 앞 같은 길이의 기간과 견준 것입니다.
      </p>
      <div className="ws-kpis ws-kpis-4">
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
        <div className="ws-ct">노출과 클릭 — 노출만 늘고 클릭이 안 늘면 제목 문제</div>
        <ChartSlot status={data.status} empty={trend.length === 0} hint={RANGE_HINT}>
          <StatsChart
            type="combo"
            data={trend}
            xKey="date"
            legend
            leftLabel="노출"
            rightLabel="클릭"
            mark={mark ?? undefined}
            bars={[{ key: "impressions", name: "노출", color: STATS_MUTED }]}
            lines={[{ key: "clicks", name: "클릭", color: STATS_COLORS[1] }]}
          />
        </ChartSlot>
        {mark ? (
          <p className="ws-foot">
            세로선 왼쪽은 원페이지 시절, 오른쪽은 새 사이트입니다. 같은 도메인이라 성과는
            이어집니다.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 순위 분포와 색인 상태.
 *
 * 색인 상태는 아직 만들 수 없다. 서치 콘솔 URL 검사 API 로 받을 수 있지만
 * 걷는 일을 아직 하지 않았고 담을 kind 도 없다. 지어내지 않고 이유를 적어 둔다.
 */
function RankAndIndex({ data }: { data: StatsData }) {
  const spread = useMemo(() => buildRankSpread(data.bundle), [data.bundle]);
  const period = useMemo(() => searchOverallPeriod(data.bundle), [data.bundle]);

  return (
    <div className="ws-sec">
      <div className="ws-sech">
        <h3>순위 분포 · 색인 상태</h3>
        <OverallStamp period={period} />
      </div>
      <div className="ws-g2">
        <div className="ws-card">
          <div className="ws-ct">순위 분포 — 몇 위에 몇 개가 있나</div>
          <p className="ws-cs">검색어의 평균 순위를 네 칸으로 나눠 센 것입니다.</p>
          <ChartSlot status={data.status} empty={spread.length === 0} hint={OVERALL_HINT}>
            <StatsChart
              type="bar"
              data={spread}
              xKey="name"
              series={[{ key: "value", name: "검색어 수", colorByPoint: RANK_COLORS }]}
            />
          </ChartSlot>
        </div>
        <div className="ws-card">
          <div className="ws-ct">색인 상태</div>
          <p className="ws-blocked">
            아직 걷지 않아 그릴 수 없습니다. 서치 콘솔 URL 검사 API 로 페이지마다
            색인 여부를 받을 수 있지만, 이번 작업에서는 넣지 않았습니다.
          </p>
        </div>
      </div>
    </div>
  );
}

/** 검색어 지도와 표 */
function Keywords({ data }: { data: StatsData }) {
  const map = useMemo(() => buildKeywordMap(data.bundle), [data.bundle]);
  const table = useMemo(() => buildKeywordTable(data.bundle), [data.bundle]);
  const period = useMemo(() => searchOverallPeriod(data.bundle), [data.bundle]);

  return (
    <div className="ws-sec">
      <div className="ws-sech">
        <h3>검색어</h3>
        <OverallStamp period={period} />
      </div>
      <p className="ws-note">
        가로축이 평균 순위, 세로축이 노출입니다. 왼쪽 위가 좋고, 오른쪽 위가 기회입니다.
        원 크기는 클릭 수입니다.
      </p>
      <div className="ws-card">
        <ChartSlot status={data.status} empty={map.length === 0} height={300} hint={OVERALL_HINT}>
          <StatsChart type="scatter" groups={map} height={300} sizeRange={[40, 700]} legend />
        </ChartSlot>
      </div>
      <div className="ws-card ws-card-gap">
        <ChartSlot status={data.status} empty={table.length === 0} height={160} hint={OVERALL_HINT}>
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead>
                <tr>
                  <th>검색어</th>
                  <th>갈래</th>
                  <th>들어온 페이지</th>
                  <th className="ws-num">노출</th>
                  <th className="ws-num">클릭</th>
                  <th className="ws-num">클릭률</th>
                  <th className="ws-num">순위</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {table.map((row) => (
                  <tr key={row.query}>
                    <td>{row.query}</td>
                    <td>
                      <span
                        className="ws-dotmark"
                        style={{ background: QUERY_GROUP_COLOR[row.group] }}
                        aria-hidden
                      />
                      {row.groupLabel}
                    </td>
                    {/* 서치 콘솔 검색어 리포트에 페이지가 함께 오지 않는다 — 아래 각주 */}
                    <td className="ws-t2">—</td>
                    <td className="ws-num">{row.impressions}</td>
                    <td className="ws-num">{row.clicks}</td>
                    <td className="ws-num">{row.ctr}</td>
                    <td className="ws-num">{row.position}</td>
                    <td>
                      <div className="ws-tags">
                        {row.tags.map((tag) => (
                          <span key={tag.label} className={`ws-tag ws-tag-${tag.level}`}>
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSlot>
        <p className="ws-foot">
          {periodText(period)
            ? `이 표는 ${periodText(period)}입니다. 검색어에는 날짜가 없어 기간을 바꿔도 달라지지 않습니다. `
            : ""}
          「들어온 페이지」는 비워 두었습니다. 서치 콘솔 검색어 리포트는 검색어만 주고 그
          검색어로 열린 페이지를 함께 주지 않습니다.
        </p>
      </div>
    </div>
  );
}

/** 회사 이름 대 일반 — 이 화면이 답해야 할 물음 */
function BrandVsGeneric({ data }: { data: StatsData }) {
  const split = useMemo(() => buildBrandSplit(data.bundle), [data.bundle]);
  const lang = useMemo(() => buildLangSplit(data.bundle), [data.bundle]);
  const period = useMemo(() => searchOverallPeriod(data.bundle), [data.bundle]);

  return (
    <div className="ws-sec">
      <div className="ws-sech">
        <h3>누가 무엇으로 찾아왔나</h3>
        <OverallStamp period={period} />
      </div>
      <div className="ws-g2">
        <div className="ws-card">
          <div className="ws-ct">회사 이름 대 일반 검색어</div>
          <ChartSlot
            status={data.status}
            empty={split.rows.length === 0}
            height={150}
            hint={OVERALL_HINT}
          >
            <StatsChart
              type="hbar"
              data={split.rows}
              xKey="name"
              height={150}
              labelWidth={44}
              max={100}
              legend
              format={(value) => `${Math.round(value)}%`}
              series={[
                {
                  key: "brand",
                  name: QUERY_GROUP_LABEL.brand,
                  color: QUERY_GROUP_COLOR.brand,
                  stackId: "a"
                },
                {
                  key: "generic",
                  name: QUERY_GROUP_LABEL.generic,
                  color: QUERY_GROUP_COLOR.generic,
                  stackId: "a"
                }
              ]}
            />
            <div className="ws-table-wrap">
              <table className="ws-table">
                <thead>
                  <tr>
                    <th />
                    <th className="ws-num">{QUERY_GROUP_LABEL.brand}</th>
                    <th className="ws-num">{QUERY_GROUP_LABEL.generic}</th>
                  </tr>
                </thead>
                <tbody>
                  {split.counts.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="ws-num">{row.brand}</td>
                      <td className="ws-num">{row.generic}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartSlot>
          <p className="ws-foot">
            회사 이름으로 들어오는 것은 이미 아는 사람입니다. 파란색이 늘어야 새 사람이
            옵니다. 검색어에 apollon · apollo · appolon · 아폴론 · 아폴로 · immersive
            works 가 든 것을 회사 이름으로 셌습니다. 오타와 띄어쓰기도 함께 잡습니다.
            검색어에는 날짜가 없어 달별로 쌓지 못하고 합계만 보입니다.
          </p>
        </div>
        <div className="ws-card">
          <div className="ws-ct">국문 · 영문</div>
          <p className="ws-cs">들어온 페이지 경로의 /en 여부로 갈랐습니다. 노출 기준입니다.</p>
          <ChartSlot
            status={data.status}
            empty={lang.impressions.length === 0}
            height={150}
            hint={OVERALL_HINT}
          >
            <StatsChart type="doughnut" data={lang.impressions} height={150} legend />
          </ChartSlot>
          <p className="ws-foot">
            PDF 같은 문서는 경로에 /en 이 없어 국문으로 잡히면 국문 노출이 부풀어 오릅니다.
            그래서 「문서」로 따로 세었습니다. 노출의 절반 이상이 회사 소개 PDF 한 장입니다.
          </p>
        </div>
      </div>
    </div>
  );
}

/** 국가·기기. 목업의 검색 화면에는 없지만 값이 있어 넣었다 */
function WhoSearched({ data }: { data: StatsData }) {
  const country = useMemo(() => buildSearchCountry(data.bundle), [data.bundle]);
  const device = useMemo(() => buildSearchDevice(data.bundle), [data.bundle]);
  const period = useMemo(() => searchOverallPeriod(data.bundle, "country"), [data.bundle]);

  return (
    <div className="ws-sec">
      <div className="ws-sech">
        <h3>어디서 · 무엇으로 봤나</h3>
        <OverallStamp period={period} />
      </div>
      <div className="ws-g2">
        <div className="ws-card">
          <div className="ws-ct">국가 — 노출</div>
          <ChartSlot
            status={data.status}
            empty={country.length === 0}
            height={150}
            hint={OVERALL_HINT}
          >
            <StatsChart
              type="hbar"
              data={country}
              xKey="name"
              height={150}
              labelWidth={72}
              series={[{ key: "value", name: "노출", color: STATS_COLORS[0] }]}
            />
          </ChartSlot>
        </div>
        <div className="ws-card">
          <div className="ws-ct">기기 — 노출</div>
          <ChartSlot
            status={data.status}
            empty={device.length === 0}
            height={150}
            hint={OVERALL_HINT}
          >
            <StatsChart type="doughnut" data={device} height={150} legend />
          </ChartSlot>
        </div>
      </div>
    </div>
  );
}

export function SearchScreen({ data }: { data: StatsData }) {
  return (
    <>
      <p className="ws-note">
        구글 검색에서 apollonworks.com 이 얼마나 보이고 얼마나 눌리는지 봅니다. 회사 이름
        외의 검색어가 늘어야 새 사람이 옵니다.
      </p>
      <Overview data={data} />
      <RankAndIndex data={data} />
      <Keywords data={data} />
      <BrandVsGeneric data={data} />
      <WhoSearched data={data} />
      <p className="ws-foot">
        검색 값은 구글이 사흘쯤 늦게 줍니다. 노출과 클릭 추이는 날짜가 있어 기간을 따라
        움직이지만, 검색어·국가·기기·페이지는 날짜 없이 기간 합계로만 남아 있어 기간을
        바꿔도 달라지지 않습니다. 각 블록의 도장에 담은 기간을 적어 두었습니다.
      </p>
    </>
  );
}
