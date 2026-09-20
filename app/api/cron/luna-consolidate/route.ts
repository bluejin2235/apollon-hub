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
 * 조건 미충족 시 정리·임베딩·스냅샷은 skip.
 * 원천 통계(luna_source_stats)는 skip 여부와 무관하게 항상 돌린다.
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

    // skip 밤에도 통계는 쌓아야 1차 데이터·아침 리포트가 어제 값을 쓴다.
    // 임베딩·스냅샷까지 돌리면 300초를 넘겨 504가 나고 통계까지 못 간다.
    let source_stats: { day: string; query_ms: number; sources: number } | null =
      null;
    try {
      const { computeAndStoreSourceStats } = await import(
        "@/lib/luna-admin/source-stats"
      );
      source_stats = await computeAndStoreSourceStats(admin);
    } catch (statsErr) {
      console.error("[luna-consolidate] source stats", statsErr);
    }

    if (result.skipped) {
      console.log("[luna-consolidate] cron", { ...result, source_stats });
      return NextResponse.json({ ...result, source_stats });
    }

    const embeddings = await backfillMissingEmbeddings(admin, {
      limitPerKind: 120
    });
    let storage_snapshot: { groups: number; tables: number } | null = null;
    try {
      const { takeStorageSnapshot } = await import("@/lib/luna/storage");
      storage_snapshot = await takeStorageSnapshot(admin);
    } catch (snapErr) {
      console.error("[luna-consolidate] storage snapshot", snapErr);
    }
    console.log("[luna-consolidate] cron", {
      ...result,
      embeddings,
      storage_snapshot,
      source_stats
    });
    return NextResponse.json({
      ...result,
      embeddings,
      storage_snapshot,
      source_stats
    });
  } catch (err) {
    console.error("[luna-consolidate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Consolidation failed" },
      { status: 500 }
    );
  }
}
