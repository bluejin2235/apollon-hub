import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  countCandidateInflow,
  countWeeklyCorrections,
  formatEvalScoreLine,
  loadLatestEvalTierScores
} from "@/lib/luna/self-report";

export const runtime = "nodejs";

export type ReportItem = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  week_label: string;
  confirmed_count: number | null;
  inflow: number | null;
  inflow_confirmed: number | null;
  inflow_pending: number | null;
  inflow_archived: number | null;
  inflow_prev: number | null;
  correction_count: number | null;
  eval_score_line: string | null;
};

function metaOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** "8월 2주차" — 해당 주가 그 달의 몇 번째 주인지 (KST) */
function weekLabel(iso: string | null): string {
  if (!iso) return "성장 보고";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "성장 보고";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const month = kst.getUTCMonth() + 1;
  const nth = Math.floor((kst.getUTCDate() - 1) / 7) + 1;
  return `${month}월 ${nth}주차 성장 보고`;
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("hub_notifications")
    .select("id, title, body, meta, created_at")
    .eq("category", "luna_report")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[luna/brain/reports] list", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const evalScores = await loadLatestEvalTierScores(admin);
  const evalLine = formatEvalScoreLine(evalScores);

  const items: ReportItem[] = [];
  for (const [index, row] of (data ?? []).entries()) {
    const meta = metaOf(row.meta);
    const publishedAt =
      typeof row.created_at === "string" ? row.created_at : new Date().toISOString();
    const weekStart =
      typeof meta.week_start === "string" ? meta.week_start : null;
    const weekEnd = typeof meta.week_end === "string" ? meta.week_end : null;

    let inflow = num(meta.candidate_inflow_this_week);
    let inflowConfirmed = num(meta.candidate_inflow_confirmed);
    let inflowPending = num(meta.candidate_inflow_pending);
    let inflowArchived = num(meta.candidate_inflow_archived);
    let inflowPrev = num(meta.candidate_inflow_prev_week);
    let correctionCount = num(meta.top_correction_count);

    if (weekStart && weekEnd) {
      const [inflowStats, corrections] = await Promise.all([
        countCandidateInflow(admin, weekStart, weekEnd),
        countWeeklyCorrections(admin, weekStart, weekEnd)
      ]);
      inflow = inflowStats.total;
      inflowConfirmed = inflowStats.confirmed;
      inflowPending = inflowStats.pending;
      inflowArchived = inflowStats.archived;
      correctionCount = corrections.total;
      const prevStart = new Date(
        new Date(weekStart).getTime() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();
      const prevStats = await countCandidateInflow(admin, prevStart, weekStart);
      inflowPrev = prevStats.total;
    }

    items.push({
      id: row.id as string,
      title: typeof row.title === "string" ? row.title : "루나 주간 성장 보고",
      body: typeof row.body === "string" ? row.body : "",
      published_at: publishedAt,
      week_label: weekLabel(weekStart ?? publishedAt),
      confirmed_count: num(meta.confirmed_count),
      inflow,
      inflow_confirmed: inflowConfirmed,
      inflow_pending: inflowPending,
      inflow_archived: inflowArchived,
      inflow_prev: inflowPrev,
      correction_count: correctionCount,
      eval_score_line: index === 0 ? evalLine : null
    });
  }

  return NextResponse.json({
    latest: items[0] ?? null,
    past: items.slice(1)
  });
}
