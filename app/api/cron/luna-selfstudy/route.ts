import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runDailySelfstudy } from "@/lib/luna/selfstudy";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/luna-selfstudy
 * 새벽 3시 KST (UTC 18:00) — 그날 막힌 것만 자습 → 후보함.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-selfstudy] CRON_SECRET is not configured");
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
    const result = await runDailySelfstudy(admin, { notify: true });
    console.log("[luna-selfstudy] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-selfstudy]", err);
    const message = err instanceof Error ? err.message : "Selfstudy failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
