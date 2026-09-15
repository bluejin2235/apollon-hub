import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { buildLinkProgress } from "@/lib/luna-admin/year-progress";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const payload = await buildLinkProgress(gate.admin);
  return NextResponse.json(payload);
}
