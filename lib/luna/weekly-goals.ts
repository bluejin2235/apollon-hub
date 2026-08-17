import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LUNA_LINKS, lunaNotify } from "@/lib/luna/notify";

const PROMPT_QUEUE_KEY = "growth_goal_prompt_queue";
const CORRECTION_RE = /아니라|그게 아니고|그게 아니라|틀렸|잘못된|아니야|아니에요/;

export const METRIC_KEYS = [
  "search_zero_count",
  "correction_count",
  "thumbs_down_count",
  "candidate_confirm_rate",
  "eval_light_score",
  "clarify_unresolved",
  "selfstudy_confirmed"
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  search_zero_count: "검색 0건",
  correction_count: "정정받음",
  thumbs_down_count: "싫어요",
  candidate_confirm_rate: "후보 확정률",
  eval_light_score: "매일 점검",
  clarify_unresolved: "되묻기 미해소",
  selfstudy_confirmed: "자습 확정"
};

export type GoalOwner = "luna" | "human";
export type GoalSource = "luna" | "human";
export type GoalStatus = "open" | "achieved" | "missed" | "partial" | "dropped";
export type GoalActionType = "prompt" | "selfstudy" | "dev" | "none";

export type WeeklyGoalRow = {
  id: string;
  week_start: string;
  goal: string;
  reason: string | null;
  owner: GoalOwner;
  metric_key: string | null;
  metric_baseline: number | null;
  metric_target: number | null;
  action_type: GoalActionType | null;
  action_ref: string | null;
  status: GoalStatus;
  result_value: number | null;
  result_note: string | null;
  verified_at: string | null;
  source: GoalSource;
  created_at: string;
};

export type WeeklyGoalView = WeeklyGoalRow & {
  current_value: number | null;
};

export type GoalDraft = {
  goal: string;
  reason: string;
  owner: GoalOwner;
  metric_key: MetricKey | null;
  metric_baseline: number | null;
  metric_target: number | null;
  action_type: GoalActionType;
};

export type GoalPromptProposal = {
  id: string;
  goal_id: string;
  goal: string;
  reason: string;
  metric_key: string | null;
  created_at: string;
};

export function kstMondayDate(now = new Date()): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const day = kst.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate() + mondayOffset;
  const monday = new Date(Date.UTC(y, m, d));
  return monday.toISOString().slice(0, 10);
}

