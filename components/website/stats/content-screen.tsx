"use client";

/**
 * 콘텐츠 화면 — docs/mockups/website-stats-mockup-v2.html 의 「콘텐츠」.
 *
 * scroll · landing_channel 은 ga4.ts 에서 걷는다. 사이트 공개 전이라 아직
 * 0행이면 「아직 데이터가 없습니다」가 나온다. 정상이다.
 * 그다음 페이지 이동은 GA4 runReport 로 못 받아 산키는 두 칸만 그린다.
 */

import { useEffect, useMemo, useState } from "react";

import {
  buildEntryBubble,
  buildFill,
  buildLandingFlow,
  buildPageBars,
  buildPages,
  buildScrollDepth,
  buildTitles,
  buildTypePie,
  buildTypeTrend,
  EMPTY_TITLES,
  FILL_LABELS,
  FILL_SERIES,
  FILL_TOTAL,
  filterPages,
  PAGE_FILTERS,
  type LocaleFilter,
  type PageFilterId
} from "@/components/website/stats/content-data";
import { StatsChart } from "@/components/website/stats/stats-chart";
import { dash, intText, launchMark, pctText, pickRows } from "@/components/website/stats/stats-data";
import { StatsSankey } from "@/components/website/stats/stats-sankey";
import { ChartSlot, SectionHead, type LoadStatus, type StatsData } from "@/components/website/stats/stats-slot";
import { listInsights, listWorks } from "@/lib/website/api";
import type { InsightListItem, WorkListItem } from "@/lib/website/types";

type Catalog = { works: WorkListItem[]; insights: InsightListItem[] };

/**
 * 워크·인사이트 표. 기간과 상관없으므로 화면을 열 때 한 번만 읽는다.
 * 두 가지에 쓴다 — 경로에 제목을 붙이는 일, 「채워야 할 것」을 세는 일.
 */
function useCatalog(): { catalog: Catalog | null; status: LoadStatus } {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");

  useEffect(() => {
    let live = true;

    void Promise.all([
      listWorks({ status: "all", limit: 200 }),
      listInsights({ status: "all", limit: 200 })
    ]).then(([works, insights]) => {
      if (!live) return;
      if (!works.ok || !insights.ok) {
        setCatalog(null);
        setStatus("error");
        return;
      }
      setCatalog({ works: works.data.items, insights: insights.data.items });
      setStatus("ready");
    });

    return () => {
      live = false;
    };
  }, []);

  return { catalog, status };
}

function ByPageType({ data, pie, trend }: {
  data: StatsData;
  pie: ReturnType<typeof buildTypePie>;
  trend: ReturnType<typeof buildTypeTrend>;
}) {
  const mark = useMemo(
    () => launchMark(pickRows(data.bundle, "page", "ga4", "current")),
    [data.bundle]
  );

  return (
    <div className="ws-sec">
      <SectionHead title="페이지 종류별" stamp="어제까지" />
      <div className="ws-g2">
        <div className="ws-card">
          <div className="ws-ct">조회 비중</div>
          <ChartSlot status={data.status} empty={pie.length === 0}>
            <StatsChart type="doughnut" data={pie} legend />
          </ChartSlot>
        </div>
        <div className="ws-card">
          <div className="ws-ct">종류별 추이</div>
          <ChartSlot status={data.status} empty={trend.rows.length === 0}>
            <StatsChart
              type="line"
              data={trend.rows}
              xKey="date"
              legend
              mark={mark ?? undefined}
              series={trend.series}
            />
          </ChartSlot>
        </div>
      </div>
    </div>
  );
}

