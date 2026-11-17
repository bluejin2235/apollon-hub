"use client";

/**
 * AI 화면 — ① 읽어 감은 bots API, ③ 사람이 옴은 ai_visits API, ② 는 준비 중.
 * ① 안내·빈 상태·카드 문구는 기획-허브통계-B5-AI.md 1·4장 문장 그대로.
 */

import { useEffect, useMemo, useState } from "react";

import {
  AI_KINDS,
  aiVisitsSummary,
  botsPeriodBeforeSince,
  buildAiCompanyBars,
  buildAiPurposeBars,
  buildAiTopContents,
  buildAiVisitBars,
  buildAiVisitPages,
  countDelta,
  readAiVisits,
  readBotsPayload,
  titlesFromCatalog
} from "@/components/website/stats/ai-data";
import { EMPTY_TITLES, type TitleMap } from "@/components/website/stats/content-data";
import { DeltaMark } from "@/components/website/stats/delta-mark";
import { StatsChart, STATS_COLORS } from "@/components/website/stats/stats-chart";
import { dash, intText } from "@/components/website/stats/stats-data";
import { ChartSlot, type LoadStatus, type StatsData } from "@/components/website/stats/stats-slot";
import { listInsights, listWorks } from "@/lib/website/api";
import type { InsightListItem, WorkListItem } from "@/lib/website/types";

export { AI_KINDS };

type Catalog = { works: WorkListItem[]; insights: InsightListItem[] };

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

const PREP_STAMP = "준비 중";

/** 기획서 1장 「안내 한 줄」 */
const READ_GUIDE = [
  "로봇 기록은 2026-11-16 부터 쌓였습니다. 그 전 날짜는 없습니다.",
  "로봇 이름으로 나눈 값입니다. 진짜 로봇인지 주소 확인은 아직 하지 않았습니다.",
  "구글 AI(Gemini · AI 개요)는 일반 구글 로봇과 구분되지 않습니다."
] as const;

