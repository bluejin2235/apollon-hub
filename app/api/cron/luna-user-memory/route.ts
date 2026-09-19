import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runUserMemoRewriteBatch } from "@/lib/luna/user-memory";
import { promoteSharedMemoPatterns } from "@/lib/luna/perspective-promote";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/luna-user-memory
 * 매시 정각 — memo 재작성 + (가끔) 팀 관점 3명 승격
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-user-memory] CRON_SECRET is not configured");
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
    const result = await runUserMemoRewriteBatch(admin, { limit: 20 });
    let promote: { checked: number; applied: number } | null = null;
    // 매시마다 돌리되, memo 가 있는 사람만 보면 됨
    try {
      promote = await promoteSharedMemoPatterns(admin);
    } catch (err) {
      console.error("[luna-user-memory] promote", err);
    }
    console.log("[luna-user-memory] cron", { ...result, promote });
    return NextResponse.json({ ...result, promote });
  } catch (err) {
    console.error("[luna-user-memory]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "User memory batch failed" },
      { status: 500 }
    );
  }
}
