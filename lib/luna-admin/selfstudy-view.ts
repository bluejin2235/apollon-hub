import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MODE_A_PAGE_LIMIT,
  MODE_A_QUESTIONS_PER_PAGE
} from "@/lib/luna/probe-retrieval";
import { studyActivitySummary } from "@/lib/luna/study-status";
import { listStudyRuns, type StudyRunRow } from "@/lib/luna/study-run";
import {
  STUDY_DAILY_COST_USD,
  selectTonightAgenda,
  todayKstKey,
  type AgendaDemote
} from "@/lib/luna/study-agenda";
import { loadTonightState } from "@/lib/luna-admin/tonight";
import { buildLinkProgress } from "@/lib/luna-admin/year-progress";
import { ADMIN_SELFSTUDY_HOUR, ADMIN_SELFSTUDY_MINUTE } from "@/lib/luna-admin/schedule";
import { listCandidateRuleQuestions } from "@/lib/luna/rules";
import { listAnswerFlags } from "@/lib/luna/answer-flags";
import { groupAnswerFlagsByQuestion } from "@/lib/luna/answer-flags-shared";
import type {
  TonightEmptyReason,
  TonightItem,
  TonightLongJob,
  TonightState
} from "@/lib/luna-admin/types";

export type TonightScreen = TonightState & {
  run_label: string;
  empty_reason: TonightEmptyReason | null;
  long_jobs: TonightLongJob[];
  demoted: AgendaDemote[];
  today_cost_usd: number;
};

