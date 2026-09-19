import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import {
  confirmRule,
  countRulesByStatus,
  deferRule,
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
  let body: { id?: string; accept?: boolean; hold?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (body.hold === true) {
    const ok = await deferRule(gate.admin, body.id);
    if (!ok) {
      return NextResponse.json({ error: "defer failed" }, { status: 500 });
    }
    return NextResponse.json({ deferred: true });
  }
  if (typeof body.accept !== "boolean") {
    return NextResponse.json({ error: "id and accept required" }, { status: 400 });
  }
  const row = await confirmRule(gate.admin, body.id, gate.user.id, body.accept);
  if (!row) {
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ row });
}
