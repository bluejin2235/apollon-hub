import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { listPrimaryImages } from "@/lib/luna-admin/primary-image";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const chip = request.nextUrl.searchParams.get("chip");
  const page = request.nextUrl.searchParams.get("page");
  const mismatch = request.nextUrl.searchParams.get("mismatch") === "1";
  try {
    return NextResponse.json(await listPrimaryImages(gate.admin, chip, page, mismatch));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "목록 실패" },
      { status: 500 }
    );
  }
}
