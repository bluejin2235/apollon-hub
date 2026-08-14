import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { toFieldValues } from "@/lib/glossary/duplicate";
import {
  buildGlossaryMergeDraft,
  checkGlossaryDuplicate,
  normalizeIncomingFields
} from "@/lib/glossary/duplicate-service";

export const runtime = "nodejs";

/**
 * POST /api/glossary/check-duplicate
 * 저장 직전 중복 검사. conflicts 시 팝업용 페이로드 + 병합 초안.
 */
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: {
    term_ko?: string;
    term_en?: string | null;
    term_zh?: string | null;
    definition?: string | null;
    categories?: unknown;
    synonyms?: unknown;
    exclude_id?: string | null;
    with_merge_draft?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = normalizeIncomingFields(body);
  if (!incoming.term_ko.trim() && !incoming.term_en.trim()) {
    return NextResponse.json(
      { error: "한국어 또는 영문 중 하나 이상 있어야 합니다." },
      { status: 400 }
    );
  }

  const excludeId =
    typeof body.exclude_id === "string" && body.exclude_id
      ? body.exclude_id
      : null;

  const result = await checkGlossaryDuplicate(admin, incoming, excludeId);
  if (!result.conflicts || !result.primary || !result.existing) {
    return NextResponse.json({ conflicts: false });
  }

  let merge_draft = null;
  if (body.with_merge_draft !== false) {
    merge_draft = await buildGlossaryMergeDraft(
      toFieldValues(result.existing),
      incoming
    );
  }

  return NextResponse.json({
    conflicts: true,
    primary: result.primary,
    others: result.others,
    existing: result.existing,
    incoming,
    merge_draft
  });
}
