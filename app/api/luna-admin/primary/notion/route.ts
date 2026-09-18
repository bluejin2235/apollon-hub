import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { loadPrimaryNotion } from "@/lib/luna-admin/primary-notion";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const q = request.nextUrl.searchParams;
  try {
    return NextResponse.json(
      await loadPrimaryNotion(gate.admin, {
        db: q.get("db"),
        page: q.get("page"),
        pageId: q.get("page_id"),
        view: q.get("view"),
        period: q.get("period"),
        from: q.get("from"),
        to: q.get("to"),
        sort: q.get("sort"),
        dir: q.get("dir"),
        allChunks: q.get("all") === "1"
      })
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "노션 상세 실패" },
      { status: 500 }
    );
  }
}
