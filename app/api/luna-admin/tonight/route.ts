import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import {
  addSentRow,
  excludeTonightItem,
  includeTonightItem,
  loadTonightState
} from "@/lib/luna-admin/tonight";
import { runDailySelfstudy } from "@/lib/luna/selfstudy";
import { ADMIN_SELFSTUDY_HOUR, ADMIN_SELFSTUDY_MINUTE } from "@/lib/luna-admin/schedule";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const state = await loadTonightState(gate.admin);
  const hh = String(ADMIN_SELFSTUDY_HOUR).padStart(2, "0");
  const mm = String(ADMIN_SELFSTUDY_MINUTE).padStart(2, "0");
  return NextResponse.json({
    ...state,
    run_label: `오늘 밤 ${hh}:${mm}`
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  let body: { action?: string; id?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "exclude" && body.id) {
    const state = await excludeTonightItem(gate.admin, body.id);
    return NextResponse.json(state);
  }
  if (body.action === "include" && body.id) {
    const state = await includeTonightItem(gate.admin, body.id);
    return NextResponse.json(state);
  }
  if (body.action === "run") {
    try {
      const result = await runDailySelfstudy(gate.admin, { force: true, notify: true });
      return NextResponse.json({ ok: true, result });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "실행 실패" },
        { status: 500 }
      );
    }
  }
  if (body.action === "send" && body.id) {
    const state = await loadTonightState(gate.admin);
    const item = state.items.find((i) => i.id === body.id);
    if (item) {
      await addSentRow(gate.admin, {
        failure_label: item.why,
        failure_ids: item.failure_ids,
        topic: item.title
      });
    }
    return NextResponse.json(state);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