export function shiftMondayDate(mondayDate: string, weeks: number): string {
  const utc = Date.parse(`${mondayDate}T00:00:00Z`);
  return new Date(utc + weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function weekUtcRange(mondayDate: string): {
  startIso: string;
  endIso: string;
} {
  const startUtc = Date.parse(`${mondayDate}T00:00:00+09:00`);
  return {
    startIso: new Date(startUtc).toISOString(),
    endIso: new Date(startUtc + 7 * 24 * 60 * 60 * 1000).toISOString()
  };
}

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === "string" && (METRIC_KEYS as readonly string[]).includes(value);
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

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function cardCount(meta: Record<string, unknown> | null): number {
  if (!meta) return 0;
  const nCards = Array.isArray(meta.cards) ? meta.cards.length : 0;
  const nNotion = Array.isArray(meta.notion_sources) ? meta.notion_sources.length : 0;
  return nCards + nNotion;
}

function searchAttempted(meta: Record<string, unknown> | null): boolean {
  if (!meta) return false;
  const rounds = meta.search_rounds;
  if (typeof rounds === "number" && rounds > 0) return true;
  if (Array.isArray(meta.cards)) return true;
  if (Array.isArray(meta.notion_sources)) return true;
  if (Array.isArray(meta.ws_tool_calls) && meta.ws_tool_calls.length > 0) {
    return true;
  }
  return false;
}

function mapGoalRow(raw: Record<string, unknown>): WeeklyGoalRow {
  const owner = raw.owner === "human" ? "human" : "luna";
  const source = raw.source === "human" ? "human" : "luna";
  const status: GoalStatus =
    raw.status === "achieved" ||
    raw.status === "missed" ||
    raw.status === "partial" ||
    raw.status === "dropped"
      ? raw.status
      : "open";
  const action: GoalActionType | null =
    raw.action_type === "prompt" ||
    raw.action_type === "selfstudy" ||
    raw.action_type === "dev" ||
    raw.action_type === "none"
      ? raw.action_type
      : null;
  return {
    id: String(raw.id),
    week_start: String(raw.week_start).slice(0, 10),
    goal: typeof raw.goal === "string" ? raw.goal : "",
    reason: typeof raw.reason === "string" ? raw.reason : null,
    owner,
    metric_key: typeof raw.metric_key === "string" ? raw.metric_key : null,
    metric_baseline: num(raw.metric_baseline),
    metric_target: num(raw.metric_target),
    action_type: action,
    action_ref: typeof raw.action_ref === "string" ? raw.action_ref : null,
    status,
    result_value: num(raw.result_value),
    result_note: typeof raw.result_note === "string" ? raw.result_note : null,
    verified_at: typeof raw.verified_at === "string" ? raw.verified_at : null,
    source,
    created_at: typeof raw.created_at === "string" ? raw.created_at : ""
  };
}

export async function computeMetric(
  admin: SupabaseClient,
  key: MetricKey,
  startIso: string,
  endIso: string
): Promise<number | null> {
  if (key === "eval_light_score") {
    const { data, error } = await admin
      .from("luna_eval_runs")
      .select("passed, total, finished_at")
      .eq("tier", "light")
      .eq("status", "done")
      .order("finished_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[luna/weekly-goals] eval_light", error);
      return null;
    }
    const row = data?.[0];
    const passed = num(row?.passed);
    const total = num(row?.total);
    if (passed == null || total == null || total === 20) return null;
    return passed;
  }

  if (key === "selfstudy_confirmed") {
    const { data, error } = await admin
      .from("luna_learnings")
      .select("id")
      .eq("source", "selfstudy")
      .eq("status", "active")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(2000);
    if (error) {
      console.error("[luna/weekly-goals] selfstudy_confirmed", error);
      return null;
    }
    return data?.length ?? 0;
  }

  if (key === "candidate_confirm_rate") {
    const { data, error } = await admin
      .from("luna_learnings")
      .select("status, meta")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .neq("category", "identity")
      .limit(4000);
    if (error) {
      console.error("[luna/weekly-goals] confirm_rate", error);
      return null;
    }
    let total = 0;
    let confirmed = 0;
    for (const row of data ?? []) {
      if (isPurgedMeta(asMeta(row.meta))) continue;
      total += 1;
      if (row.status === "active") confirmed += 1;
    }
    if (total === 0) return 0;
    return Math.round((confirmed / total) * 1000) / 10;
  }

  const { data, error } = await admin
    .from("luna_messages")
    .select("id, conversation_id, role, content, metadata, created_at")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true })
    .limit(8000);
  if (error) {
    console.error("[luna/weekly-goals] messages", error);
    return null;
  }
  const rows = data ?? [];

  if (key === "thumbs_down_count") {
    return rows.filter(
      (r) => r.role === "assistant" && asMeta(r.metadata).feedback === "bad"
    ).length;
  }

  if (key === "correction_count") {
    let thumbsDown = 0;
    let userCorrection = 0;
    for (const row of rows) {
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
    const { data: learnings, error: learnErr } = await admin
      .from("luna_learnings")
      .select("meta")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .neq("category", "identity")
      .limit(4000);
    if (learnErr) console.error("[luna/weekly-goals] correction learnings", learnErr);
    let fromCorrection = 0;
    for (const row of learnings ?? []) {
      const meta = asMeta(row.meta);
      if (isPurgedMeta(meta)) continue;
      if (meta.from_correction === true) fromCorrection += 1;
    }
    return thumbsDown + userCorrection + fromCorrection;
  }

  if (key === "search_zero_count") {
    return rows.filter((r) => {
      if (r.role !== "assistant") return false;
      const meta = asMeta(r.metadata);
      return searchAttempted(meta) && cardCount(meta) === 0;
    }).length;
  }

  if (key === "clarify_unresolved") {
    const byConv = new Map<string, typeof rows>();
    for (const row of rows) {
      const cid = row.conversation_id as string;
      const list = byConv.get(cid) ?? [];
      list.push(row);
      byConv.set(cid, list);
    }
    let n = 0;
    for (const list of byConv.values()) {
      for (let i = 0; i < list.length; i += 1) {
        const m = list[i]!;
        if (m.role !== "assistant") continue;
        const meta = asMeta(m.metadata);
        if (!meta.clarify) continue;
        const nextUser = list.slice(i + 1).find((x) => x.role === "user");
        const afterIdx = nextUser
          ? list.findIndex((x) => x.id === nextUser.id)
          : -1;
        const nextAssistant =
          afterIdx >= 0
            ? list.slice(afterIdx + 1).find((x) => x.role === "assistant")
            : null;
        const unresolved =
          !nextUser ||
          !nextAssistant ||
          Boolean(asMeta(nextAssistant.metadata).clarify) ||
          (searchAttempted(asMeta(nextAssistant.metadata)) &&
            cardCount(asMeta(nextAssistant.metadata)) === 0);
        if (unresolved) n += 1;
      }
    }
    return n;
  }

  return null;
}

