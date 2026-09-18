import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { buildPrimaryTrend } from "@/lib/luna-admin/primary-trend";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  try {
    return NextResponse.json(
      await buildPrimaryTrend(gate.admin, request.nextUrl.searchParams.get("range"))
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "추이 실패" },
      { status: 500 }
    );
  }
}
