import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runDailySelfstudy } from "@/lib/luna/selfstudy";
import { loadTonightState } from "@/lib/luna-admin/tonight";
import { selectTonightAgenda } from "@/lib/luna/study-agenda";
import { runSelectedTonight } from "@/lib/luna/study-run";

export const runtime = "nodejs";
/** Pro 상한. 모드 A 는 청크(20문서) + budgetMs 로 이 안에 끝내고 finishRun 한다. */
export const maxDuration = 800;

/**
 * GET /api/cron/luna-selfstudy
 * 새벽 3시 KST — 루나가 아젠다를 스스로 고르고 돌린 뒤, stuck 문답 자습.
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
    // 이전 호출이 타임아웃으로 끊긴 미완 런을 닫는다
    const stuckCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await admin
      .from("luna_study_runs")
      .update({
        finished_at: new Date().toISOString(),
        outcome: "failed",
        result: {
          error: "Vercel 함수 타임아웃으로 중단됨 — 다음 청크에서 이어감",
          timed_out: true
        }
      })
      .is("finished_at", null)
      .eq("kind", "probe_retrieval")
      .lt("started_at", stuckCutoff);

    const cronStarted = Date.now();
    /** maxDuration 800s 안에서 finishRun 여유를 두고 청크를 이어 돌린다 */
    const CRON_BUDGET_MS = 700_000;

    const state = await loadTonightState(admin);
    const { selected } = await selectTonightAgenda(admin, {
      excludedIds: new Set(state.items.filter((i) => i.excluded).map((i) => i.id))
    });

    const runs: Awaited<ReturnType<typeof runSelectedTonight>>["runs"] = [];
    let stoppedForCost = false;
    // 모드 A 는 20문서 청크를 시간 예산 안에서 반복 (하루 목표 200)
    const modeA = selected.find(
      (i) =>
        !i.excluded &&
        i.when === "tonight" &&
        i.kind === "probe_retrieval" &&
        i.scope?.mode === "answer_key"
    );
    const rest = selected.filter((i) => i !== modeA);

    if (modeA) {
      let chunks = 0;
      const maxChunks = 10; // 20×10 = 200
      while (chunks < maxChunks && Date.now() - cronStarted < CRON_BUDGET_MS) {
        const piece = await runSelectedTonight(admin, [modeA], {
          limitPerItem: 20,
          trigger: "cron"
        });
        runs.push(...piece.runs);
        chunks += 1;
        if (piece.stopped_for_cost) {
          stoppedForCost = true;
          break;
        }
        const last = piece.runs[piece.runs.length - 1];
        if (!last || last.outcome === "failed") break;
        const probed = Number((last.result as { probed?: number }).probed ?? 0);
        if (probed === 0) break;
      }
    }

    if (!stoppedForCost && Date.now() - cronStarted < CRON_BUDGET_MS) {
      const other = await runSelectedTonight(admin, rest, {
        limitPerItem: 20,
        trigger: "cron"
      });
      runs.push(...other.runs);
      stoppedForCost = other.stopped_for_cost;
    }

    const study = { runs, stopped_for_cost: stoppedForCost };
    const stuck = await runDailySelfstudy(admin, { notify: true });
    console.log("[luna-selfstudy] cron", {
      study: {
        run_count: runs.length,
        stopped_for_cost: stoppedForCost,
        elapsed_ms: Date.now() - cronStarted
      },
      stuck
    });
    return NextResponse.json({ study, stuck });
  } catch (err) {
    console.error("[luna-selfstudy]", err);
    const message = err instanceof Error ? err.message : "Selfstudy failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
