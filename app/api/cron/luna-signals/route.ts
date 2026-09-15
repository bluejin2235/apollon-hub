import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  ensureBuiltinLinkRules,
  mineRuleCandidatesFromSignals
} from "@/lib/luna/rules";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/cron/luna-signals
 * 야간 — luna_signals 를 훑어 규칙 후보를 만든다.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
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
    await ensureBuiltinLinkRules(admin);
    const mined = await mineRuleCandidatesFromSignals(admin);
    console.log("[luna-signals] cron", mined);
    return NextResponse.json({ ok: true, ...mined });
  } catch (err) {
    console.error("[luna-signals]", err);
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
