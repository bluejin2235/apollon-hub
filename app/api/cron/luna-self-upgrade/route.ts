import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runSelfUpgrade } from "@/lib/luna/self-upgrade";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 일요일 새벽 4시 KST = UTC 토 19:00 */
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
    const result = await runSelfUpgrade(admin, { notify: true });
    console.log("[luna-self-upgrade] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-self-upgrade]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Self-upgrade failed" },
      { status: 500 }
    );
  }
}
