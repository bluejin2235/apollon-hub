import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { buildAdminDashboard } from "@/lib/luna-admin/dashboard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const dash = await buildAdminDashboard(gate.admin, gate.user.id);
  return NextResponse.json(dash);
}
