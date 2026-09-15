import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { listPerspectives } from "@/lib/luna-admin/links";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const rows = await listPerspectives(gate.admin);
  return NextResponse.json({ rows });
}
