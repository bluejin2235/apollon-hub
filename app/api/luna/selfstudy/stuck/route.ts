import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import {
  getSelfstudyStatus,
  listTodayStuckMoments,
  nextSelfstudyRunLabel,
  setTodayExclusion
} from "@/lib/luna/selfstudy";

export const runtime = "nodejs";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(
    kst.getUTCMinutes()
  ).padStart(2, "0")}`;
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
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [{ items, counts, planned_count, settings }, status] = await Promise.all([
    listTodayStuckMoments(admin),
    getSelfstudyStatus(admin)
  ]);

  return NextResponse.json({
    counts,
    planned_count,
    total: items.length,
    today_count: status.today_count,
    run_time_label: `${String(settings.run_hour).padStart(2, "0")}:${String(
      settings.run_minute
    ).padStart(2, "0")}`,
    next_run_label: nextSelfstudyRunLabel(settings.run_hour, settings.run_minute),
    items: items.map((m) => ({
      key: m.key,
      kind: m.kind,
      user_name: m.user_name,
      conversation_id: m.conversation_id,
      time_label: timeLabel(m.at),
      title: m.title,
      detail: m.detail,
      excluded: m.excluded,
      already_learned: m.already_learned,
      planned: m.planned
    }))
  });
}

/** POST — 오늘 자습 대상에서 제외/복구. body: { key, excluded } */
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { key?: string; excluded?: boolean };
  try {
    body = (await request.json()) as { key?: string; excluded?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  const excluded = body.excluded !== false;

  const keys = await setTodayExclusion(admin, key, excluded);
  return NextResponse.json({ ok: true, key, excluded, excluded_keys: keys });
}
