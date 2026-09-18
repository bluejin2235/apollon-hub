import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { listPrimaryWorkFiles } from "@/lib/luna-admin/primary-work";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const chip = request.nextUrl.searchParams.get("chip");
  const page = request.nextUrl.searchParams.get("page");
  try {
    const payload = await listPrimaryWorkFiles(gate.admin, chip, page);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "목록을 불러오지 못했습니다";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
