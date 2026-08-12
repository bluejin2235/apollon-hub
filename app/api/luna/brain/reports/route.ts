import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

export type ReportItem = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  week_label: string;
  confirmed_count: number | null;
  inflow: number | null;
  inflow_prev: number | null;
  correction_count: number | null;
  eval_passed: number | null;
  eval_total: number | null;
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

  // 시험 점수는 보고 meta 에 없으므로 최근 완료된 회귀 시험에서 가져온다
  const { data: runs } = await admin
    .from("luna_eval_runs")
    .select("passed, total, finished_at")
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1);
  const latestRun = runs?.[0] ?? null;

  const items: ReportItem[] = (data ?? []).map((row, index) => {
    const meta = metaOf(row.meta);
    const publishedAt =
      typeof row.created_at === "string" ? row.created_at : new Date().toISOString();
    return {
      id: row.id as string,
      title: typeof row.title === "string" ? row.title : "루나 주간 성장 보고",
      body: typeof row.body === "string" ? row.body : "",
      published_at: publishedAt,
      week_label: weekLabel(
        typeof meta.week_start === "string" ? meta.week_start : publishedAt
      ),
      confirmed_count: num(meta.confirmed_count),
      inflow: num(meta.candidate_inflow_this_week),
      inflow_prev: num(meta.candidate_inflow_prev_week),
      correction_count: num(meta.top_correction_count),
      // 최신 보고에만 현재 시험 점수를 붙인다 (과거 시점 점수는 보관돼 있지 않음)
      eval_passed: index === 0 ? num(latestRun?.passed) : null,
      eval_total: index === 0 ? num(latestRun?.total) : null
    };
  });

  return NextResponse.json({
    latest: items[0] ?? null,
    past: items.slice(1)
  });
}
