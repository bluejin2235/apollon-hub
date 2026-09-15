import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import {
  evidencePath,
  evidenceTitle,
  linkKindCounts,
  listLinks,
  listPerspectives,
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
  const [counts, links, perspectives] = await Promise.all([
    linkKindCounts(gate.admin),
    listLinks(gate.admin, kind),
    listPerspectives(gate.admin)
  ]);
  return NextResponse.json({
    counts,
    perspectives,
    links: links.map((row) => ({
      ...row,
      from_label: evidenceTitle(row, "from"),
      to_label: evidenceTitle(row, "to"),
      from_path: evidencePath(row, "from"),
      to_path: evidencePath(row, "to"),
      from_type_label: typeLabel(row.from_type),
      to_type_label: typeLabel(row.to_type)
    }))
  });
}
