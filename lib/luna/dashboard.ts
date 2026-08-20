import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysYmd, kstYmd } from "@/lib/luna/knowledge-sources";
import { kstWeekBounds } from "@/lib/luna/self-report";
import { getSelfUpgradeStatus } from "@/lib/luna/self-upgrade";
import {
  countTodayStuckMoments,
  getSelfstudyStatus,
  kstDayBounds
} from "@/lib/luna/selfstudy";
import { countOpenFailures } from "@/lib/luna/failures";
import type { LunaDashboard } from "@/lib/luna/dashboard-types";

export type { LunaDashboard } from "@/lib/luna/dashboard-types";

function dayBoundsOffset(daysAgo: number): { startIso: string; endIso: string } {
  return kstDayBounds(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
}

function formatKstDate(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const d = kst.getUTCDate();
  const wd = ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()] ?? "";
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${wd})`;
}

function nextSelfstudyLabel(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const h = kst.getUTCHours();
  const nextDay = h >= 3 ? d + 1 : d;
  const next = new Date(Date.UTC(y, m, nextDay, 3, 0, 0) - 9 * 60 * 60 * 1000);
  const nk = new Date(next.getTime() + 9 * 60 * 60 * 1000);
  const labelDay = h >= 3 ? "내일" : "오늘";
  return `${labelDay} ${String(nk.getUTCMonth() + 1).padStart(2, "0")}.${String(nk.getUTCDate()).padStart(2, "0")} 03:00`;
}

function weekSliceBounds(weeksAgo: number): { startIso: string; endIso: string } {
  const w = kstWeekBounds();
  const ms = 7 * 24 * 60 * 60 * 1000;
  const start = new Date(new Date(w.startIso).getTime() - weeksAgo * ms);
  return {
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + ms).toISOString()
  };
}

async function scanAssistantMeta(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<{
  thumbsUp: number;
  thumbsDown: number;
  clarify: number;
  searchZero: number;
  requery: number;
  assume: number;
}> {
  const { data, error } = await admin
    .from("luna_messages")
    .select("content, metadata")
    .eq("role", "assistant")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .limit(2000);
  if (error) {
    console.error("[luna/dashboard] messages", error);
    return {
      thumbsUp: 0,
      thumbsDown: 0,
      clarify: 0,
      searchZero: 0,
      requery: 0,
      assume: 0
    };
  }
  let thumbsUp = 0;
  let thumbsDown = 0;
  let clarify = 0;
  let searchZero = 0;
  let requery = 0;
  let assume = 0;
  for (const row of data ?? []) {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : null;
    const content = typeof row.content === "string" ? row.content : "";
    if (meta?.feedback === "good") thumbsUp += 1;
    if (meta?.feedback === "bad") thumbsDown += 1;
    if (meta?.clarify) clarify += 1;
    if (
      meta &&
      "cards" in meta &&
      Array.isArray(meta.cards) &&
      meta.cards.length === 0
    ) {
      searchZero += 1;
    }
    if (
      typeof meta?.search_rounds === "number" &&
      meta.search_rounds >= 2
    ) {
      requery += 1;
    }
    if (/\[\[\s*가정\s*:/.test(content)) assume += 1;
  }
  return { thumbsUp, thumbsDown, clarify, searchZero, requery, assume };
}

async function countCorrections(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<number> {
  const { data, error } = await admin
    .from("luna_learnings")
    .select("meta, thread")
    .or(
      `and(resolved_at.gte."${startIso}",resolved_at.lt."${endIso}"),and(created_at.gte."${startIso}",created_at.lt."${endIso}")`
    )
    .neq("category", "identity")
    .limit(500);
  if (error) {
    console.error("[luna/dashboard] corrections", error);
    return 0;
  }
  let n = 0;
  for (const row of data ?? []) {
    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
    const thread = Array.isArray(row.thread) ? row.thread : [];
    const hasHuman = thread.some(
      (t) =>
        t &&
        typeof t === "object" &&
        (t as { role?: string }).role === "human"
    );
    if (meta.from_correction === true || hasHuman) n += 1;
  }
  return n;
}

async function topTalkUsersYesterday(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<LunaDashboard["talk"]["top_users_yesterday"]> {
  const { data, error } = await admin
    .from("luna_conversations")
    .select("user_id")
    .gte("updated_at", startIso)
    .lt("updated_at", endIso)
    .limit(3000);
  if (error) {
    console.error("[luna/dashboard] top users", error);
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const uid = typeof row.user_id === "string" ? row.user_id : "";
    if (!uid) continue;
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (top.length === 0) return [];

  const ids = top.map(([id]) => id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name")
    .in("id", ids);

  const nameById = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      typeof p.name === "string" && p.name.trim() ? p.name.trim() : "—"
    ])
  );

  return top.map(([user_id, count], index) => ({
    rank: index + 1,
    user_id,
    name: nameById.get(user_id) ?? "—",
    count
  }));
}

async function countBySource(admin: SupabaseClient) {
  const out = { chat: 0, selfstudy: 0, question: 0, direct: 0 };
  await Promise.all(
    (["chat", "selfstudy", "question", "direct"] as const).map(async (source) => {
      const { count } = await admin
        .from("luna_learnings")
        .select("id", { count: "exact", head: true })
        .eq("status", "candidate")
        .eq("source", source)
        .neq("category", "identity");
      out[source] = count ?? 0;
    })
  );
  return out;
}

async function countGlossaryTerms(
  admin: SupabaseClient
): Promise<number | null> {
  const { count, error } = await admin
    .from("glossary_terms")
    .select("id", { count: "exact", head: true });
  if (error) {
    console.warn("[luna/dashboard] glossary_terms", error.message);
    return null;
  }
  return count ?? 0;
}

function formatSourcesLatestLabel(
  spokenAt: string | null | undefined,
  createdAt: string | null | undefined
): string | null {
  let ymd: string | null = null;
  if (typeof spokenAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(spokenAt)) {
    ymd = spokenAt;
  } else if (typeof createdAt === "string") {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) ymd = kstYmd(d);
  }
  if (!ymd) return null;
  const today = kstYmd();
  const yesterday = addDaysYmd(today, -1);
  if (ymd === today) return "오늘";
  if (ymd === yesterday) return "어제";
  const [, m, d] = ymd.split("-");
  return `${m}.${d}`;
}

async function loadTalkSourcesStats(admin: SupabaseClient): Promise<{
  count: number | null;
  latest_label: string | null;
}> {
  const { count, error: countError } = await admin
    .from("luna_knowledge_sources")
    .select("id", { count: "exact", head: true });
  if (countError) {
    console.warn("[luna/dashboard] knowledge_sources", countError.message);
    return { count: null, latest_label: null };
  }
  const { data: latestRows, error: latestError } = await admin
    .from("luna_knowledge_sources")
    .select("spoken_at, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (latestError) {
    console.warn("[luna/dashboard] knowledge_sources latest", latestError.message);
    return { count: count ?? 0, latest_label: null };
  }
  let bestSpoken: string | null = null;
  let bestCreated: string | null = null;
  for (const row of latestRows ?? []) {
    const spoken =
      typeof row.spoken_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.spoken_at)
        ? row.spoken_at
        : null;
    const created =
      typeof row.created_at === "string" ? row.created_at : null;
    if (spoken && (!bestSpoken || spoken > bestSpoken)) bestSpoken = spoken;
    if (created && (!bestCreated || created > bestCreated)) bestCreated = created;
  }
  return {
    count: count ?? 0,
    latest_label: formatSourcesLatestLabel(bestSpoken, bestCreated)
  };
}

async function avgConfirmDays(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<number | null> {
  const { data, error } = await admin
    .from("luna_learnings")
    .select("created_at, resolved_at")
    .eq("status", "active")
    .gte("resolved_at", startIso)
    .lt("resolved_at", endIso)
    .neq("category", "identity")
    .limit(200);
  if (error || !data?.length) return null;
  let sum = 0;
  let n = 0;
  for (const row of data) {
    if (typeof row.created_at !== "string" || typeof row.resolved_at !== "string")
      continue;
    const ms =
      new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime();
    if (!Number.isFinite(ms) || ms < 0) continue;
    sum += ms / (24 * 60 * 60 * 1000);
    n += 1;
  }
  if (n === 0) return null;
  return Math.round((sum / n) * 10) / 10;
}

export async function buildLunaDashboard(
  admin: SupabaseClient,
  userId: string
): Promise<LunaDashboard> {
  const today = kstDayBounds();
  const yesterday = dayBoundsOffset(1);
  const week = kstWeekBounds();

  const [
    activeCountRes,
    weekNewRes,
    orgRes,
    personalRes,
    conflictRes,
    topUsedRes,
    latestConfirmedRes,
    nasTotalRes,
    nasSettingsRes,
    convTodayRes,
    convYdayRes,
    usersTodayRes,
    profilesRes,
    pendingCandRes,
    confirmedTodayRes,
    mineRes,
    selfstudyYdayRes,
    selfstudyActiveRes,
    selfstudyDoneRes,
    notNeededRes,
    recentSelfstudyRes,
    promptsActiveRes,
    versionsWeekRes,
    usageWeekRes,
    usagePrevRes,
    tiersRes,
    stuckToday,
    selfstudyStatus,
    upgradeStatus,
    talkToday,
    talkYday,
    corrToday,
    corrYday,
    sourceCounts,
    avgConfirm,
    topUsersYday,
    glossaryCount,
    talkSources
  ] = await Promise.all([
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .neq("category", "identity")
      .gte("resolved_at", week.startIso)
      .lt("resolved_at", week.endIso),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("scope_suggestion", "org")
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("scope_suggestion", "personal")
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "conflict")
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("content, use_count")
      .eq("status", "active")
      .neq("category", "identity")
      .order("use_count", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("luna_learnings")
      .select("content, resolved_at")
      .eq("status", "active")
      .neq("category", "identity")
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("nas_directory").select("id", { count: "exact", head: true }),
    admin.from("nas_scan_settings").select("last_total").eq("id", 1).maybeSingle(),
    admin
      .from("luna_conversations")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", today.startIso)
      .lt("updated_at", today.endIso),
    admin
      .from("luna_conversations")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", yesterday.startIso)
      .lt("updated_at", yesterday.endIso),
    admin
      .from("luna_conversations")
      .select("user_id")
      .gte("updated_at", today.startIso)
      .lt("updated_at", today.endIso)
      .limit(500),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "candidate")
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gte("resolved_at", today.startIso)
      .lt("resolved_at", today.endIso)
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "candidate")
      .eq("assigned_to", userId)
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("source", "selfstudy")
      .gte("created_at", yesterday.startIso)
      .lt("created_at", yesterday.endIso),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("source", "selfstudy")
      .eq("status", "active"),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("source", "selfstudy")
      .in("status", ["active", "archived"]),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "archived")
      .contains("meta", { not_needed: true })
      .gte("resolved_at", week.startIso)
      .lt("resolved_at", week.endIso),
    admin
      .from("luna_learnings")
      .select("meta, content, created_at")
      .eq("source", "selfstudy")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("luna_prompts")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    admin
      .from("luna_prompt_versions")
      .select("changed_by_luna")
      .eq("target_type", "prompt")
      .gte("created_at", week.startIso)
      .lt("created_at", week.endIso)
      .limit(500),
    admin
      .from("luna_usage_daily")
      .select("input_tokens, output_tokens")
      .gte("date", week.startIso.slice(0, 10))
      .lt("date", week.endIso.slice(0, 10)),
    admin
      .from("luna_usage_daily")
      .select("input_tokens, output_tokens")
      .gte("date", week.prevStartIso.slice(0, 10))
      .lt("date", week.prevEndIso.slice(0, 10)),
    admin
      .from("luna_engine_tiers")
      .select("tier, model_label")
      .order("tier", { ascending: true }),
    countTodayStuckMoments(admin),
    getSelfstudyStatus(admin),
    getSelfUpgradeStatus(admin),
    scanAssistantMeta(admin, today.startIso, today.endIso),
    scanAssistantMeta(admin, yesterday.startIso, yesterday.endIso),
    countCorrections(admin, today.startIso, today.endIso),
    countCorrections(admin, yesterday.startIso, yesterday.endIso),
    countBySource(admin),
    avgConfirmDays(admin, week.startIso, week.endIso),
    topTalkUsersYesterday(admin, yesterday.startIso, yesterday.endIso),
    countGlossaryTerms(admin),
    loadTalkSourcesStats(admin)
  ]);

  const weeklyInflow: number[] = [];
  for (let w = 3; w >= 0; w -= 1) {
    const b = weekSliceBounds(w);
    const { count } = await admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .gte("created_at", b.startIso)
      .lt("created_at", b.endIso)
      .neq("category", "identity");
    weeklyInflow.push(count ?? 0);
  }

  let trend: LunaDashboard["candidates"]["trend"] = "unknown";
  let trend_label = "";
  if (weeklyInflow.length >= 2) {
    const prev = weeklyInflow[weeklyInflow.length - 2] ?? 0;
    const cur = weeklyInflow[weeklyInflow.length - 1] ?? 0;
    if (cur < prev) {
      trend = "down";
      trend_label = "유입 ↓ 성장 신호";
    } else if (cur > prev) {
      trend = "up";
      trend_label = "유입 증가 — 원인 점검";
    } else {
      trend = "flat";
      trend_label = "유입 보합";
    }
  }

  const activeUsers = new Set(
    (usersTodayRes.data ?? [])
      .map((r) => r.user_id as string)
      .filter(Boolean)
  ).size;

  const selfstudyActive = selfstudyActiveRes.count ?? 0;
  const selfstudyDone = selfstudyDoneRes.count ?? 0;
  const accuracy =
    selfstudyDone > 0
      ? Math.round((selfstudyActive / selfstudyDone) * 1000) / 10
      : null;

  let recentTopic: string | null = null;
  const rs = recentSelfstudyRes.data;
  if (rs?.meta && typeof rs.meta === "object" && !Array.isArray(rs.meta)) {
    const t = (rs.meta as Record<string, unknown>).topic;
    if (typeof t === "string" && t.trim()) recentTopic = t.trim();
  }
  if (!recentTopic && typeof rs?.content === "string") {
    recentTopic = rs.content.slice(0, 40);
  }
  if (!recentTopic && selfstudyStatus.last_run?.message) {
    recentTopic = selfstudyStatus.last_run.message.slice(0, 40);
  }

  let weekLuna = 0;
  let weekHuman = 0;
  for (const v of versionsWeekRes.data ?? []) {
    if (v.changed_by_luna) weekLuna += 1;
    else weekHuman += 1;
  }

  const sumTokens = (
    rows: { input_tokens?: number | null; output_tokens?: number | null }[] | null
  ) =>
    (rows ?? []).reduce(
      (s, r) => s + (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0),
      0
    );
  const tokensWeek = sumTokens(usageWeekRes.data);
  const tokensPrev = sumTokens(usagePrevRes.data);
  const tokensDelta = tokensWeek - tokensPrev;
  const tokensDeltaPct =
    tokensPrev > 0
      ? Math.round((tokensDelta / tokensPrev) * 1000) / 10
      : null;

  const models = (tiersRes.data ?? []).map((t) => ({
    tier: String(t.tier),
    label: typeof t.model_label === "string" ? t.model_label : String(t.tier)
  }));
  if (models.length === 0) {
    models.push(
      { tier: "A", label: "Claude Sonnet 4.6" },
      { tier: "B", label: "Claude Sonnet 4.6" },
      { tier: "C", label: "Claude Sonnet 4.6" }
    );
  }

  let latestUpgrade: LunaDashboard["brain"]["latest_upgrade"] = null;
  const { data: lastUp } = await admin
    .from("luna_prompt_versions")
    .select("change_summary, prediction, verify_result, target_id")
    .eq("changed_by_luna", true)
    .eq("target_type", "prompt")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastUp) {
    let title = "프롬프트";
    if (typeof lastUp.target_id === "string") {
      const { data: p } = await admin
        .from("luna_prompts")
        .select("title")
        .eq("id", lastUp.target_id)
        .maybeSingle();
      if (typeof p?.title === "string") title = p.title;
    }
    latestUpgrade = {
      title,
      reason:
        typeof lastUp.change_summary === "string"
          ? lastUp.change_summary
          : null,
      prediction:
        typeof lastUp.prediction === "string" ? lastUp.prediction : null,
      verify_result:
        typeof lastUp.verify_result === "string" ? lastUp.verify_result : null
    };
  }

  const myTurn = mineRes.count ?? 0;
  const failuresOpen = await countOpenFailures(admin);

  return {
    generated_at: new Date().toISOString(),
    date_label: formatKstDate(),
    my_turn_count: myTurn,
    knowledge: {
      has_summary_layer: false,
      active_count: activeCountRes.count ?? 0,
      week_new: weekNewRes.count ?? 0,
      org_count: orgRes.count ?? 0,
      personal_count: personalRes.count ?? 0,
      glossary_count: glossaryCount,
      nas_indexed: nasTotalRes.count ?? 0,
      nas_last_total:
        typeof nasSettingsRes.data?.last_total === "number"
          ? nasSettingsRes.data.last_total
          : null,
      notion_connected: Boolean(process.env.NOTION_TOKEN?.trim()),
      conflict_count: conflictRes.count ?? 0,
      top_used:
        topUsedRes.data && typeof topUsedRes.data.content === "string"
          ? {
              content: topUsedRes.data.content,
              use_count: Number(topUsedRes.data.use_count) || 0
            }
          : null,
      latest_confirmed:
        latestConfirmedRes.data &&
        typeof latestConfirmedRes.data.content === "string"
          ? {
              content: latestConfirmedRes.data.content,
              resolved_at:
                typeof latestConfirmedRes.data.resolved_at === "string"
                  ? latestConfirmedRes.data.resolved_at
                  : null
            }
          : null
    },
    talk: {
      conversations_today: convTodayRes.count ?? 0,
      conversations_yesterday: convYdayRes.count ?? 0,
      active_users_today: activeUsers,
      total_users: profilesRes.count ?? 0,
      thumbs_up_today: talkToday.thumbsUp,
      thumbs_down_today: talkToday.thumbsDown,
      clarify_today: talkToday.clarify,
      clarify_yesterday: talkYday.clarify,
      corrections_today: corrToday,
      corrections_yesterday: corrYday,
      search_zero_today: talkToday.searchZero,
      requery_today: talkToday.requery,
      assume_today: talkToday.assume,
      sources_count: talkSources.count,
      sources_latest_label: talkSources.latest_label,
      top_users_yesterday: topUsersYday
    },
    candidates: {
      pending: pendingCandRes.count ?? 0,
      confirmed_today: confirmedTodayRes.count ?? 0,
      weekly_inflow: weeklyInflow,
      trend,
      trend_label,
      by_source: sourceCounts,
      avg_confirm_days: avgConfirm,
      my_turn: myTurn
    },
    selfstudy: {
      yesterday_submitted: selfstudyYdayRes.count ?? 0,
      accuracy_pct: accuracy,
      stuck_today: stuckToday,
      next_run_label: nextSelfstudyLabel(),
      recent_topic: recentTopic,
      not_needed_week: notNeededRes.count ?? 0
    },
    brain: {
      active_prompts: promptsActiveRes.count ?? 0,
      week_changes_luna: weekLuna,
      week_changes_human: weekHuman,
      revert_pending: upgradeStatus.revert_suggestion ? 1 : 0,
      latest_upgrade: latestUpgrade,
      models,
      tokens_week: tokensWeek,
      tokens_prev_week: tokensPrev,
      tokens_delta: tokensDelta,
      tokens_delta_pct: tokensDeltaPct
    },
    failures: {
      open: failuresOpen
    }
  };
}
