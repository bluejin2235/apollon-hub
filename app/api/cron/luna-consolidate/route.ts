import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runConsolidation } from "@/lib/luna/consolidate";
import { backfillMissingEmbeddings } from "@/lib/luna/embedding-store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/luna-consolidate
 * 매일 03:30 KST (UTC 18:30) — volume/backstop 조건 확인 후 기억 정리.
 * 조건 미충족 시 skip (알림 없음). 자습 cron(03:00)과 분리.
 * 임베딩 누락 보강은 정리 skip 여부와 무관하게 항상 돌린다.
 */
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
    const embeddings = await backfillMissingEmbeddings(admin, {
      limitPerKind: 120
    });
    console.log("[luna-consolidate] cron", { ...result, embeddings });
    return NextResponse.json({ ...result, embeddings });
  } catch (err) {
    console.error("[luna-consolidate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Consolidation failed" },
      { status: 500 }
    );
  }
}
