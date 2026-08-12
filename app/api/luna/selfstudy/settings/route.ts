import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  getSelfstudySettings,
  getSelfstudyStatus,
  listTodayStuckMoments,
  nextSelfstudyRunLabel,
  normalizeSelfstudySettings,
  saveSelfstudySettings
} from "@/lib/luna/selfstudy";

export const runtime = "nodejs";

async function gate(request: NextRequest) {
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
  return { user, admin };
}

export async function GET(request: NextRequest) {
  const g = await gate(request);
  if ("error" in g) return g.error;
  const { admin } = g;

  const [settings, { counts }, status] = await Promise.all([
    getSelfstudySettings(admin),
    listTodayStuckMoments(admin),
    getSelfstudyStatus(admin)
  ]);

  return NextResponse.json({
    settings,
    today_counts: counts,
    last_run: status.last_run,
    today_count: status.today_count,
    next_run_label: nextSelfstudyRunLabel(settings.run_hour, settings.run_minute),
    // 실제 스케줄은 vercel.json 의 cron 고정값
    cron_schedule_label: "03:00 (KST) — vercel.json cron 고정"
  });
}

export async function PUT(request: NextRequest) {
  const g = await gate(request);
  if ("error" in g) return g.error;
  const { admin, user } = g;

  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const next = normalizeSelfstudySettings(body);
  const saved = await saveSelfstudySettings(admin, next);

  // 자습 완료 알림은 공용 notify_events.study 로도 게이트되므로 함께 맞춘다
  try {
    const { data } = await admin
      .from("luna_settings")
      .select("value")
      .eq("key", "notify_events")
      .maybeSingle();
    const prev =
      data?.value && typeof data.value === "object" && !Array.isArray(data.value)
        ? (data.value as Record<string, unknown>)
        : {};
    await admin.from("luna_settings").upsert(
      {
        key: "notify_events",
        value: { ...prev, study: saved.notify_done },
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );
  } catch (err) {
    console.error("[luna/selfstudy/settings] notify sync", err);
  }

  return NextResponse.json({
    settings: saved,
    next_run_label: nextSelfstudyRunLabel(saved.run_hour, saved.run_minute)
  });
}
