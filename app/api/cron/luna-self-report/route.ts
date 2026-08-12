import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runWeeklySelfReport } from "@/lib/luna/self-report";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 월요일 아침 8시 KST = UTC 일 23:00 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
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
    const result = await runWeeklySelfReport(admin);
    console.log("[luna-self-report] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-self-report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Self-report failed" },
      { status: 500 }
    );
  }
}
