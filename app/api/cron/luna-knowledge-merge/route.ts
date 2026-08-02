import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  evaluateMergeGate,
  recordMergeRun
} from "@/lib/luna/knowledge-merge-gate";
import { runKnowledgeMerge } from "@/lib/luna/knowledge-merge";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-knowledge-merge] CRON_SECRET is not configured");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  try {
    const gate = await evaluateMergeGate(admin);
    if (!gate.shouldRun || !gate.trigger) {
      console.log("[luna-knowledge-merge] skipped", {
        count: gate.count,
        oldestDays: gate.oldestDays,
        threshold: gate.settings.merge_threshold,
        maxWait: gate.settings.max_wait_days
      });
      return NextResponse.json({
        skipped: true,
        count: gate.count,
        oldest_days: gate.oldestDays
      });
    }

    const result = await runKnowledgeMerge(admin);
    await recordMergeRun(admin, {
      count: gate.count,
      trigger: gate.trigger
    });
    console.log("[luna-knowledge-merge] result", {
      ...result,
      trigger: gate.trigger,
      count: gate.count
    });
    return NextResponse.json({
      skipped: false,
      trigger: gate.trigger,
      count: gate.count,
      ...result
    });
  } catch (err) {
    console.error("[luna-knowledge-merge]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merge failed" },
      { status: 500 }
    );
  }
}