export function metricDirection(
  baseline: number | null,
  target: number | null
): "down" | "up" | "hold" {
  if (baseline == null || target == null) return "hold";
  if (target < baseline) return "down";
  if (target > baseline) return "up";
  return "hold";
}

export function judgeGoalStatus(
  baseline: number | null,
  target: number | null,
  current: number | null
): { status: Exclude<GoalStatus, "open" | "dropped">; note: string } {
  if (current == null) {
    return { status: "partial", note: "지표를 계산하지 못해 부분달성으로 둔다" };
  }
  const dir = metricDirection(baseline, target);
  if (dir === "hold") {
    if (target != null && current === target) {
      return { status: "achieved", note: "목표 값을 유지했다" };
    }
    return { status: "missed", note: "목표 값과 다르다" };
  }
  if (dir === "down") {
    if (target != null && current <= target) {
      return { status: "achieved", note: "목표 이하로 줄였다" };
    }
    if (baseline != null && current < baseline) {
      return { status: "partial", note: "줄었지만 목표에는 못 미쳤다" };
    }
    return { status: "missed", note: "줄이지 못했다" };
  }
  if (target != null && current >= target) {
    return { status: "achieved", note: "목표 이상으로 올렸다" };
  }
  if (baseline != null && current > baseline) {
    return { status: "partial", note: "올랐지만 목표에는 못 미쳤다" };
  }
  return { status: "missed", note: "올리지 못했다" };
}

export async function listGoalsForWeek(
  admin: SupabaseClient,
  mondayDate: string
): Promise<WeeklyGoalRow[]> {
  const { data, error } = await admin
    .from("luna_weekly_goals")
    .select("*")
    .eq("week_start", mondayDate)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[luna/weekly-goals] list week", error);
    return [];
  }
  return (data ?? []).map((r) => mapGoalRow(r as Record<string, unknown>));
}

export async function listGoalHistory(
  admin: SupabaseClient,
  limit = 30
): Promise<WeeklyGoalRow[]> {
  const { data, error } = await admin
    .from("luna_weekly_goals")
    .select("*")
    .order("week_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[luna/weekly-goals] history", error);
    return [];
  }
  return (data ?? []).map((r) => mapGoalRow(r as Record<string, unknown>));
}

export async function attachCurrentValues(
  admin: SupabaseClient,
  goals: WeeklyGoalRow[],
  mondayDate: string
): Promise<WeeklyGoalView[]> {
  const { startIso, endIso } = weekUtcRange(mondayDate);
  const keys = Array.from(
    new Set(
      goals
        .map((g) => g.metric_key)
        .filter((k): k is MetricKey => isMetricKey(k))
    )
  );
  const values = new Map<MetricKey, number | null>();
  await Promise.all(
    keys.map(async (key) => {
      values.set(key, await computeMetric(admin, key, startIso, endIso));
    })
  );
  return goals.map((g) => ({
    ...g,
    current_value: isMetricKey(g.metric_key)
      ? (values.get(g.metric_key) ?? null)
      : null
  }));
}

export async function verifyOpenGoalsForWeek(
  admin: SupabaseClient,
  mondayDate: string
): Promise<WeeklyGoalRow[]> {
  const open = (await listGoalsForWeek(admin, mondayDate)).filter(
    (g) => g.status === "open"
  );
  if (open.length === 0) return [];
  const { startIso, endIso } = weekUtcRange(mondayDate);
  const now = new Date().toISOString();
  const updated: WeeklyGoalRow[] = [];
  for (const goal of open) {
    const current = isMetricKey(goal.metric_key)
      ? await computeMetric(admin, goal.metric_key, startIso, endIso)
      : null;
    const judged = judgeGoalStatus(
      goal.metric_baseline,
      goal.metric_target,
      current
    );
    const patch = {
      status: judged.status,
      result_value: current,
      result_note: judged.note,
      verified_at: now
    };
    const { data, error } = await admin
      .from("luna_weekly_goals")
      .update(patch)
      .eq("id", goal.id)
      .select("*")
      .maybeSingle();
    if (error) {
      console.error("[luna/weekly-goals] verify", error);
      updated.push({ ...goal, ...patch });
      continue;
    }
    updated.push(
      data
        ? mapGoalRow(data as Record<string, unknown>)
        : { ...goal, ...patch }
    );
  }
  return updated;
}

