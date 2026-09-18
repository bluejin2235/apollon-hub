import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import {
  listAnswerFlags,
  countPendingAnswerFlags,
  reviewAnswerFlag
} from "@/lib/luna/answer-flags";
import {
  ANSWER_FLAG_IDS,
  type AnswerFlagId,
  type AnswerFlagStatus,
  type AnswerFlagVerdict
} from "@/lib/luna/answer-flags-shared";
import { isThumbsReason } from "@/lib/luna/signals-shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const statusRaw = request.nextUrl.searchParams.get("status") ?? "pending";
  const flagRaw = request.nextUrl.searchParams.get("flag");
  const status =
    statusRaw === "all" ||
    statusRaw === "pending" ||
    statusRaw === "reviewed" ||
    statusRaw === "ignored"
      ? (statusRaw as AnswerFlagStatus | "all")
      : "pending";
  const flagId =
    flagRaw && (ANSWER_FLAG_IDS as readonly string[]).includes(flagRaw)
      ? (flagRaw as AnswerFlagId)
      : null;
  const [rows, pending] = await Promise.all([
    listAnswerFlags(gate.admin, { status, flagId, limit: 200 }),
    countPendingAnswerFlags(gate.admin)
  ]);
  return NextResponse.json({ rows, pending, flag_ids: ANSWER_FLAG_IDS });
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  let body: {
    id?: string;
    ids?: string[];
    verdict?: string;
    reason?: string | null;
    note?: string | null;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = [
    ...(typeof body.id === "string" && body.id ? [body.id] : []),
    ...((body.ids ?? []).filter((x) => typeof x === "string"))
  ];
  if (ids.length === 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const verdict = body.verdict;
  if (verdict !== "good" && verdict !== "bad" && verdict !== "unclear") {
    return NextResponse.json(
      { error: "verdict must be good|bad|unclear" },
      { status: 400 }
    );
  }
  const reason =
    body.reason && isThumbsReason(body.reason) ? body.reason : body.reason ?? null;
  const rows = [];
  for (const id of ids) {
    const row = await reviewAnswerFlag(gate.admin, {
      id,
      userId: gate.user.id,
      verdict: verdict as AnswerFlagVerdict,
      reason,
      note: body.note ?? null
    });
    if (row) rows.push(row);
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ row: rows[0], rows, updated: rows.length });
}
