"use client";

/**
 * 요약 화면 — docs/website-mockups/hub-stats-v3 의 「요약」.
 *
 * 카드 다섯 칸 중 셋(방문자 · 일반 명사 검색 클릭 · 검색→글 진입 비율)은
 * website_stats 로 채운다. AI 방문·문의하기 누름·조치 기록은 모으는 기록이
 * 아직 없어 「준비 중」 한 줄만 둔다. 지어낸 숫자는 넣지 않는다.
 */

import { useEffect, useId, useMemo, useState } from "react";

import { DeltaMark } from "@/components/website/stats/delta-mark";
import {
  MetricHintButton,
  MetricHintPanel,
  type MetricHint
} from "@/components/website/stats/metric-hint";
import { StatsChart, STATS_COLORS, STATS_TEXT } from "@/components/website/stats/stats-chart";
import { SUMMARY_CARD_LABEL, type SummaryCardId } from "@/components/website/stats/stats-labels";
import { ChartSlot, SectionHead, type StatsData } from "@/components/website/stats/stats-slot";
import {
  TODO_LEVEL_LABEL,
  loadSummaryBrief
} from "@/components/website/stats/summary-brief-cache";
import {
  buildSummaryBriefFacts,
  buildSummaryCards,
  buildTrend,
  summaryBriefFingerprint
} from "@/components/website/stats/summary-data";
import type { StatsBriefResult } from "@/lib/website/api";

/** 카드 물음표를 누르면 뜨는 설명. summary 는 카드 안 한 줄이다 */
const CARD_HINTS: Record<"visit" | "genericClick" | "searchToArticle", MetricHint> = {
  visit: {
    id: "visit",
    title: SUMMARY_CARD_LABEL.visit.label,
    summary: "고른 기간에 온 사람 수 · 여러 번 와도 한 명",
    definition:
      "고른 기간 전체를 한 번 센 방문자입니다. 같은 사람이 여러 날에 와도 한 명입니다.",
    criterion: "늘어나는지가 중요합니다. 하루 차이보다 7일·30일로 보세요.",
    action: "줄었다면 검색 화면에서 노출과 순위를 먼저 보세요.",
    limit: "광고 차단 프로그램을 쓰는 방문은 빠집니다."
  },
  genericClick: {
    id: "genericClick",
    title: SUMMARY_CARD_LABEL.genericClick.label,
    summary: "회사 이름이 아닌 검색어로 누른 횟수",
    definition:
      "구글 검색에서 회사 이름이 들어가지 않은 검색어로 우리 페이지를 누른 횟수입니다. 우리를 모르던 사람이 찾아오는지 봅니다.",
    criterion: "이 숫자가 늘어야 새 사람이 옵니다.",
    action: "검색 화면에서 노출은 많은데 클릭이 적은 일반 검색어의 제목과 설명을 다듬으세요.",
    limit:
      "구글은 3일 늦게 주고, 일부 검색어는 가려서 주지 않습니다. 그래서 「어제」는 대개 비어 있습니다."
  },
  searchToArticle: {
    id: "searchToArticle",
    title: SUMMARY_CARD_LABEL.searchToArticle.label,
    summary: "검색 방문 중 워크·인사이트 글에서 시작한 비율",
    definition:
      "검색엔진으로 들어온 방문 중 첫 페이지가 워크·인사이트 글인 비율입니다. 홈이 아니라 글로 바로 오면 글이 검색에 걸린다는 뜻입니다.",
    criterion: "오를수록 좋습니다. 검색 방문이 몇 번 안 될 때는 한 번에도 크게 움직입니다.",
    action: "낮다면 많이 찾는 주제의 글 제목과 첫 문단을 손보세요.",
    limit: "구글·네이버 같은 검색엔진을 함께 셉니다. 첫 페이지를 알 수 없는 방문은 빼고 셉니다."
  }
};

/** 모으는 기록이 아직 없는 두 칸 */
const PREP_CARDS: { id: SummaryCardId; line: string }[] = [
  { id: "ai", line: "AI 답변을 따라 온 방문을 정확히 가려 세는 기록을 준비하고 있습니다." },
  { id: "inquiryClick", line: "Let's Talk 의 문의하기 버튼을 누른 횟수를 세는 기록을 준비하고 있습니다." }
];

const PREP_STAMP = "준비 중";

/* ─────────────────────── 카드 다섯 칸 ─────────────────────── */