export function formatVerificationSection(goals: WeeklyGoalRow[]): string {
  if (goals.length === 0) return "";
  const lines = goals.map((g) => {
    const who =
      g.owner === "human" ? "블루진에게 요청했던 것" : "루나 자신의 목표";
    const label =
      g.status === "achieved"
        ? "달성"
        : g.status === "missed"
          ? "미달"
          : g.status === "partial"
            ? "부분달성"
            : g.status;
    const unit = g.metric_key === "candidate_confirm_rate" ? "%" : "건";
    const result =
      g.result_value == null ? "—" : `${g.result_value}${unit}`;
    return `${who}: ${g.goal}\n결과: ${result} — ${label}${
      g.result_note ? ` (${g.result_note})` : ""
    }`;
  });
  return `지난주 목표 검증\n\n${lines.join("\n\n")}`;
}

async function loadPromptQueue(
  admin: SupabaseClient
): Promise<GoalPromptProposal[]> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", PROMPT_QUEUE_KEY)
    .maybeSingle();
  if (error) {
    console.error("[luna/weekly-goals] prompt queue load", error);
    return [];
  }
  const raw = data?.value;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is GoalPromptProposal =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as GoalPromptProposal).id === "string" &&
      typeof (item as GoalPromptProposal).goal_id === "string" &&
      typeof (item as GoalPromptProposal).goal === "string"
  );
}

async function savePromptQueue(
  admin: SupabaseClient,
  items: GoalPromptProposal[]
): Promise<void> {
  const { error } = await admin.from("luna_settings").upsert(
    {
      key: PROMPT_QUEUE_KEY,
      value: items,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) console.error("[luna/weekly-goals] prompt queue save", error);
}

export async function listGoalPromptQueue(
  admin: SupabaseClient
): Promise<GoalPromptProposal[]> {
  return loadPromptQueue(admin);
}

export async function convertGoalToAction(
  admin: SupabaseClient,
  goal: WeeklyGoalRow
): Promise<string | null> {
  const action = goal.action_type ?? "none";
  if (action === "none") return null;

  if (action === "selfstudy") {
    return goal.id;
  }

  if (action === "prompt") {
    const id = crypto.randomUUID();
    const queue = await loadPromptQueue(admin);
    queue.unshift({
      id,
      goal_id: goal.id,
      goal: goal.goal,
      reason: goal.reason ?? "",
      metric_key: goal.metric_key,
      created_at: new Date().toISOString()
    });
    await savePromptQueue(admin, queue.slice(0, 20));
    return id;
  }

  if (action === "dev") {
    const { data, error } = await admin
      .from("hub_notifications")
      .insert({
        category: "luna_dev_task",
        title: "루나가 요청한 개발 과제",
        body: [goal.goal, goal.reason].filter(Boolean).join("\n"),
        link: LUNA_LINKS.brainReport,
        level: "info",
        scope: "admin",
        meta: {
          event: "growth_goal_dev",
          goal_id: goal.id,
          week_start: goal.week_start
        }
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[luna/weekly-goals] dev notify", error);
      return await lunaNotify(
        admin,
        "prompt_change",
        "루나가 요청한 개발 과제",
        goal.goal,
        {
          link: LUNA_LINKS.brainReport,
          meta: { goal_id: goal.id, week_start: goal.week_start }
        }
      );
    }
    return (data?.id as string | undefined) ?? null;
  }

  return null;
}

async function persistActionRef(
  admin: SupabaseClient,
  goalId: string,
  actionRef: string | null
): Promise<void> {
  if (!actionRef) return;
  const { error } = await admin
    .from("luna_weekly_goals")
    .update({ action_ref: actionRef })
    .eq("id", goalId);
  if (error) console.error("[luna/weekly-goals] action_ref", error);
}

export async function insertWeeklyGoal(
  admin: SupabaseClient,
  mondayDate: string,
  draft: GoalDraft,
  source: GoalSource
): Promise<WeeklyGoalRow | null> {
  const { startIso, endIso } = weekUtcRange(mondayDate);
  let baseline = draft.metric_baseline;
  if (baseline == null && draft.metric_key) {
    baseline = await computeMetric(admin, draft.metric_key, startIso, endIso);
  }
  const insert = {
    week_start: mondayDate,
    goal: draft.goal.trim(),
    reason: draft.reason.trim() || null,
    owner: draft.owner,
    metric_key: draft.metric_key,
    metric_baseline: baseline,
    metric_target: draft.metric_target,
    action_type: draft.action_type,
    status: "open" as const,
    source
  };
  const { data, error } = await admin
    .from("luna_weekly_goals")
    .insert(insert)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    console.error("[luna/weekly-goals] insert", error);
    return null;
  }
  const row = mapGoalRow(data as Record<string, unknown>);
  const actionRef = await convertGoalToAction(admin, row);
  await persistActionRef(admin, row.id, actionRef);
  return { ...row, action_ref: actionRef, metric_baseline: baseline };
}

export function defaultActionForDraft(draft: Omit<GoalDraft, "action_type">): GoalActionType {
  if (draft.owner === "human") return "dev";
  const key = draft.metric_key;
  if (
    key === "search_zero_count" ||
    key === "correction_count" ||
    key === "thumbs_down_count" ||
    key === "clarify_unresolved"
  ) {
    return "selfstudy";
  }
  if (key === "eval_light_score") return "prompt";
  return "none";
}

export function parseGoalDrafts(raw: unknown): GoalDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: GoalDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const goal = typeof row.goal === "string" ? row.goal.trim() : "";
    if (!goal) continue;
    const owner: GoalOwner = row.owner === "human" ? "human" : "luna";
    const metric_key = isMetricKey(row.metric_key) ? row.metric_key : null;
    const action_type: GoalActionType =
      row.action_type === "prompt" ||
      row.action_type === "selfstudy" ||
      row.action_type === "dev" ||
      row.action_type === "none"
        ? row.action_type
        : defaultActionForDraft({
            goal,
            reason: typeof row.reason === "string" ? row.reason : "",
            owner,
            metric_key,
            metric_baseline: num(row.metric_baseline ?? row.baseline),
            metric_target: num(row.metric_target ?? row.target)
          });
    out.push({
      goal,
      reason: typeof row.reason === "string" ? row.reason.trim() : "",
      owner,
      metric_key,
      metric_baseline: num(row.metric_baseline ?? row.baseline),
      metric_target: num(row.metric_target ?? row.target),
      action_type
    });
    if (out.length >= 2) break;
  }
  return out;
}

