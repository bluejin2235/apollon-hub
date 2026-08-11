import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runConsolidation } from "@/lib/luna/consolidate";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-consolidate] CRON_SECRET is not configured");
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
    const result = await runConsolidation(admin, { force: false });
    console.log("[luna-consolidate] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-consolidate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Consolidation failed" },
      { status: 500 }
    );
  }
}
