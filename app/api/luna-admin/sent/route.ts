import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { getSentRows } from "@/lib/luna-admin/tonight";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const rows = await getSentRows(gate.admin);
  return NextResponse.json({ rows });
}
