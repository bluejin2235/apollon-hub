import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { listStudyRuns, recordStudyFeedback } from "@/lib/luna/study-run";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const rows = await listStudyRuns(gate.admin, 80);
  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      started_at: r.started_at,
      finished_at: r.finished_at,
      agenda: r.agenda,
      why: r.why,
      expected: r.expected,
      kind: r.kind,
      outcome: r.outcome,
      result: r.result,
      cost_usd: r.cost_usd,
      llm_calls: r.llm_calls
    }))
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  let body: { runId?: string; verdict?: "good" | "why" | "bad"; note?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.runId || !body.verdict) {
    return NextResponse.json({ error: "runId, verdict required" }, { status: 400 });
  }
  await recordStudyFeedback(gate.admin, {
    runId: body.runId,
    userId: gate.user.id,
    verdict: body.verdict,
    note: body.note
  });
  return NextResponse.json({ ok: true });
}
