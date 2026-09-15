import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { buildFailureAnalysis } from "@/lib/luna-admin/analysis";
import { addSentRow } from "@/lib/luna-admin/tonight";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const payload = await buildFailureAnalysis(gate.admin);
  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  let body: {
    failure_ids?: string[];
    failure_label?: string;
    topic?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.topic) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }
  const row = await addSentRow(gate.admin, {
    failure_label: body.failure_label ?? body.topic,
    failure_ids: body.failure_ids ?? [],
    topic: body.topic
  });
  return NextResponse.json({ row });
}
