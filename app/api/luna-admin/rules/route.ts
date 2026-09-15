import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import {
  confirmRule,
  countRulesByStatus,
  listCandidateRuleQuestions,
  listRules
} from "@/lib/luna/rules";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const status = request.nextUrl.searchParams.get("status");
  const filter =
    status === "candidate" || status === "active" || status === "dropped"
      ? status
      : undefined;
  const [rows, counts, questions] = await Promise.all([
    listRules(gate.admin, filter ? { status: filter } : undefined),
    countRulesByStatus(gate.admin),
    listCandidateRuleQuestions(gate.admin)
  ]);
  return NextResponse.json({ rows, counts, questions });
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  let body: { id?: string; accept?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id || typeof body.accept !== "boolean") {
    return NextResponse.json({ error: "id and accept required" }, { status: 400 });
  }
  const row = await confirmRule(gate.admin, body.id, gate.user.id, body.accept);
  if (!row) {
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ row });
}
