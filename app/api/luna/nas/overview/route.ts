import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

type PathRow = { id: string; drive: string; path: string; note: string | null };

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

function nextScanIso(hour: number, minute: number): string {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10) || 20)
  );
  const driveFilter = request.nextUrl.searchParams.get("drive");
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  const [settingsRes, markedRes, totalRes, pathsRes] = await Promise.all([
    admin.from("nas_scan_settings").select("*").eq("id", 1).maybeSingle(),
    admin
      .from("nas_directory")
      .select("id", { count: "exact", head: true })
      .gt("importance", 0),
    admin.from("nas_directory").select("id", { count: "exact", head: true }),
    admin
      .from("nas_important_paths")
      .select("id, drive, path, note")
      .order("created_at", { ascending: false })
  ]);

  if (settingsRes.error) {
    return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
  }
  if (pathsRes.error) {
    return NextResponse.json({ error: pathsRes.error.message }, { status: 500 });
  }

  let paths = (pathsRes.data ?? []) as PathRow[];
  if (driveFilter === "T" || driveFilter === "P") {
    paths = paths.filter((p) => p.drive.toUpperCase() === driveFilter);
  }
  if (q) {
    paths = paths.filter((p) => p.path.toLowerCase().includes(q));
  }

  const enriched = await Promise.all(
    paths.slice(0, limit).map(async (row) => {
      const { count, data } = await admin
        .from("nas_directory")
        .select("modified_at", { count: "exact" })
        .eq("drive", row.drive.toUpperCase())
        .ilike("path", `${row.path}%`);

      let latest: string | null = null;
      for (const f of data ?? []) {
        const m = f.modified_at as string | null;
        if (m && (!latest || m > latest)) latest = m;
      }

      return {
        ...row,
        file_count: count ?? 0,
        latest_modified: latest
      };
    })
  );

  enriched.sort((a, b) => b.file_count - a.file_count);

  const settings = settingsRes.data;
  const scanHour = typeof settings?.scan_hour === "number" ? settings.scan_hour : 3;
  const scanMinute = typeof settings?.scan_minute === "number" ? settings.scan_minute : 0;

  const lastStatus = (settings?.last_status as string | null) ?? null;
  const history =
    settings?.last_run_at
      ? [
          {
            ran_at: settings.last_run_at as string,
            status: lastStatus,
            note:
              lastStatus === "failed"
                ? "세션 없음"
                : settings.last_total != null
                  ? "—"
                  : "변동 없음",
            duration_sec: settings.last_duration_sec as number | null
          }
        ]
      : [];

  return NextResponse.json({
    settings: settings ?? null,
    marked_count: markedRes.count ?? 0,
    total_count: totalRes.count ?? 0,
    path_count: (pathsRes.data ?? []).length,
    paths: enriched,
    paths_total: paths.length,
    next_scan_at: settings?.enabled === false ? null : nextScanIso(scanHour, scanMinute),
    history
  });
}
