import type { SupabaseClient } from "@supabase/supabase-js";

export type TraceFailure = {
  question: string;
  reason: string;
  created_at: string;
};

export type LunaTraceWeeklyRow = {
  week_start: string;
  total_turns: number;
  search_turns: number;
  zero_result_turns: number;
  requery_turns: number;
  clarify_turns: number;
  thumbs_down: number;
  avg_duration_ms: number | null;
  top_failures: TraceFailure[];
  generated_at: string;
};

type MsgRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function kstYmd(d = new Date()): {
  y: number;
  m: number;
  day: number;
  dow: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    day: Number(get("day")),
    dow: weekdayMap[get("weekday")] ?? 0
  };
}

function addCalendarDays(
  y: number,
  m: number,
  day: number,
  delta: number
): { y: number; m: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, day + delta));
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    day: dt.getUTCDate()
  };
}

function formatYmd(y: number, m: number, day: number): string {
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

/** 이번 주(월~일, KST) 경계 */
export function getCurrentWeekBounds(now = new Date()): {
  weekStart: string;
  startIso: string;
  endIso: string;
} {
  const { y, m, day, dow } = kstYmd(now);
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const mon = addCalendarDays(y, m, day, mondayOffset);
  const nextMon = addCalendarDays(mon.y, mon.m, mon.day, 7);
  const weekStart = formatYmd(mon.y, mon.m, mon.day);
  const nextStart = formatYmd(nextMon.y, nextMon.m, nextMon.day);
  return {
    weekStart,
    startIso: `${weekStart}T00:00:00+09:00`,
    endIso: `${nextStart}T00:00:00+09:00`
  };
}

function asMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function failureReason(meta: Record<string, unknown>): string | null {
  if (meta.feedback === "bad") return "싫어요";
  if (Array.isArray(meta.cards) && meta.cards.length === 0) return "결과없음";
  if (
    typeof meta.search_rounds === "number" &&
    Number.isFinite(meta.search_rounds) &&
    meta.search_rounds >= 3
  ) {
    return "재검색과다";
  }
  return null;
}

function findPrevUserQuestion(
  messages: MsgRow[],
  assistant: MsgRow
): string {
  let best: MsgRow | null = null;
  for (const m of messages) {
    if (m.conversation_id !== assistant.conversation_id) continue;
    if (m.role !== "user") continue;
    if (m.created_at >= assistant.created_at) continue;
    if (!best || m.created_at > best.created_at) best = m;
  }
  const text = (best?.content ?? "").trim().replace(/\s+/g, " ");
  return text.slice(0, 60);
}

export async function runWeeklyTraceAggregation(
  admin: SupabaseClient,
  now = new Date()
): Promise<LunaTraceWeeklyRow> {
  const { weekStart, startIso, endIso } = getCurrentWeekBounds(now);

  const { data: assistantData, error: assistantError } = await admin
    .from("luna_messages")
    .select("id, conversation_id, role, content, metadata, created_at")
    .eq("role", "assistant")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true });

  if (assistantError) {
    console.error("[luna/trace] assistant fetch", assistantError);
    throw new Error(assistantError.message);
  }

  const assistants = (assistantData ?? []) as MsgRow[];
  const convIds = Array.from(
    new Set(assistants.map((m) => m.conversation_id).filter(Boolean))
  );

  let threadMessages: MsgRow[] = [];
  if (convIds.length > 0) {
    const { y, m, day } = kstYmd(new Date(startIso));
    const lookback = addCalendarDays(y, m, day, -7);
    const lookbackIso = `${formatYmd(lookback.y, lookback.m, lookback.day)}T00:00:00+09:00`;

    const { data: threadData, error: threadError } = await admin
      .from("luna_messages")
      .select("id, conversation_id, role, content, metadata, created_at")
      .in("conversation_id", convIds)
      .gte("created_at", lookbackIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true });

    if (threadError) {
      console.error("[luna/trace] thread fetch", threadError);
    } else {
      threadMessages = (threadData ?? []) as MsgRow[];
    }
  }

  let searchTurns = 0;
  let zeroResultTurns = 0;
  let requeryTurns = 0;
  let clarifyTurns = 0;
  let thumbsDown = 0;
  let durationSum = 0;
  let durationCount = 0;
  const topFailures: TraceFailure[] = [];

  for (const msg of assistants) {
    const meta = asMeta(msg.metadata);

    if ("cards" in meta) {
      searchTurns += 1;
      if (Array.isArray(meta.cards) && meta.cards.length === 0) {
        zeroResultTurns += 1;
      }
    }

    if (
      typeof meta.search_rounds === "number" &&
      Number.isFinite(meta.search_rounds) &&
      meta.search_rounds >= 2
    ) {
      requeryTurns += 1;
    }

    if ("clarify" in meta && meta.clarify) {
      clarifyTurns += 1;
    }

    if (meta.feedback === "bad") {
      thumbsDown += 1;
    }

    if (
      typeof meta.duration_ms === "number" &&
      Number.isFinite(meta.duration_ms)
    ) {
      durationSum += meta.duration_ms;
      durationCount += 1;
    }

    const reason = failureReason(meta);
    if (reason && topFailures.length < 10) {
      topFailures.push({
        question: findPrevUserQuestion(threadMessages, msg) || "(질문 없음)",
        reason,
        created_at: msg.created_at
      });
    }
  }

  const avgDuration =
    durationCount > 0 ? Math.round(durationSum / durationCount) : null;

  const row: LunaTraceWeeklyRow = {
    week_start: weekStart,
    total_turns: assistants.length,
    search_turns: searchTurns,
    zero_result_turns: zeroResultTurns,
    requery_turns: requeryTurns,
    clarify_turns: clarifyTurns,
    thumbs_down: thumbsDown,
    avg_duration_ms: avgDuration,
    top_failures: topFailures,
    generated_at: new Date().toISOString()
  };

  const { error: upsertError } = await admin.from("luna_trace_weekly").upsert(
    {
      week_start: row.week_start,
      total_turns: row.total_turns,
      search_turns: row.search_turns,
      zero_result_turns: row.zero_result_turns,
      requery_turns: row.requery_turns,
      clarify_turns: row.clarify_turns,
      thumbs_down: row.thumbs_down,
      avg_duration_ms: row.avg_duration_ms,
      top_failures: row.top_failures,
      generated_at: row.generated_at
    },
    { onConflict: "week_start" }
  );

  if (upsertError) {
    console.error("[luna/trace] upsert", upsertError);
    throw new Error(upsertError.message);
  }

  console.log("[luna/trace] aggregated", row.week_start, {
    total: row.total_turns,
    search: row.search_turns,
    zero: row.zero_result_turns,
    requery: row.requery_turns,
    thumbs_down: row.thumbs_down
  });

  return row;
}

export async function listTraceWeekly(
  admin: SupabaseClient,
  limit = 8
): Promise<LunaTraceWeeklyRow[]> {
  const { data, error } = await admin
    .from("luna_trace_weekly")
    .select(
      "week_start, total_turns, search_turns, zero_result_turns, requery_turns, clarify_turns, thumbs_down, avg_duration_ms, top_failures, generated_at"
    )
    .order("week_start", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[luna/trace] list", error);
    throw new Error(error.message);
  }

  return ((data ?? []) as LunaTraceWeeklyRow[]).map((r) => ({
    ...r,
    top_failures: Array.isArray(r.top_failures) ? r.top_failures : []
  }));
}
