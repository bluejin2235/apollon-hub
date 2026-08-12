import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { sourceLabel } from "@/lib/luna/knowledge-format";
import { kstWeekBounds } from "@/lib/luna/self-report";

export const runtime = "nodejs";

type HistoryFilter = "all" | "confirmed" | "rejected" | "not_needed";

function weekSliceBounds(weeksAgo: number): { startIso: string; endIso: string } {
  const w = kstWeekBounds();
  const ms = 7 * 24 * 60 * 60 * 1000;
  const start = new Date(new Date(w.startIso).getTime() - weeksAgo * ms);
  return {
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + ms).toISOString()
  };
}

function weekLabel(startIso: string): string {
  const d = new Date(startIso);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
}

function isNotNeeded(meta: unknown): boolean {
  return (
    !!meta &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    (meta as Record<string, unknown>).not_needed === true
  );
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

  const filterRaw = request.nextUrl.searchParams.get("filter") ?? "all";
  const filter: HistoryFilter =
    filterRaw === "confirmed" ||
    filterRaw === "rejected" ||
    filterRaw === "not_needed"
      ? filterRaw
      : "all";

  const [
    confirmedRes,
    archivedRes,
    notNeededRes,
    avgRowsRes
  ] = await Promise.all([
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .neq("category", "identity"),
    admin
      .from("luna_learnings")
      .select("id, meta", { count: "exact" })
      .eq("status", "archived")
      .neq("category", "identity")
      .limit(5000),
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "archived")
      .neq("category", "identity")
      .contains("meta", { not_needed: true }),
    admin
      .from("luna_learnings")
      .select("created_at, resolved_at")
      .eq("status", "active")
      .not("resolved_at", "is", null)
      .neq("category", "identity")
      .order("resolved_at", { ascending: false })
      .limit(200)
  ]);

  const confirmedTotal = confirmedRes.count ?? 0;
  const archivedTotal = archivedRes.count ?? 0;
  const notNeededTotal = notNeededRes.count ?? 0;
  const rejectedTotal = Math.max(0, archivedTotal - notNeededTotal);
  const decided = confirmedTotal + rejectedTotal + notNeededTotal;
  const confirmRate =
    decided > 0 ? Math.round((confirmedTotal / decided) * 100) : null;

  let avgConfirmDays: number | null = null;
  const avgRows = avgRowsRes.data ?? [];
  if (avgRows.length > 0) {
    let sum = 0;
    let n = 0;
    for (const row of avgRows) {
      if (typeof row.created_at !== "string" || typeof row.resolved_at !== "string") {
        continue;
      }
      const ms =
        new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime();
      if (!Number.isFinite(ms) || ms < 0) continue;
      sum += ms / (24 * 60 * 60 * 1000);
      n += 1;
    }
    if (n > 0) avgConfirmDays = Math.round((sum / n) * 10) / 10;
  }

  const weeklyInflow: Array<{ label: string; count: number; current: boolean }> = [];
  for (let w = 3; w >= 0; w -= 1) {
    const b = weekSliceBounds(w);
    const { count } = await admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .gte("created_at", b.startIso)
      .lt("created_at", b.endIso)
      .neq("category", "identity");
    weeklyInflow.push({
      label: weekLabel(b.startIso),
      count: count ?? 0,
      current: w === 0
    });
  }

  let trend: "down" | "up" | "flat" | "unknown" = "unknown";
  let trend_label = "";
  if (weeklyInflow.length >= 2) {
    const prev = weeklyInflow[weeklyInflow.length - 2]?.count ?? 0;
    const cur = weeklyInflow[weeklyInflow.length - 1]?.count ?? 0;
    if (cur < prev) {
      trend = "down";
      trend_label = "유입 감소 — 루나가 이미 아는 것이 늘고 있어요";
    } else if (cur > prev) {
      trend = "up";
      trend_label = "유입 증가 — 후보 검토가 필요해요";
    } else {
      trend = "flat";
      trend_label = "유입 보합";
    }
  }

  let listQuery = admin
    .from("luna_learnings")
    .select(
      "id, content, status, source, origin, meta, resolved_at, resolved_by"
    )
    .in("status", ["active", "archived"])
    .neq("category", "identity")
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(80);

  if (filter === "confirmed") {
    listQuery = listQuery.eq("status", "active");
  } else if (filter === "not_needed") {
    listQuery = listQuery
      .eq("status", "archived")
      .contains("meta", { not_needed: true });
  } else if (filter === "rejected") {
    listQuery = listQuery.eq("status", "archived");
  }

  const { data: listRows, error: listError } = await listQuery;
  if (listError) {
    console.error("[luna/candidates/history] list", listError);
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  let rows = listRows ?? [];
  if (filter === "rejected") {
    rows = rows.filter((r) => !isNotNeeded(r.meta));
  }

  const resolverIds = Array.from(
    new Set(
      rows
        .map((r) => r.resolved_by)
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    )
  );
  const nameMap = new Map<string, string>();
  if (resolverIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", resolverIds);
    for (const p of profiles ?? []) {
      nameMap.set(
        p.id as string,
        ((p.name as string) || "").trim() || "이름 없음"
      );
    }
  }

  const items = rows.map((r) => {
    const notNeeded = isNotNeeded(r.meta);
    const statusKind = r.status === "active" ? "confirmed" : notNeeded ? "not_needed" : "rejected";
    const resolvedAt =
      typeof r.resolved_at === "string" ? r.resolved_at : null;
    const resolvedBy =
      typeof r.resolved_by === "string" ? r.resolved_by : null;
    return {
      id: r.id as string,
      content: typeof r.content === "string" ? r.content : "",
      status_kind: statusKind as "confirmed" | "rejected" | "not_needed",
      source_label: sourceLabel(
        typeof r.source === "string" ? r.source : null,
        typeof r.origin === "string" ? r.origin : null
      ),
      resolved_at: resolvedAt,
      resolved_name: resolvedBy ? nameMap.get(resolvedBy) ?? "—" : "—",
      resolved_short:
        resolvedAt && !Number.isNaN(new Date(resolvedAt).getTime())
          ? `${String(new Date(resolvedAt).getMonth() + 1).padStart(2, "0")}.${String(
              new Date(resolvedAt).getDate()
            ).padStart(2, "0")}`
          : "—"
    };
  });

  return NextResponse.json({
    stats: {
      confirmed_total: confirmedTotal,
      rejected_total: rejectedTotal,
      not_needed_total: notNeededTotal,
      confirm_rate: confirmRate,
      avg_confirm_days: avgConfirmDays
    },
    weekly_inflow: weeklyInflow,
    trend,
    trend_label,
    filter_counts: {
      all: confirmedTotal + rejectedTotal + notNeededTotal,
      confirmed: confirmedTotal,
      rejected: rejectedTotal,
      not_needed: notNeededTotal
    },
    items
  });
}