function SummaryCards({ data }: { data: StatsData }) {
  const panelId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const cards = useMemo(() => buildSummaryCards(data.bundle), [data.bundle]);
  const open = openId ? CARD_HINTS[openId as keyof typeof CARD_HINTS] : null;

  return (
    <div className="ws-sec">
      <div className="ws-kpis">
        {cards.map((card) => {
          const hint = CARD_HINTS[card.id as keyof typeof CARD_HINTS];
          const label = SUMMARY_CARD_LABEL[card.id];
          const summedNote =
            card.id === "visit" && card.periodUsers === false
              ? "날짜별 방문자를 더한 값 · 여러 날 온 사람은 여러 번 셉니다"
              : null;
          return (
            <div className="ws-kpi" key={card.id}>
              <div className="ws-lab">
                <span className="ws-lab-text">{label.label}</span>
                <MetricHintButton
                  hint={hint}
                  open={openId === card.id}
                  panelId={panelId}
                  onToggle={() => setOpenId((current) => (current === card.id ? null : card.id))}
                />
              </div>
              <div className="ws-val">
                {card.value ?? "—"}
                {card.value != null ? <span className="ws-val-unit">{label.unit}</span> : null}
              </div>
              <DeltaMark delta={card.delta} tone={card.tone} previous={card.previous} />
              <p className="ws-kpi-sub">{summedNote ?? hint.summary}</p>
            </div>
          );
        })}
        {PREP_CARDS.map((card) => (
          <div className="ws-kpi" key={card.id}>
            <div className="ws-lab">
              <span className="ws-lab-text">{SUMMARY_CARD_LABEL[card.id].label}</span>
              <span className="ws-stamp">{PREP_STAMP}</span>
            </div>
            <p className="ws-kpi-sub">{card.line}</p>
          </div>
        ))}
      </div>
      {open ? <MetricHintPanel id={panelId} hint={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

/* ─────────────────────── 방문자 추이 ─────────────────────── */

const ONE_DAY_HINT =
  "하루만 고르면 시간대별로 그려야 합니다. 시간대별 방문은 아직 모으지 않아 7일 이상에서 보입니다.";

function VisitTrend({ data }: { data: StatsData }) {
  const trend = useMemo(() => buildTrend(data.bundle), [data.bundle]);
  const oneDay = trend.length === 1;

  return (
    <div className="ws-sec">
      <div className="ws-card">
        <div className="ws-ct">
          방문자 추이 — 실선 이번 기간, 점선 앞 기간
          {oneDay ? <span className="ws-stamp">{PREP_STAMP}</span> : null}
        </div>
        <p className="ws-cs">하루마다 센 방문자입니다. 여러 날 온 사람은 날마다 셉니다.</p>
        <ChartSlot
          status={data.status}
          empty={trend.length < 2}
          hint={oneDay ? ONE_DAY_HINT : undefined}
        >
          <StatsChart
            type="line"
            data={trend}
            xKey="date"
            series={[
              { key: "current", name: "이번 기간", color: STATS_COLORS[0] },
              { key: "previous", name: "앞 기간", color: STATS_TEXT, dashed: true }
            ]}
          />
        </ChartSlot>
      </div>
    </div>
  );
}

/* ─────────────────────── 루나 요약 · 할 일 ─────────────────────── */

type BriefState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: StatsBriefResult }
  | { status: "error" };

/**
 * 루나 총평·할 일. 새 사이트 숫자만 API 에 넘기고, 같은 기간·같은 숫자는
 * localStorage 캐시. 넘길 숫자가 없으면 idle 이다.
 */
function useSummaryBrief(data: StatsData, from: string, to: string): {
  state: BriefState;
  retry: () => void;
} {
  const [retryTick, setRetryTick] = useState(0);
  const [state, setState] = useState<BriefState>({ status: "idle" });

  useEffect(() => {
    if (data.status === "loading") {
      setState({ status: "loading" });
      return;
    }
    if (data.status === "error") {
      setState({ status: "error" });
      return;
    }

    const facts = buildSummaryBriefFacts(data.bundle, from, to);
    if (!facts) {
      setState({ status: "idle" });
      return;
    }

    const fingerprint = summaryBriefFingerprint(facts);
    let cancelled = false;
    setState({ status: "loading" });

    void loadSummaryBrief(facts.from, facts.to, fingerprint, facts).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data?.summary) {
        setState({ status: "error" });
        return;
      }
      setState({ status: "ready", data: result.data });
    });

    return () => {
      cancelled = true;
    };
  }, [data.bundle, data.status, from, to, retryTick]);

  return {
    state,
    retry: () => setRetryTick((n) => n + 1)
  };
}

function LunaBlock({ state, onRetry }: { state: BriefState; onRetry: () => void }) {
  return (
    <div className="ws-luna">
      <div className="ws-who">루나 요약 · 새 홈페이지 숫자만 읽었습니다</div>
      {state.status === "idle" ? <p>이 기간에는 읽을 새 홈페이지 숫자가 없습니다.</p> : null}
      {state.status === "loading" ? <p>요약을 만드는 중입니다…</p> : null}
      {state.status === "ready" ? <p>{state.data.summary}</p> : null}
      {state.status === "error" ? (
        <div className="ws-luna-fail">
          <p>요약을 만들지 못했습니다</p>
          <button type="button" className="ws-retry" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TodoList({ state }: { state: BriefState }) {
  return (
    <div className="ws-card">
      <div className="ws-ct">이번 기간 할 일</div>
      {state.status === "ready" && state.data.todos.length > 0 ? (
        <ul className="ws-todo">
          {state.data.todos.map((item) => (
            <li key={`${item.level}-${item.title}`}>
              <span className={`ws-tag ws-tag-${item.level}`}>{TODO_LEVEL_LABEL[item.level]}</span>
              <div>
                {item.title}
                <div className="ws-t2">{item.reason}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ws-kpi-sub">
          {state.status === "loading"
            ? "루나가 고르는 중입니다…"
            : state.status === "ready"
              ? "이번 기간에는 따로 할 일이 없습니다."
              : "루나 요약이 있어야 할 일을 고릅니다."}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────── 조치 기록 ─────────────────────── */

function ActionLog() {
  return (
    <div className="ws-sec">
      <SectionHead title="조치 기록" stamp={PREP_STAMP} />
      <div className="ws-card">
        <p className="ws-kpi-sub">
          한 일을 날짜와 함께 적어 두면 그래프에 세로선으로 표시합니다. 적어 두는 기능을 준비하고
          있습니다.
        </p>
      </div>
    </div>
  );
}

/** 요약 화면 전체 */
export function SummaryScreen({ data, from, to }: { data: StatsData; from: string; to: string }) {
  const brief = useSummaryBrief(data, from, to);

  return (
    <>
      <SummaryCards data={data} />
      <VisitTrend data={data} />
      <div className="ws-sec ws-g2">
        <LunaBlock state={brief.state} onRetry={brief.retry} />
        <TodoList state={brief.state} />
      </div>
      <ActionLog />
    </>
  );
}