function ReadSlot({ data, titles }: { data: StatsData; titles: TitleMap }) {
  const payload = useMemo(() => readBotsPayload(data.bundle), [data.bundle]);
  const beforeSince = useMemo(() => botsPeriodBeforeSince(data.bundle), [data.bundle]);
  const bars = useMemo(() => buildAiCompanyBars(payload), [payload]);
  const purposeBars = useMemo(() => buildAiPurposeBars(payload), [payload]);
  const barSum = bars.reduce((sum, row) => sum + row.value, 0);
  const purposeSum = purposeBars.reduce((sum, row) => sum + row.value, 0);
  const top = useMemo(() => buildAiTopContents(payload, titles), [payload, titles]);
  const totalDelta = countDelta(payload?.ai.total);
  const askedDelta = countDelta(payload?.ai.askedTotal);
  const failedDelta = countDelta(payload?.ai.failed, false);
  const searchTotal = payload?.searchEngines.total.current ?? 0;
  const failedCount = payload?.ai.failed.current ?? 0;
  const askedCount = payload?.ai.askedTotal.current ?? 0;
  const totalCount = payload?.ai.total.current ?? 0;

  return (
    <div className="ws-kpi ws-ai-read">
      <div className="ws-lab">
        <span className="ws-lab-text">읽어 감</span>
        {payload && payload.verified === false ? (
          <span className="ws-stamp">주소 확인 전 숫자</span>
        ) : null}
      </div>

      {data.status === "loading" ? (
        <p className="ws-kpi-sub">불러오는 중입니다</p>
      ) : data.status === "error" || !payload ? (
        <p className="ws-kpi-sub">불러오지 못했습니다</p>
      ) : beforeSince ? (
        <p className="ws-kpi-sub">로봇 기록은 2026-11-16 부터 있습니다. 기간을 바꿔 보세요.</p>
      ) : totalCount === 0 ? (
        <>
          <p className="ws-kpi-sub">이 기간에 AI 로봇이 읽어 간 기록이 없습니다.</p>
          <div className="ws-ai-guide">
            {READ_GUIDE.map((line) => (
              <p key={line} className="ws-kpi-sub">
                {line}
              </p>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="ws-ai-cards">
            <div className="ws-ai-card">
              <div className="ws-lab">AI 로봇이 읽은 횟수</div>
              <div className="ws-val">
                {dash(intText(totalCount))}
                <span className="ws-val-unit">회</span>
              </div>
              <DeltaMark
                delta={totalDelta.delta}
                tone={totalDelta.tone}
                previous={totalDelta.previous}
              />
            </div>

            <div className="ws-ai-card">
              <div className="ws-lab">누군가 물어봐서 읽어 감</div>
              <div className="ws-val ws-val-sm">
                {dash(intText(askedCount))}
                <span className="ws-val-unit">회</span>
              </div>
              <DeltaMark
                delta={askedDelta.delta}
                tone={askedDelta.tone}
                previous={askedDelta.previous}
              />
              {askedCount === 0 ? (
                <p className="ws-kpi-sub">아직 질문 때문에 온 로봇이 없습니다.</p>
              ) : null}
            </div>

            <div className="ws-ai-card">
              <div className="ws-lab">읽기 실패</div>
              <div className={`ws-val ws-val-sm${failedCount > 0 ? " ws-ai-fail" : ""}`}>
                {dash(intText(failedCount))}
                <span className="ws-val-unit">회</span>
              </div>
              <DeltaMark
                delta={failedDelta.delta}
                tone={failedDelta.tone}
                previous={failedDelta.previous}
              />
            </div>
          </div>

          <div className="ws-ai-block">
            <div className="ws-ct">회사별</div>
            <ChartSlot status={data.status} empty={barSum === 0} height={160}>
              <StatsChart
                type="hbar"
                data={bars}
                xKey="name"
                height={160}
                labelWidth={88}
                series={[
                  {
                    key: "value",
                    name: "읽어 감",
                    colorByPoint: bars.map((_, i) => STATS_COLORS[i % STATS_COLORS.length])
                  }
                ]}
              />
            </ChartSlot>
          </div>

          <div className="ws-ai-block">
            <div className="ws-ct">목적별</div>
            <ChartSlot status={data.status} empty={purposeSum === 0} height={120}>
              <StatsChart
                type="hbar"
                data={purposeBars}
                xKey="name"
                height={120}
                labelWidth={72}
                series={[
                  {
                    key: "value",
                    name: "읽어 감",
                    colorByPoint: purposeBars.map(
                      (_, i) => STATS_COLORS[i % STATS_COLORS.length]
                    )
                  }
                ]}
              />
            </ChartSlot>
          </div>

          <div className="ws-ai-block">
            <div className="ws-ct">많이 읽은 페이지</div>
            <ChartSlot status={data.status} empty={false} height={120}>
              <div className="ws-table-wrap">
                <table className="ws-table">
                  <thead>
                    <tr>
                      <th>페이지</th>
                      <th>언어</th>
                      <th className="ws-num">횟수</th>
                      <th className="ws-num">증감</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="ws-ai-llms">
                      <td>
                        {top.llms.title}
                        <div className="ws-t2">{top.llms.path}</div>
                      </td>
                      <td>{top.llms.langLabel}</td>
                      <td className="ws-num">{dash(intText(top.llms.count))}</td>
                      <td className="ws-num">
                        {top.llms.delta.delta == null ? (
                          <span className="ws-stamp">비교 불가</span>
                        ) : (
                          <span
                            className={
                              top.llms.delta.tone === "flat"
                                ? undefined
                                : `ws-${top.llms.delta.tone}`
                            }
                          >
                            {top.llms.delta.delta}
                          </span>
                        )}
                      </td>
                    </tr>
                    {top.rows.map((row) => (
                      <tr key={`${row.langLabel}-${row.path}`}>
                        <td>
                          {row.title}
                          <div className="ws-t2">{row.path}</div>
                        </td>
                        <td>{row.langLabel}</td>
                        <td className="ws-num">{intText(row.count)}</td>
                        <td className="ws-num">
                          {row.delta.delta == null ? (
                            <span className="ws-stamp">비교 불가</span>
                          ) : (
                            <span
                              className={
                                row.delta.tone === "flat" ? undefined : `ws-${row.delta.tone}`
                              }
                            >
                              {row.delta.delta}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartSlot>
          </div>

          <details className="ws-ai-search">
            <summary>검색 엔진 로봇 {dash(intText(searchTotal))}회</summary>
            <p className="ws-kpi-sub">구글 · 빙 · 네이버 등 AI가 아닌 검색 엔진 로봇입니다.</p>
          </details>

          <div className="ws-ai-guide">
            {READ_GUIDE.map((line) => (
              <p key={line} className="ws-kpi-sub">
                {line}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VisitSlot({ data, titles }: { data: StatsData; titles: TitleMap }) {
  const visits = useMemo(() => readAiVisits(data.bundle), [data.bundle]);
  const summary = useMemo(() => aiVisitsSummary(data.bundle), [data.bundle]);
  const bars = useMemo(() => buildAiVisitBars(visits), [visits]);
  const pages = useMemo(() => buildAiVisitPages(visits, titles), [visits, titles]);

  return (
    <div className="ws-kpi ws-ai-visit">
      <div className="ws-lab">
        <span className="ws-lab-text">사람이 옴</span>
      </div>

      {data.status === "loading" ? (
        <p className="ws-kpi-sub">불러오는 중입니다</p>
      ) : data.status === "error" || !visits || !summary ? (
        <p className="ws-kpi-sub">불러오지 못했습니다</p>
      ) : (
        <>
          <div className="ws-ct">AI에서 온 방문</div>
          <div className="ws-val">
            {dash(intText(summary.total))}
            <span className="ws-val-unit">회</span>
          </div>
          <DeltaMark
            delta={summary.delta.delta}
            tone={summary.delta.tone}
            previous={summary.delta.previous}
          />

          {summary.total === 0 ? (
            <p className="ws-kpi-sub">이 기간에 AI 서비스에서 들어온 방문이 없습니다.</p>
          ) : (
            <>
              <div className="ws-ai-block">
                <div className="ws-ct">AI 별</div>
                <StatsChart
                  type="hbar"
                  data={bars}
                  xKey="name"
                  height={180}
                  labelWidth={88}
                  series={[
                    {
                      key: "value",
                      name: "방문",
                      colorByPoint: bars.map((_, i) => STATS_COLORS[i % STATS_COLORS.length])
                    }
                  ]}
                />
              </div>

              <div className="ws-ai-block">
                <div className="ws-ct">들어온 페이지</div>
                <ChartSlot status={data.status} empty={pages.length === 0} height={120}>
                  <div className="ws-table-wrap">
                    <table className="ws-table">
                      <thead>
                        <tr>
                          <th>페이지</th>
                          <th>언어</th>
                          <th className="ws-num">방문</th>
                          <th className="ws-num">증감</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pages.map((row) => (
                          <tr key={`${row.langLabel}-${row.path}`}>
                            <td>
                              {row.title}
                              <div className="ws-t2">{row.path}</div>
                            </td>
                            <td>{row.langLabel}</td>
                            <td className="ws-num">{intText(row.sessions)}</td>
                            <td className="ws-num">
                              {row.delta.delta == null ? (
                                <span className="ws-stamp">비교 불가</span>
                              ) : (
                                <span
                                  className={
                                    row.delta.tone === "flat" ? undefined : `ws-${row.delta.tone}`
                                  }
                                >
                                  {row.delta.delta}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ChartSlot>
              </div>
            </>
          )}

          <p className="ws-kpi-sub">
            앱에서 온 방문과 출처를 숨긴 방문은 잡히지 않아 실제보다 적습니다.
          </p>
        </>
      )}
    </div>
  );
}

export function AiScreen({ data }: { data: StatsData }) {
  const { catalog } = useCatalog();
  const titles = useMemo(
    () => (catalog ? titlesFromCatalog(catalog.works, catalog.insights) : EMPTY_TITLES),
    [catalog]
  );

  return (
    <section className="ws-screen">
      <h2 className="ws-pt">AI 가 우리 글을 읽고, 쓰고, 사람을 보내 주나요?</h2>
      <p className="ws-lede">
        세 칸은 각각 다른 사실입니다. 많이 읽었다고 답에 쓰거나 방문으로 이어지는 것은
        아닙니다.
      </p>
      <div className="ws-kpis ws-kpis-3 ws-ai-kpis">
        <ReadSlot data={data} titles={titles} />
        <div className="ws-kpi">
          <div className="ws-lab">
            <span className="ws-lab-text">답에 씀</span>
            <span className="ws-stamp">{PREP_STAMP}</span>
          </div>
          <p className="ws-kpi-sub">매주 직접 물어본 결과를 적는 칸을 만드는 중입니다</p>
        </div>
        <VisitSlot data={data} titles={titles} />
      </div>
    </section>
  );
}