function AllPages({ data, pages }: { data: StatsData; pages: ReturnType<typeof buildPages> }) {
  const [type, setType] = useState<PageFilterId>("all");
  const [locale, setLocale] = useState<LocaleFilter>("all");

  const shown = useMemo(() => filterPages(pages, type, locale), [pages, type, locale]);
  const bars = useMemo(() => buildPageBars(shown), [shown]);

  function toggleLocale(next: "ko" | "en") {
    setLocale((current) => (current === next ? "all" : next));
  }

  return (
    <div className="ws-sec">
      <SectionHead title="모든 페이지" />
      <div className="ws-chips">
        {PAGE_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={type === item.id ? "ws-chip on" : "ws-chip"}
            aria-pressed={type === item.id}
            onClick={() => setType(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="ws-chip-gap" aria-hidden />
        <button
          type="button"
          className={locale === "ko" ? "ws-chip on" : "ws-chip"}
          aria-pressed={locale === "ko"}
          onClick={() => toggleLocale("ko")}
        >
          국문
        </button>
        <button
          type="button"
          className={locale === "en" ? "ws-chip on" : "ws-chip"}
          aria-pressed={locale === "en"}
          onClick={() => toggleLocale("en")}
        >
          영문
        </button>
      </div>

      <div className="ws-card">
        <ChartSlot status={data.status} empty={bars.rows.length === 0} height={300}>
          <StatsChart
            type="hbar"
            data={bars.rows}
            xKey="name"
            height={300}
            labelWidth={160}
            series={[{ key: "value", name: "조회", colorByPoint: bars.colors }]}
          />
        </ChartSlot>
      </div>

      <div className="ws-card ws-card-gap">
        <ChartSlot status={data.status} empty={shown.length === 0} height={120}>
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead>
                <tr>
                  <th>페이지</th>
                  <th>종류</th>
                  <th className="ws-num">조회</th>
                  <th className="ws-num">진입</th>
                  <th className="ws-num">읽은 깊이</th>
                  <th className="ws-num">이탈</th>
                  <th className="ws-num">다음</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((page) => (
                  <tr key={page.path}>
                    <td>
                      {page.title}
                      <div className="ws-t2">{page.path}</div>
                    </td>
                    <td className="ws-t2">{page.typeLabel}</td>
                    <td className="ws-num">{dash(intText(page.views))}</td>
                    <td className="ws-num">{dash(intText(page.entries))}</td>
                    {/* 읽은 깊이·다음은 걷지 않는다 — 아래 각주에 적었다 */}
                    <td className="ws-num">—</td>
                    <td className="ws-num">{dash(pctText(page.bounce))}</td>
                    <td className="ws-num">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSlot>
      </div>

      <p className="ws-foot">
        <b>진입</b> 이 페이지로 사이트를 시작한 사람 · <b>이탈</b> 진입한 사람 중 아무것도
        누르지 않고 나간 비율이라 진입이 없는 페이지는 「—」입니다.
        <br />
        <b>읽은 깊이</b>는 scroll kind 로 걷습니다. <b>다음</b>은 GA4 가 주지 않아 「—」입니다.
      </p>
    </div>
  );
}

function EntryFlow({
  data,
  flow
}: {
  data: StatsData;
  flow: ReturnType<typeof buildLandingFlow>;
}) {
  return (
    <div className="ws-sec">
      <SectionHead title="어디로 들어와 어디로 가나" />
      <p className="ws-note">
        왼쪽이 유입 경로, 오른쪽이 처음 본 페이지입니다. 굵기가 세션 수입니다.
      </p>
      <div className="ws-card">
        <ChartSlot status={data.status} empty={flow === null} height={340}>
          {flow ? <StatsSankey data={flow} height={340} /> : null}
        </ChartSlot>
      </div>
      <p className="ws-foot">
        landing_channel 로 「검색으로 들어와 어느 페이지를 처음 봤나」를 셉니다. 그다음
        페이지로 넘어간 수는 GA4 runReport 가 주지 않아 세 번째 칸은 그리지 않습니다.
      </p>
    </div>
  );
}

function DepthAndBounce({
  data,
  scroll,
  bubble
}: {
  data: StatsData;
  scroll: ReturnType<typeof buildScrollDepth>;
  bubble: ReturnType<typeof buildEntryBubble>;
}) {
  return (
    <div className="ws-sec ws-g2">
      <div className="ws-card">
        <div className="ws-ct">읽은 깊이 분포 — 어디까지 내려 읽었나</div>
        <ChartSlot status={data.status} empty={scroll.rows.length === 0}>
          <StatsChart
            type="bar"
            data={scroll.rows}
            xKey="label"
            legend
            series={scroll.series}
          />
        </ChartSlot>
      </div>
      <div className="ws-card">
        <div className="ws-ct">진입 대비 이탈 — 크기가 조회수</div>
        <p className="ws-cs">가로 진입 · 세로 이탈률(%) · 원 크기 조회</p>
        <ChartSlot status={data.status} empty={bubble.length === 0}>
          <StatsChart
            type="scatter"
            groups={bubble}
            yDomain={[0, 100]}
            sizeRange={[40, 700]}
            legend
          />
        </ChartSlot>
      </div>
    </div>
  );
}

function ToFill({ status, rows }: { status: LoadStatus; rows: ReturnType<typeof buildFill> }) {
  return (
    <div className="ws-sec">
      <SectionHead title="채워야 할 것" />
      <p className="ws-note">검색과 AI가 읽어가는 항목 중 비어 있는 것입니다.</p>
      <div className="ws-card">
        <ChartSlot
          status={status}
          empty={rows.length === 0}
          hint="워크·인사이트에 비어 있는 항목이 없습니다."
        >
          <StatsChart
            type="hbar"
            data={rows}
            xKey="name"
            max={FILL_TOTAL}
            labelWidth={160}
            legend
            series={FILL_SERIES.map((item) => ({ ...item, stackId: "fill" }))}
          />
        </ChartSlot>
      </div>
      <p className="ws-foot">
        {FILL_LABELS.join(" · ")} 네 가지를 셉니다. 통계가 아니라 워크·인사이트를 직접 읽은
        값이라 기간과 상관없습니다. 국문 한 줄 요약은 검사 항목이 없어 빠졌습니다.
      </p>
    </div>
  );
}

export function ContentScreen({ data }: { data: StatsData }) {
  const { catalog, status: catalogStatus } = useCatalog();

  const titles = useMemo(
    () => (catalog ? buildTitles(catalog.works, catalog.insights) : EMPTY_TITLES),
    [catalog]
  );
  const pages = useMemo(() => buildPages(data.bundle, titles), [data.bundle, titles]);

  const pie = useMemo(() => buildTypePie(pages), [pages]);
  const trend = useMemo(() => buildTypeTrend(data.bundle), [data.bundle]);
  const flow = useMemo(() => buildLandingFlow(data.bundle, titles), [data.bundle, titles]);
  const scroll = useMemo(() => buildScrollDepth(data.bundle), [data.bundle]);
  const bubble = useMemo(() => buildEntryBubble(pages), [pages]);
  const fill = useMemo(
    () => (catalog ? buildFill(catalog.works, catalog.insights) : []),
    [catalog]
  );

  return (
    <>
      <ByPageType data={data} pie={pie} trend={trend} />
      <AllPages data={data} pages={pages} />
      <EntryFlow data={data} flow={flow} />
      <DepthAndBounce data={data} scroll={scroll} bubble={bubble} />
      <ToFill status={catalogStatus} rows={fill} />
    </>
  );
}
