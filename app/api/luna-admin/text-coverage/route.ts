import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;

  const status = ["ok", "failed", "empty", "skipped"] as const;
  const results = await Promise.all([
    ...status.map((kind) =>
      gate.admin.from("nas_file_text")
        .select("path", { count: "exact", head: true }).eq("status", kind)
    ),
    gate.admin.from("nas_file_text")
      .select("path", { count: "exact", head: true }).not("indexed_at", "is", null)
  ]);

  if (results.some((result) => result.error || result.count === null)) {
    return NextResponse.json(
      { error: "본문 색인 상태를 확인하지 못했습니다. 잠시 후 다시 확인하세요." },
      { status: 503 }
    );
  }
  const [ok, failed, empty, skipped, vectorReady] = results.map((result) => result.count!);
  return NextResponse.json({
    body_status: { ok, failed, empty, skipped },
    vector_ready_files: vectorReady,
    note: "본문 추출 성공과 벡터 완료는 다른 단계입니다. 파일 경로 수나 답변에 실제 사용된 자료 수가 아닙니다."
  });
}
