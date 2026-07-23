import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  normalizeScheduleRow,
  publishingPeriodToDays,
  type PublishingScheduleRow
} from "@/lib/research/publishing";
import { KST_OFFSET_MS } from "@/lib/mail/hub-email";

const N8N_WEBHOOK_URL = "https://apollonworks.app.n8n.cloud/webhook/trend-weekly-trigger";

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
};

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[publishing-trigger] CRON_SECRET is not configured");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("publishing_schedules")
    .select("*")
    .eq("is_active", true);

  if (error) {
    console.error("[publishing-trigger] schedule fetch failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const schedules = (data ?? [])
    .map((row) => normalizeScheduleRow(row as Record<string, unknown>))
    .filter((row): row is PublishingScheduleRow => row !== null);

  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const currentDay = nowKst.getUTCDay();
  const currentHour = nowKst.getUTCHours();
  const currentMinute = nowKst.getUTCMinutes();

  const matching = schedules.filter(
    (schedule) =>
      WEEKDAY_INDEX[schedule.day] === currentDay &&
      schedule.hour === currentHour &&
      schedule.minute === currentMinute
  );

  if (matching.length === 0) {
    return NextResponse.json({ skipped: true, reason: "scheduled time not matched" });
  }

  const results: { id: string; part: string; days: number; ok: boolean }[] = [];

  for (const schedule of matching) {
    const days = publishingPeriodToDays(
      schedule.period,
      schedule.start_date ?? "",
      schedule.end_date ?? ""
    );

    if (days === null) {
      console.error("[publishing-trigger] invalid schedule period", schedule);
      results.push({ id: schedule.id, part: schedule.part, days: 0, ok: false });
      continue;
    }

    try {
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, part: schedule.part }),
        signal: AbortSignal.timeout(60_000)
      });

      if (!response.ok) {
        const detail = await response.text();
        console.error(
          "[publishing-trigger] webhook failed",
          schedule.id,
          response.status,
          detail.slice(0, 500)
        );
        results.push({ id: schedule.id, part: schedule.part, days, ok: false });
        continue;
      }

      results.push({ id: schedule.id, part: schedule.part, days, ok: true });
    } catch (triggerError) {
      console.error("[publishing-trigger]", schedule.id, triggerError);
      results.push({ id: schedule.id, part: schedule.part, days, ok: false });
    }
  }

  const allOk = results.every((result) => result.ok);
  return NextResponse.json(
    { success: allOk, triggered: results },
    { status: allOk ? 200 : 502 }
  );
}
