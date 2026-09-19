import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runUserMemoRewriteBatch } from "@/lib/luna/user-memory";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/luna-user-memory
 * 매시 정각 — 대화가 memo 보다 최신인 사람의 메모를 비동기로 다시 쓴다.
 * 채팅 직후 scheduleUserMemoRewrite 가 1차, 이 cron 이 백필.
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
    console.log("[luna-user-memory] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-user-memory]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "User memory batch failed" },
      { status: 500 }
    );
  }
}
