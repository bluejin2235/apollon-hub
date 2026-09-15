import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { sameReasonLine } from "@/lib/luna-admin/link-parse";
import {
  evidencePath,
  evidenceTitle,
  linkKindCounts,
  listLinks,
  listPerspectives,
  reviewSameLinks,
  sameReviewCounts,
  typeLabel,
  type LunaLinkKind
} from "@/lib/luna-admin/links";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: LunaLinkKind | null =
    kindParam === "same" || kindParam === "belongs" || kindParam === "follows"
      ? kindParam
      : null;
  const [counts, sameCounts, links, perspectives] = await Promise.all([
    linkKindCounts(gate.admin),
    sameReviewCounts(gate.admin),
    listLinks(gate.admin, kind, { includeRejected: kind === "same" }),
    listPerspectives(gate.admin)
  ]);
  return NextResponse.json({
    counts,
    same_counts: sameCounts,
    perspectives,
    links: links.map((row) => ({
      ...row,
      from_label: evidenceTitle(row, "from"),
      to_label: evidenceTitle(row, "to"),
      from_path: evidencePath(row, "from"),
      to_path: evidencePath(row, "to"),
      from_type_label: typeLabel(row.from_type, { path: evidencePath(row, "from") }),
      to_type_label: typeLabel(row.to_type, { path: evidencePath(row, "to") }),
      reason: sameReasonLine(row)
    }))
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  let body: {
    action?: "reject" | "confirm" | "undo";
    ids?: string[];
    undo?: Array<{ id: string; status: "active" | "pending" | "rejected"; source: string }>;
    reason?: string | null;
    note?: string | null;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.action !== "reject" && body.action !== "confirm" && body.action !== "undo") {
    return NextResponse.json({ error: "action required" }, { status: 400 });
  }
  try {
    const result = await reviewSameLinks(gate.admin, gate.user.id, {
      action: body.action,
      ids: body.ids ?? [],
      undo: body.undo,
      reason: body.reason,
      note: body.note
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