function kstHm(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const kst = new Date(t + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function shortTimeout(err: string | null | undefined): string | null {
  if (!err) return null;
  if (/timeout|타임아웃/i.test(err)) return "300초 타임아웃으로 죽었다";
  return err.length > 80 ? `${err.slice(0, 77)}…` : err;
}

function howForItem(item: TonightItem, runs: StudyRunRow[]): string {
  if (item.kind === "probe_retrieval") {
    const last = runs.find((r) => r.kind === "probe_retrieval" && r.agenda === item.title);
    const fail = last?.outcome === "failed" ? shortTimeout(
      typeof last.result?.error === "string" ? last.result.error : null
    ) : null;
    if (fail && last) {
      return `20문서씩 청크로 나눠 돌린다. ${kstHm(last.started_at) || "어제"}에 ${fail}.`;
    }
    return "20문서씩 청크로 나눠 돌린다.";
  }
  if (item.kind === "materialize_secondary") {
    return "연도별로 belongs·follows·same 을 채운다. LLM 은 애매한 것만.";
  }
  return item.what;
}

function estimatesFor(item: TonightItem): { llm_calls: number; cost_usd: number } {
  if (item.kind === "probe_retrieval") {
    const llm = MODE_A_PAGE_LIMIT * MODE_A_QUESTIONS_PER_PAGE;
    return { llm_calls: llm, cost_usd: 0.33 };
  }
  if (item.kind === "materialize_secondary") {
    return { llm_calls: 0, cost_usd: 0 };
  }
  return { llm_calls: 0, cost_usd: 0 };
}

function emptyReason(opts: {
  active: TonightItem[];
  excluded: TonightItem[];
  human: TonightItem[];
  demoted: AgendaDemote[];
  todayCost: number;
}): TonightEmptyReason | null {
  if (opts.active.length > 0) return null;
  const already = opts.demoted.find((d) => d.reason === "already_ran");
  if (already) {
    return {
      code: "already_ran",
      title: "오늘 밤은 건너뜁니다",
      detail: `${already.detail}\n내일 05:00 에 다시 고릅니다.`,
      action_label: already.outcome === "failed" ? "실패 기록 보기" : "어젯밤 보기",
      action_href: "/settings?menu=selfstudy&sub=history"
    };
  }
  const gaveUp = opts.demoted.find(
    (d) => d.reason === "same_fail_streak" || d.reason === "fail_cap"
  );
  if (gaveUp) {
    return {
      code: "gave_up",
      title: "오늘은 이 일을 그만둡니다",
      detail: gaveUp.detail,
      action_label: "실패 기록 보기",
      action_href: "/settings?menu=selfstudy&sub=history"
    };
  }
  if (opts.todayCost >= STUDY_DAILY_COST_USD) {
    return {
      code: "budget",
      title: "하루 예산을 다 썼습니다",
      detail: `하루 예산 $${STUDY_DAILY_COST_USD.toFixed(2)} 을 다 썼습니다 — 내일 다시 시작합니다.`
    };
  }
  if (opts.excluded.length > 0 && opts.human.length === 0) {
    return {
      code: "all_excluded",
      title: "모두 제외하셨습니다",
      detail: "빼기를 되돌리면 다시 나옵니다."
    };
  }
  if (opts.human.length > 0) {
    return {
      code: "human_only",
      title: "정답 있는 일이 없습니다",
      detail: "남은 것은 모두 사람이 답해야 합니다. 「내가 답할 것」에서 답해 주시면 그다음부터 자습이 가져갑니다.",
      action_label: "내가 답할 것",
      action_href: "/settings?menu=selfstudy&sub=ask"
    };
  }
  return {
    code: "no_gaps",
    title: "점검할 부족함이 없습니다",
    detail: "모든 원천이 최근에 색인됐고 실패도 쌓이지 않았습니다."
  };
}

async function notionPageCount(admin: SupabaseClient): Promise<number | null> {
  const { count, error } = await admin
    .from("luna_notion_pages")
    .select("page_id", { count: "exact", head: true })
    .eq("archived", false);
  if (error) {
    console.error("[selfstudy-view] notion count", error);
    return null;
  }
  return count;
}

function modeAProgress(runs: StudyRunRow[], notionTotal: number | null): TonightLongJob {
  return {
    id: "mode_a",
    title: "모드 A 검색 검증",
    ...studyActivitySummary(runs, notionTotal),
    bar_color: "var(--luna)"
  };
}

function secondaryProgress(
  years: Array<{ year: string; status: string; status_label: string; progress_pct: number }>
): TonightLongJob | null {
  if (years.length === 0) return null;
  const done = years.filter((y) => y.status === "done").map((y) => y.year);
  const tonight = years.find((y) => y.status === "tonight");
  const wait = years.filter((y) => y.status === "wait").map((y) => y.year);
  const avg =
    years.reduce((s, y) => s + (y.progress_pct || 0), 0) / Math.max(1, years.length);
  return {
    id: "secondary",
    title: "연도별 연결 생성 현황",
    value: tonight
      ? `${done.join("·") || "해당 연도 없음"} 연결 있음 · ${tonight.year} 오늘 밤`
      : done.length
        ? `${done.join("·")} 연결 있음`
        : "아직 시작 전",
    pct: Math.round(avg),
    detail: `${wait.length ? `${wait.join(" · ")} 생성 대기. ` : ""}연결 행 분포이며 정확도나 인사이트 완성률을 뜻하지 않습니다.`,
    bar_color: "var(--work)"
  };
}

export async function buildTonightScreen(admin: SupabaseClient): Promise<TonightScreen> {
  const hh = String(ADMIN_SELFSTUDY_HOUR).padStart(2, "0");
  const mm = String(ADMIN_SELFSTUDY_MINUTE).padStart(2, "0");
  const [state, agenda, runs, notionTotal, linkProgress] = await Promise.all([
    loadTonightState(admin),
    selectTonightAgenda(admin),
    listStudyRuns(admin, 120),
    notionPageCount(admin),
    buildLinkProgress(admin).catch(() => null)
  ]);

  const today = todayKstKey();
  const todayCostKst = runs.reduce((s, r) => {
    const t = new Date(r.started_at).getTime();
    if (Number.isNaN(t)) return s;
    const kst = new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return kst === today ? s + (r.cost_usd || 0) : s;
  }, 0);

  const items: TonightItem[] = state.items.map((item) => {
    const est = estimatesFor(item);
    const human = !item.verifiable && !item.excluded;
    return {
      ...item,
      how: howForItem(item, runs),
      llm_calls: est.llm_calls,
      cost_usd: est.cost_usd,
      skip_reason: human
        ? "정답이 없다 · 답이 맞는지 사람이 봐야 한다"
        : item.excluded
          ? "제외됨"
          : undefined
    };
  });

  const active = items.filter((i) => !i.excluded && i.when === "tonight");
  const excluded = items.filter((i) => i.excluded);
  const human = items.filter((i) => !i.excluded && (i.when === "tomorrow" || i.verifiable === false));

  const long_jobs: TonightLongJob[] = [];
  const modeA = modeAProgress(runs, notionTotal);
  if (modeA) long_jobs.push(modeA);
  if (linkProgress) {
    const sec = secondaryProgress(linkProgress.years);
    if (sec) long_jobs.push(sec);
  }

  return {
    ...state,
    items,
    run_label: `오늘 밤 ${hh}:${mm}`,
    empty_reason: emptyReason({
      active,
      excluded,
      human,
      demoted: agenda.demoted,
      todayCost: todayCostKst
    }),
    long_jobs,
    demoted: agenda.demoted,
    today_cost_usd: todayCostKst
  };
}

export async function countAskInbox(admin: SupabaseClient): Promise<number> {
  const [rules, flags, state] = await Promise.all([
    listCandidateRuleQuestions(admin),
    listAnswerFlags(admin, { status: "pending", limit: 200 }),
    loadTonightState(admin)
  ]);
  const grouped = groupAnswerFlagsByQuestion(flags).length;
  const skips = state.items.filter((i) => !i.verifiable && !i.excluded).length;
  return rules.length + grouped + skips;
}
