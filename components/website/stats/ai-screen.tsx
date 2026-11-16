"use client";

/**
 * AI 화면 — ① 읽어 감은 bots API, ②·③ 은 준비 중.
 */

import { useEffect, useMemo, useState } from "react";

import {
  AI_KINDS,
  buildAiCompanyBars,
  buildAiTopContents,
  countDelta,
  readBotsPayload,
  titlesFromCatalog
} from "@/components/website/stats/ai-data";
import { EMPTY_TITLES } from "@/components/website/stats/content-data";
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

function ReadSlot({ data }: { data: StatsData }) {
  const { catalog } = useCatalog();
  const payload = useMemo(() => readBotsPayload(data.bundle), [data.bundle]);
  const titles = useMemo(
    () =>
      catalog ? titlesFromCatalog(catalog.works, catalog.insights) : EMPTY_TITLES,
    [catalog]
  );
  const bars = useMemo(() => buildAiCompanyBars(payload), [payload]);
  const barSum = bars.reduce((sum, row) => sum + row.value, 0);
  const top = useMemo(() => buildAiTopContents(payload, titles), [payload, titles]);
  const totalDelta = countDelta(payload?.ai.total);
  const askedDelta = countDelta(payload?.ai.askedTotal);
  const searchTotal = payload?.searchEngines.total.current ?? 0;
  const sinceText = payload?.since
    ? (() => {
        const [, m, d] = payload.since.split("-");
        return `${Number(m)}월 ${Number(d)}일`;
      })()
    : "11월 16일";

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
      ) : (
        <>
          <div className="ws-val">
            {dash(intText(payload.ai.total.current))}
            <span className="ws-val-unit">회</span>
          </div>
          <DeltaMark
            delta={totalDelta.delta}
            tone={totalDelta.tone}
            previous={totalDelta.previous}
          />

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
            <div className="ws-lab">누군가 물어봐서 그 자리에서 읽어 간 횟수</div>
            <div className="ws-val ws-val-sm">
              {dash(intText(payload.ai.askedTotal.current))}
              <span className="ws-val-unit">회</span>
            </div>
            <DeltaMark
              delta={askedDelta.delta}
              tone={askedDelta.tone}
              previous={askedDelta.previous}
            />
          </div>

          <div className="ws-ai-block">
            <div className="ws-ct">많이 읽어 간 콘텐츠</div>
            <ChartSlot status={data.status} empty={top.length === 0} height={120}>
              <div className="ws-table-wrap">
                <table className="ws-table">
                  <thead>
                    <tr>
                      <th>콘텐츠</th>
                      <th>언어</th>
                      <th className="ws-num">횟수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((row) => (
                      <tr key={row.path}>
                        <td>
                          {row.title}
                          <div className="ws-t2">{row.path}</div>
                        </td>
                        <td>{row.langLabel}</td>
                        <td className="ws-num">{intText(row.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartSlot>
          </div>

          <p className="ws-foot">
            검색엔진 로봇(구글·빙·네이버) {dash(intText(searchTotal))}회
          </p>
          <p className="ws-kpi-sub">
            질문의 내용은 알 수 없습니다. 구글은 일반 검색 로봇과 AI 용 읽기를 구분할 수
            없습니다. {sinceText}부터 기록합니다.
          </p>
        </>
      )}
    </div>
  );
}

export function AiScreen({ data }: { data: StatsData }) {
  return (
    <section className="ws-screen">
      <h2 className="ws-pt">AI 가 우리 글을 읽고, 쓰고, 사람을 보내 주나요?</h2>
      <p className="ws-lede">
        세 칸은 각각 다른 사실입니다. 많이 읽었다고 답에 쓰거나 방문으로 이어지는 것은
        아닙니다.
      </p>
      <div className="ws-kpis ws-kpis-3 ws-ai-kpis">
        <ReadSlot data={data} />
        <div className="ws-kpi">
          <div className="ws-lab">
            <span className="ws-lab-text">답에 씀</span>
            <span className="ws-stamp">{PREP_STAMP}</span>
          </div>
          <p className="ws-kpi-sub">
            준비 중 — 정해 둔 질문을 AI 에 직접 물어보는 기능은 결정 대기입니다
          </p>
        </div>
        <div className="ws-kpi">
          <div className="ws-lab">
            <span className="ws-lab-text">사람이 옴</span>
            <span className="ws-stamp">{PREP_STAMP}</span>
          </div>
          <p className="ws-kpi-sub">
            준비 중 — AI 답변을 따라 온 방문은 다음 단계에서 붙습니다
          </p>
        </div>
      </div>
    </section>
  );
}
