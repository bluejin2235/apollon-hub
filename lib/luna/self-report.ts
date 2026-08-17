import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTierModel, resolveAnthropicModel } from "@/lib/luna/engine";
import {
  collectMorningSummaryParts,
  isKstMonday
} from "@/lib/luna/morning-summary";
import { LUNA_LINKS } from "@/lib/luna/notify";
import { getPrompt, LUNA_PROMPT_KEYS } from "@/lib/luna/prompts";
import { parseJsonObject } from "@/lib/luna/candidates";
import { kstDayBounds, CORRECTION_RE } from "@/lib/luna/selfstudy";
import {
  ensureLunaGoal,
  formatVerificationSection,
  kstMondayDate,
  listGoalsForWeek,
  parseGoalDrafts,
  saveGoalsForWeek,
  shiftMondayDate,
  snapshotMetrics,
  verifyOpenGoalsForWeek,
  type MetricKey
} from "@/lib/luna/weekly-goals";

const SETTINGS_LAST = "self_report_last";

const REPORT_FALLBACK = `매주 성장 루프를 돌린다. 서술로 끝내지 않는다.

출력은 JSON 하나만.
{
  "body": "② 이번 주 요약만. 배운 것·자주 틀린 것. 짧게.",
  "goals": [
    {
      "goal": "측정 가능한 한 문장",
      "reason": "왜 이 목표인가",
      "owner": "luna",
      "metric_key": "search_zero_count",
      "baseline": 12,
      "target": 6,
      "action_type": "selfstudy"
    }
  ]
}

규칙:
- ① 지난주 검증은 시스템이 쓰므로 body 에 넣지 않는다.
- ② 이번 주 요약만 body 에 쓴다. 지표 숫자를 반복하지 않는다.
- ③ 다음 주 목표는 goals 배열. 최대 2개. owner=luna 1개는 필수. owner=human 은 있을 때만.
- 목표는 측정 가능해야 한다. 검증할 수 없는 다짐은 쓰지 않는다. 나쁜 예: "확신 수준을 점검하겠다". 좋은 예: "검색 0건 사례를 12건에서 6건 이하로".
- 루나가 고칠 수 없는 문제(데이터 정리, 기능 부재)는 owner=human, action_type=dev.
- metric_key 는 제시된 목록만. baseline/target 은 숫자.
- action_type 은 prompt | selfstudy | dev | none.
- 제목(#)과 구분선(---)을 쓰지 않는다.`;

export type SelfReportLast = {
  finished_at: string;
  title: string;
  body: string;
  notification_id: string | null;
  stats: Record<string, unknown>;
};

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/** 이번 주(월~일 KST) UTC 구간 */
export function kstWeekBounds(now = new Date()): {
  startIso: string;
  endIso: string;
  prevStartIso: string;
  prevEndIso: string;
} {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const day = kst.getUTCDay(); // 0 Sun .. 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate() + mondayOffset;
  const weekStartUtc = Date.UTC(y, m, d) - 9 * 60 * 60 * 1000;
  const weekEndUtc = weekStartUtc + 7 * 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(weekStartUtc).toISOString(),
    endIso: new Date(weekEndUtc).toISOString(),
    prevStartIso: new Date(weekStartUtc - 7 * 24 * 60 * 60 * 1000).toISOString(),
    prevEndIso: new Date(weekStartUtc).toISOString()
  };
}

