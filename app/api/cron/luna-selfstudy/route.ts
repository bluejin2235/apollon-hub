import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runDailySelfstudy } from "@/lib/luna/selfstudy";
import { loadTonightState } from "@/lib/luna-admin/tonight";
import { selectTonightAgenda } from "@/lib/luna/study-agenda";
import { runSelectedTonight } from "@/lib/luna/study-run";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    const state = await loadTonightState(admin);
    const { selected } = await selectTonightAgenda(admin, {
      excludedIds: new Set(state.items.filter((i) => i.excluded).map((i) => i.id))
    });
    const study = await runSelectedTonight(admin, selected, { limitPerItem: 40 });
    const stuck = await runDailySelfstudy(admin, { notify: true });
    console.log("[luna-selfstudy] cron", { study, stuck });
    return NextResponse.json({ study, stuck });
  } catch (err) {
    console.error("[luna-selfstudy]", err);
    const message = err instanceof Error ? err.message : "Selfstudy failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
