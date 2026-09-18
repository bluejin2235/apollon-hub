import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { loadPrimaryNotion } from "@/lib/luna-admin/primary-notion";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const db = request.nextUrl.searchParams.get("db");
  const page = request.nextUrl.searchParams.get("page");
  const pageId = request.nextUrl.searchParams.get("page_id");
  try {
    return NextResponse.json(await loadPrimaryNotion(gate.admin, db, page, pageId));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "노션 상세 실패" },
      { status: 500 }
    );
  }
}
