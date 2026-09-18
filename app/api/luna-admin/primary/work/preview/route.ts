import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";
import { previewPrimaryWorkFile } from "@/lib/luna-admin/primary-work";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path 가 필요합니다" }, { status: 400 });
  }
  const all = request.nextUrl.searchParams.get("all") === "1";
  try {
    const payload = await previewPrimaryWorkFile(gate.admin, path, all);
    if (!payload) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "미리보기를 불러오지 못했습니다";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
