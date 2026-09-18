import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runConsolidation } from "@/lib/luna/consolidate";
import { logMissingEnvGroups } from "@/lib/luna/env-keys";
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
    logMissingEnvGroups("luna-consolidate");
    const result = await runConsolidation(admin, { force: false });
    const embeddings = await backfillMissingEmbeddings(admin, {
      limitPerKind: 120
    });
    let storage_snapshot: { groups: number; tables: number } | null = null;
    let source_stats: { day: string; query_ms: number; sources: number } | null = null;
    try {
      const { takeStorageSnapshot } = await import("@/lib/luna/storage");
      storage_snapshot = await takeStorageSnapshot(admin);
    } catch (snapErr) {
      console.error("[luna-consolidate] storage snapshot", snapErr);
    }
    try {
      const { computeAndStoreSourceStats } = await import("@/lib/luna-admin/source-stats");
      source_stats = await computeAndStoreSourceStats(admin);
    } catch (statsErr) {
      console.error("[luna-consolidate] source stats", statsErr);
    }
    console.log("[luna-consolidate] cron", {
      ...result,
      embeddings,
      storage_snapshot,
      source_stats
    });
    return NextResponse.json({ ...result, embeddings, storage_snapshot, source_stats });
  } catch (err) {
    console.error("[luna-consolidate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Consolidation failed" },
      { status: 500 }
    );
  }
}
