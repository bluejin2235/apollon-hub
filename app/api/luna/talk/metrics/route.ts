import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  analyzeAssistantMessage,
  asMessageMeta,
  emptySignals,
  kstDateRange,
  mergeSignals,
  weekBucketsInRange
} from "@/lib/luna/talk-metrics";
import { getCurrentWeekBounds } from "@/lib/luna/trace-weekly";

export const runtime = "nodejs";

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

function deltaLabel(current: number | null, prev: number | null, unit: string): {
  text: string;
  tone: "up" | "down" | "flat";
} | null {
  if (current == null || prev == null) return null;
  const diff = current - prev;
  if (diff === 0) return { text: "— 유지", tone: "flat" };
  const sign = diff > 0 ? "▲" : "▼";
  return {
    text: `${sign} ${Math.abs(diff)}${unit}`,
    tone: diff > 0 ? "up" : "down"
  };
}

function barHeights(values: number[]): number[] {
  const max = Math.max(1, ...values);
  return values.map((v) => Math.max(8, Math.round((v / max) * 100)));
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const period = request.nextUrl.searchParams.get("period") ?? "4w";
  let startIso: string;
  let endIso: string;
  if (period === "7d") {
    const r = kstDateRange(7);
    startIso = r.startIso;
    endIso = r.endIso;
  } else if (period === "all") {
    startIso = "2020-01-01T00:00:00+09:00";
    endIso = new Date().toISOString();
  } else {
    const r = kstDateRange(28);
    startIso = r.startIso;
    endIso = r.endIso;
  }

  const weeks = weekBucketsInRange(startIso, endIso);
  const weeklyRows: Array<{
    label: string;
    conversations: number;
    clarify: number;
    search_zero: number;
    requery: number;
    assume: number;
    assistant_total: number;
    search_turns: number;
  }> = [];

  for (const w of weeks) {
    const [{ count: convCount }, { data: messages }] = await Promise.all([
      admin
        .from("luna_conversations")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", w.startIso)
        .lt("updated_at", w.endIso),
      admin
        .from("luna_messages")
        .select("content, metadata")
        .eq("role", "assistant")
        .gte("created_at", w.startIso)
        .lt("created_at", w.endIso)
        .limit(3000)
    ]);

    let signals = emptySignals();
    let searchTurns = 0;
    for (const row of messages ?? []) {
      const meta = asMessageMeta(row.metadata);
      const content = typeof row.content === "string" ? row.content : "";
      signals = mergeSignals(signals, analyzeAssistantMessage(content, meta));
      if ("cards" in meta) searchTurns += 1;
    }

    weeklyRows.push({
      label: w.label,
      conversations: convCount ?? 0,
      clarify: signals.clarify,
      search_zero: signals.searchZero,
      requery: signals.requery,
      assume: signals.assume,
      assistant_total: (messages ?? []).length,
      search_turns: searchTurns
    });
  }

  const current = weeklyRows[weeklyRows.length - 1];
  const prev = weeklyRows.length > 1 ? weeklyRows[weeklyRows.length - 2] : null;

  const totalAssistant = current?.assistant_total ?? 0;
  const searchTurns = current?.search_turns ?? 0;
  const clarifyPct =
    current && current.assistant_total > 0
      ? Math.round((current.clarify / current.assistant_total) * 100)
      : null;
  const prevClarifyPct =
    prev && prev.assistant_total > 0
      ? Math.round((prev.clarify / prev.assistant_total) * 100)
      : null;
  const requeryPct =
    current && searchTurns > 0
      ? Math.round((current.requery / searchTurns) * 100)
      : null;
  const prevRequeryPct =
    prev && prev.search_turns > 0
      ? Math.round((prev.requery / prev.search_turns) * 100)
      : null;

  const metrics = [
    {
      key: "clarify",
      title: "되물음률",
      value: clarifyPct != null ? `${clarifyPct}%` : "—",
      delta: deltaLabel(clarifyPct, prevClarifyPct, "%p"),
      desc: "모르면 묻는 비율 — 초기에는 오를수록 좋음",
      barClass: "g",
      bars: barHeights(weeklyRows.map((w) =>
        w.assistant_total > 0 ? Math.round((w.clarify / w.assistant_total) * 100) : 0
      ))
    },
    {
      key: "search_zero",
      title: "검색 0건",
      value: current ? `${current.search_zero}회` : "—",
      delta: deltaLabel(current?.search_zero ?? null, prev?.search_zero ?? null, "회"),
      desc: "못 찾은 질문 — 자습 재료가 됨",
      barClass: "c",
      bars: barHeights(weeklyRows.map((w) => w.search_zero))
    },
    {
      key: "requery",
      title: "재검색 발생",
      value: requeryPct != null ? `${requeryPct}%` : "—",
      delta: deltaLabel(requeryPct, prevRequeryPct, "%p"),
      desc: "1차 검색이 부족해 다시 찾은 비율",
      barClass: "p",
      bars: barHeights(weeklyRows.map((w) =>
        w.search_turns > 0 ? Math.round((w.requery / w.search_turns) * 100) : 0
      ))
    },
    {
      key: "assume",
      title: "가정 확인",
      value: current ? `${current.assume}회` : "—",
      delta: deltaLabel(current?.assume ?? null, prev?.assume ?? null, "회"),
      desc: "숨은 가정을 드러낸 횟수",
      barClass: "a",
      bars: barHeights(weeklyRows.map((w) => w.assume))
    }
  ].filter((m) => m.bars.some((h) => h > 8) || m.value !== "—");

  const { weekStart } = getCurrentWeekBounds();
  const correctionCount =
    current && current.assume > 0
      ? await (async () => {
          const w = weeks[weeks.length - 1];
          if (!w) return null;
          const { data } = await admin
            .from("luna_learnings")
            .select("meta")
            .gte("created_at", w.startIso)
            .lt("created_at", w.endIso)
            .neq("category", "identity")
            .limit(200);
          let n = 0;
          for (const row of data ?? []) {
            const meta =
              row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
                ? (row.meta as Record<string, unknown>)
                : {};
            if (meta.from_correction === true) n += 1;
          }
          return n;
        })()
      : null;

  const assumeMetric = metrics.find((m) => m.key === "assume");
  if (assumeMetric && correctionCount != null) {
    assumeMetric.desc = `숨은 가정을 드러낸 횟수 · 정정 유발 ${correctionCount}회`;
  }

  return NextResponse.json({
    period,
    week_start: weekStart,
    metrics,
    weekly_summary: weeklyRows
      .slice()
      .reverse()
      .map((w) => ({
        label: w.label,
        conversations: w.conversations,
        clarify: w.clarify,
        search_zero: w.search_zero,
        requery: w.requery,
        assume: w.assume
      }))
  });
}
