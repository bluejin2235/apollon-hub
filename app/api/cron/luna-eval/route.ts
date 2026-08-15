import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runEvalExam } from "@/lib/luna/eval-exam";
import {
  alreadyRanTierToday,
  getEvalSchedule,
  shouldRunHeavyNow,
  shouldRunLightNow
} from "@/lib/luna/eval-schedule";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/luna-eval
 * 10분마다 호출. luna_settings.eval_schedule 시각이 맞을 때만 light/heavy 실행.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-eval] CRON_SECRET is not configured");
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

  try {
    const schedule = await getEvalSchedule(admin);
    const out: Record<string, unknown> = {
      schedule,
      light: { skipped: true, reason: "not due" },
      heavy: { skipped: true, reason: "not due" }
    };

    if (shouldRunLightNow(schedule)) {
      if (await alreadyRanTierToday(admin, "light", "cron_light")) {
        out.light = { skipped: true, reason: "already ran today" };
      } else {
        out.light = await runEvalExam(admin, {
          trigger: "cron_light",
          tier: "light",
          force: true,
          notify: true
        });
      }
    } else if (!schedule.light.enabled) {
      out.light = { skipped: true, reason: "disabled" };
    }

    if (shouldRunHeavyNow(schedule)) {
      if (await alreadyRanTierToday(admin, "heavy", "cron_heavy")) {
        out.heavy = { skipped: true, reason: "already ran today" };
      } else {
        out.heavy = await runEvalExam(admin, {
          trigger: "cron_heavy",
          tier: "heavy",
          force: true,
          notify: true
        });
      }
    } else if (!schedule.heavy.enabled) {
      out.heavy = { skipped: true, reason: "disabled" };
    }

    console.log("[luna-eval] cron", {
      light: out.light,
      heavy: out.heavy
    });
    return NextResponse.json(out);
  } catch (err) {
    console.error("[luna-eval]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Eval cron failed" },
      { status: 500 }
    );
  }
}