function asMeta(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function isPurgedMeta(meta: Record<string, unknown>): boolean {
  const v = meta.purged;
  return v != null && v !== "" && v !== false;
}

export type CandidateInflowStats = {
  total: number;
  confirmed: number;
  pending: number;
  archived: number;
};

export type CorrectionStats = {
  total: number;
  thumbs_down: number;
  from_correction: number;
  user_correction: number;
};

export type EvalTierScores = {
  light: string | null;
  heavy: string | null;
};

export async function countCandidateInflow(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<CandidateInflowStats> {
  const empty: CandidateInflowStats = {
    total: 0,
    confirmed: 0,
    pending: 0,
    archived: 0
  };
  const { data, error } = await admin
    .from("luna_learnings")
    .select("status, meta")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .neq("category", "identity")
    .limit(4000);
  if (error) {
    console.error("[luna/self-report] candidate inflow", error);
    return empty;
  }
  const out = { ...empty };
  for (const row of data ?? []) {
    if (isPurgedMeta(asMeta(row.meta))) continue;
    out.total += 1;
    if (row.status === "active") out.confirmed += 1;
    else if (row.status === "candidate") out.pending += 1;
    else if (row.status === "archived") out.archived += 1;
  }
  return out;
}

export async function countWeeklyCorrections(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<CorrectionStats> {
  const [{ data: messages, error: msgErr }, { data: learnings, error: learnErr }] =
    await Promise.all([
      admin
        .from("luna_messages")
        .select("role, content, metadata, conversation_id")
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .limit(8000),
      admin
        .from("luna_learnings")
        .select("meta")
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .neq("category", "identity")
        .limit(4000)
    ]);
  if (msgErr) console.error("[luna/self-report] correction messages", msgErr);
  if (learnErr) console.error("[luna/self-report] correction learnings", learnErr);

  let thumbsDown = 0;
  let userCorrection = 0;
  for (const row of messages ?? []) {
    const meta = asMeta(row.metadata);
    if (row.role === "assistant" && meta.feedback === "bad") thumbsDown += 1;
    if (
      row.role === "user" &&
      typeof row.content === "string" &&
      CORRECTION_RE.test(row.content)
    ) {
      userCorrection += 1;
    }
  }

  let fromCorrection = 0;
  for (const row of learnings ?? []) {
    const meta = asMeta(row.meta);
    if (isPurgedMeta(meta)) continue;
    if (meta.from_correction === true) fromCorrection += 1;
  }

  return {
    thumbs_down: thumbsDown,
    from_correction: fromCorrection,
    user_correction: userCorrection,
    total: thumbsDown + fromCorrection + userCorrection
  };
}

function evalScoreLabel(row: {
  passed?: unknown;
  total?: unknown;
  score_sum?: unknown;
  score_max?: unknown;
}): string | null {
  const passed = typeof row.passed === "number" ? row.passed : Number(row.passed);
  const total = typeof row.total === "number" ? row.total : Number(row.total);
  if (Number.isFinite(passed) && Number.isFinite(total) && total > 0) {
    if (total === 20) return null;
    return `${passed}/${total}`;
  }
  const sum =
    typeof row.score_sum === "number" ? row.score_sum : Number(row.score_sum);
  const max =
    typeof row.score_max === "number" ? row.score_max : Number(row.score_max);
  if (Number.isFinite(sum) && Number.isFinite(max) && max > 0) {
    if (max === 20) return null;
    return `${sum}/${max}`;
  }
  return null;
}

export async function loadLatestEvalTierScores(
  admin: SupabaseClient
): Promise<EvalTierScores> {
  const loadOne = async (tier: "light" | "heavy"): Promise<string | null> => {
    const { data, error } = await admin
      .from("luna_eval_runs")
      .select("passed, total, score_sum, score_max, finished_at")
      .eq("tier", tier)
      .eq("status", "done")
      .order("finished_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error(`[luna/self-report] eval ${tier}`, error);
      return null;
    }
    const row = data?.[0];
    return row ? evalScoreLabel(row) : null;
  };
  const [light, heavy] = await Promise.all([loadOne("light"), loadOne("heavy")]);
  return { light, heavy };
}

export function formatEvalScoreLine(scores: EvalTierScores): string {
  const light = scores.light ?? "—";
  const heavy = scores.heavy ?? "—";
  return `매일 점검 ${light} · 주간 점검 ${heavy}`;
}

export async function getSelfReportStatus(
  admin: SupabaseClient
): Promise<{ last_report: SelfReportLast | null }> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", SETTINGS_LAST)
    .maybeSingle();
  if (error) {
    console.error("[luna/self-report] status", error);
    return { last_report: null };
  }
  if (!data?.value || typeof data.value !== "object" || Array.isArray(data.value)) {
    return { last_report: null };
  }
  return { last_report: data.value as SelfReportLast };
}

/**
 * 주간 성장 보고 → hub_notifications (category=luna_report, scope=admin).
 */
export async function runWeeklySelfReport(
  admin: SupabaseClient
): Promise<{
  ok: true;
  skipped: boolean;
  message: string;
  notification_id?: string | null;
  body?: string;
  goals?: unknown[];
}> {
  const week = kstWeekBounds();
  const today = kstDayBounds();

  const [
    { data: confirmedRows },
    { data: lunaVersions },
    thisWeekInflow,
    prevWeekInflow,
    corrections
  ] = await Promise.all([
    admin
      .from("luna_learnings")
      .select("content, category, resolved_at")
      .eq("status", "active")
      .gte("resolved_at", week.startIso)
      .lt("resolved_at", week.endIso)
      .neq("category", "identity")
      .order("resolved_at", { ascending: false })
      .limit(50),
    admin
      .from("luna_prompt_versions")
      .select(
        "version, change_summary, prediction, verify_result, verify_note, created_at, target_id, changed_by_luna"
      )
      .eq("target_type", "prompt")
      .eq("changed_by_luna", true)
      .gte("created_at", week.startIso)
      .lt("created_at", week.endIso)
      .order("created_at", { ascending: false })
      .limit(20),
    countCandidateInflow(admin, week.startIso, week.endIso),
    countCandidateInflow(admin, week.prevStartIso, week.prevEndIso),
    countWeeklyCorrections(admin, week.startIso, week.endIso)
  ]);

  const confirmed = (confirmedRows ?? []).map((r) => ({
    content: typeof r.content === "string" ? r.content : "",
    category: typeof r.category === "string" ? r.category : "general"
  }));
  const confirmedCount = confirmed.length;
  const top3 = confirmed.slice(0, 3);

  const promptChanges = (lunaVersions ?? []).map((v) => ({
    summary: v.change_summary,
    prediction: v.prediction,
    result: v.verify_result,
    note: v.verify_note
  }));

  const monday = kstMondayDate();
  const prevMonday = shiftMondayDate(monday, -1);
  const metrics = await snapshotMetrics(admin, monday);
  const lastWeekVerified = await verifyOpenGoalsForWeek(admin, prevMonday);
  const existingThisWeek = await listGoalsForWeek(admin, monday);
  const hasOpenThisWeek = existingThisWeek.some((g) => g.status === "open");

  const stats = {
    confirmed_count: confirmedCount,
    top3,
    top_correction_count: corrections.total,
    correction_thumbs_down: corrections.thumbs_down,
    correction_from_learning: corrections.from_correction,
    correction_user_phrase: corrections.user_correction,
    prompt_changes: promptChanges,
    candidate_inflow_this_week: thisWeekInflow.total,
    candidate_inflow_confirmed: thisWeekInflow.confirmed,
    candidate_inflow_pending: thisWeekInflow.pending,
    candidate_inflow_archived: thisWeekInflow.archived,
    candidate_inflow_prev_week: prevWeekInflow.total,
    week_start: week.startIso,
    week_end: week.endIso,
    week_start_date: monday,
    metrics,
    last_week_verification: lastWeekVerified.map((g) => ({
      goal: g.goal,
      owner: g.owner,
      status: g.status,
      result_value: g.result_value,
      result_note: g.result_note
    })),
    generated_at: today.startIso
  };

  const client = getAnthropicClient();
  const system =
    (await getPrompt(admin, LUNA_PROMPT_KEYS.report)).trim() || REPORT_FALLBACK;

  let bodyText = "";
  let parsedGoals = parseGoalDrafts([]);
  if (client) {
    const tierA = resolveAnthropicModel(await getTierModel(admin, "A"));
    try {
      const res = await client.messages.create({
        model: tierA.model_id,
        max_tokens: 2000,
        system,
        messages: [
          {
            role: "user",
            content: `아래 주간 집계로 성장 루프 JSON 을 작성하세요. ① 지난주 검증 본문은 넣지 마세요.\n\n${JSON.stringify(stats, null, 2)}`
          }
        ]
      });
      const raw =
        res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
      const parsed = parseJsonObject(raw);
      if (parsed) {
        bodyText =
          typeof parsed.body === "string"
            ? parsed.body.trim()
            : typeof parsed.report === "string"
              ? parsed.report.trim()
              : "";
        parsedGoals = parseGoalDrafts(parsed.goals);
      } else if (raw) {
        bodyText = raw;
      }
    } catch (err) {
      console.error("[luna/self-report] claude", err);
    }
  }

  if (!bodyText) {
    const searchZero = metrics.search_zero_count ?? 0;
    bodyText = [
      "이번 주는 배운 것과 자주 틀린 것을 짧게 남긴다.",
      top3.length
        ? `대표로 남은 지식: ${top3.map((t) => t.content).join(" / ")}`
        : "대표로 확정된 사례는 적었다.",
      promptChanges.length
        ? "프롬프트를 스스로 손본 기록이 있다."
        : "프롬프트 자율 변경은 없었다.",
      searchZero > 0
        ? "검색이 빈손으로 끝난 대화가 반복되면 다음 주 자습 주제로 삼는다."
        : "검색 공백은 두드러지지 않았다.",
      "다음 주에는 측정 가능한 약점 하나를 줄인다."
    ].join("\n\n");
  }

  const metricSnap = metrics as Partial<Record<MetricKey, number | null>>;
  const drafts = ensureLunaGoal(parsedGoals, metricSnap);
  let savedGoals = existingThisWeek.filter((g) => g.status === "open");
  if (!hasOpenThisWeek) {
    savedGoals = await saveGoalsForWeek(admin, monday, drafts, "luna");
  }

  const verification = formatVerificationSection(lastWeekVerified);
  const goalLines = savedGoals.map((g) => {
    const who = g.owner === "human" ? "블루진에게 요청" : "루나";
    return `- [${who}] ${g.goal}`;
  });
  const reasonLines = savedGoals
    .map((g) => g.reason)
    .filter((r): r is string => Boolean(r && r.trim()));
  const composed = [
    verification,
    bodyText.trim(),
    goalLines.length > 0 ? `다음 주 목표\n${goalLines.join("\n")}` : "",
    reasonLines.length > 0 ? `목표를 고른 이유\n${reasonLines.join("\n")}` : ""
  ]
    .filter((p) => p.trim())
    .join("\n\n");
  bodyText = composed;

  // 월요일 08:00 — 아침 요약과 시각이 겹치므로 밤사이 요약을 본문에 합친다
  let morningParts: string[] = [];
  if (isKstMonday()) {
    try {
      const morning = await collectMorningSummaryParts(admin);
      morningParts = morning.parts;
      if (morningParts.length > 0) {
        bodyText = [
          "[밤사이]",
          morningParts.join("\n"),
          "",
          "[주간 보고]",
          bodyText
        ].join("\n");
      }
    } catch (err) {
      console.error("[luna/self-report] morning merge", err);
    }
  }

  const title = "루나 주간 성장 루프";
  const { data: notif, error: notifErr } = await admin
    .from("hub_notifications")
    .insert({
      category: "luna_report",
      title,
      body: bodyText.slice(0, 12000),
      link: LUNA_LINKS.brainReport,
      level: "info",
      scope: "admin",
      meta: {
        event: "self_report",
        morning_parts: morningParts,
        goal_ids: savedGoals.map((g) => g.id),
        ...stats
      }
    })
    .select("id")
    .maybeSingle();

  if (notifErr) {
    console.error("[luna/self-report] notify", notifErr);
    return {
      ok: true,
      skipped: true,
      message: `알림 저장 실패: ${notifErr.message}`
    };
  }

  const last: SelfReportLast = {
    finished_at: new Date().toISOString(),
    title,
    body: bodyText,
    notification_id: (notif?.id as string) ?? null,
    stats
  };

  const { error: saveErr } = await admin.from("luna_settings").upsert(
    {
      key: SETTINGS_LAST,
      value: last,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (saveErr) console.error("[luna/self-report] save", saveErr);

  return {
    ok: true,
    skipped: false,
    message: "주간 보고 제출",
    notification_id: last.notification_id,
    body: bodyText,
    goals: savedGoals
  };
}