export function ensureLunaGoal(
  drafts: GoalDraft[],
  metrics: Partial<Record<MetricKey, number | null>>
): GoalDraft[] {
  const luna = drafts.filter((d) => d.owner === "luna").slice(0, 1);
  const human = drafts.filter((d) => d.owner === "human").slice(0, 1);
  if (luna.length === 0) {
    const baseline = metrics.search_zero_count ?? 0;
    const target = Math.max(0, Math.floor(baseline / 2));
    luna.push({
      goal:
        baseline > 0
          ? `검색 0건 사례를 ${baseline}건에서 ${target}건 이하로 줄이기`
          : "검색 0건 사례가 생기지 않게 유지하기",
      reason: "측정 가능한 약점부터 줄인다.",
      owner: "luna",
      metric_key: "search_zero_count",
      metric_baseline: baseline,
      metric_target: target,
      action_type: "selfstudy"
    });
  }
  return [...luna, ...human];
}

export async function saveGoalsForWeek(
  admin: SupabaseClient,
  mondayDate: string,
  drafts: GoalDraft[],
  source: GoalSource
): Promise<WeeklyGoalRow[]> {
  const saved: WeeklyGoalRow[] = [];
  for (const draft of drafts) {
    const row = await insertWeeklyGoal(admin, mondayDate, draft, source);
    if (row) saved.push(row);
  }
  return saved;
}

export async function dropOpenGoalsForWeek(
  admin: SupabaseClient,
  mondayDate: string
): Promise<number> {
  const { data, error } = await admin
    .from("luna_weekly_goals")
    .update({
      status: "dropped",
      result_note: "사람이 다른 목표로 바꿈",
      verified_at: new Date().toISOString()
    })
    .eq("week_start", mondayDate)
    .eq("status", "open")
    .select("id");
  if (error) {
    console.error("[luna/weekly-goals] drop", error);
    return 0;
  }
  return data?.length ?? 0;
}

export async function snapshotMetrics(
  admin: SupabaseClient,
  mondayDate: string
): Promise<Partial<Record<MetricKey, number | null>>> {
  const { startIso, endIso } = weekUtcRange(mondayDate);
  const out: Partial<Record<MetricKey, number | null>> = {};
  await Promise.all(
    METRIC_KEYS.map(async (key) => {
      out[key] = await computeMetric(admin, key, startIso, endIso);
    })
  );
  return out;
}

export async function listOpenSelfstudyGoals(
  admin: SupabaseClient
): Promise<WeeklyGoalRow[]> {
  const monday = kstMondayDate();
  const rows = await listGoalsForWeek(admin, monday);
  return rows.filter(
    (g) => g.status === "open" && g.action_type === "selfstudy"
  );
}
