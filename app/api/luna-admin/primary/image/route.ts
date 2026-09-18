import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { listPrimaryImages } from "@/lib/luna-admin/primary-image";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const q = request.nextUrl.searchParams;
  try {
    return NextResponse.json(
      await listPrimaryImages(
        gate.admin,
        q.get("chip"),
        q.get("page"),
        q.get("mismatch") === "1",
        q.get("period"),
        q.get("from"),
        q.get("to"),
        q.get("sort"),
        q.get("dir")
      )
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "목록 실패" },
      { status: 500 }
    );
  }
}
