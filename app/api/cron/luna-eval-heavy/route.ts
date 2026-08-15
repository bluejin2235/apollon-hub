import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runEvalExam } from "@/lib/luna/eval-exam";
import {
  alreadyRanTierToday,
  getEvalSchedule,
  shouldRunHeavyNow
} from "@/lib/luna/eval-schedule";

export const runtime = "nodejs";
export const maxDuration = 300;

/** @deprecated /api/cron/luna-eval 사용. 호환용. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const schedule = await getEvalSchedule(admin);
  if (!shouldRunHeavyNow(schedule)) {
    return NextResponse.json({
      skipped: true,
      reason: schedule.heavy.enabled ? "not due" : "disabled"
    });
  }
  if (await alreadyRanTierToday(admin, "heavy", "cron_heavy")) {
    return NextResponse.json({ skipped: true, reason: "already ran today" });
  }
  const result = await runEvalExam(admin, {
    trigger: "cron_heavy",
    tier: "heavy",
    force: true,
    notify: true
  });
  return NextResponse.json(result);
}
