import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  bumpGlossaryVersion,
  checkGlossaryDuplicate,
  insertGlossaryTerm,
  normalizeIncomingFields,
  softDeleteGlossaryTerm
} from "@/lib/glossary/duplicate-service";

export const runtime = "nodejs";

type ResolveAction = "merge" | "replace" | "keep" | "register";

/**
 * POST /api/glossary/resolve-duplicate
 *
 * 합치기·교체 시 id 규칙:
 * - survivor = existing_id (사전에 이미 있던 쪽)
 * - loser = exclude_id (지금 편집 중이던 쪽, existing 과 다를 때만 soft-delete)
 * - 신규 등록·지식후보만이면 exclude_id 없음 → survivor 만 갱신
 *
 * 교체: survivor 의 전 필드를 incoming 으로 덮어씀.
 * 합치기: survivor 를 merged 로 갱신.
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
    action?: ResolveAction;
    existing_id?: string;
    incoming?: Record<string, unknown>;
    merged?: Record<string, unknown>;
    candidate_id?: string | null;
    exclude_id?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (
    action !== "merge" &&
    action !== "replace" &&
    action !== "keep" &&
    action !== "register"
  ) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  const editorName = ((profile?.name as string) || "").trim() || null;

  const archiveCandidate = async (candidateId: string | null | undefined) => {
    if (!candidateId) return;
    const { error } = await admin
      .from("luna_learnings")
      .update({
        status: "archived",
        resolved_by: user.id,
        resolved_at: new Date().toISOString()
      })
      .eq("id", candidateId)
      .eq("status", "candidate");
    if (error) {
      console.error("[glossary/resolve] archive", error);
    }
  };

  const candidateId =
    typeof body.candidate_id === "string" && body.candidate_id
      ? body.candidate_id
      : null;
  const excludeId =
    typeof body.exclude_id === "string" && body.exclude_id.trim()
      ? body.exclude_id.trim()
      : null;

  if (action === "keep") {
    await archiveCandidate(candidateId);
    return NextResponse.json({
      ok: true,
      action: "keep",
      message: "기존 것을 유지했어요",
      term_id: typeof body.existing_id === "string" ? body.existing_id : null
    });
  }

  const incoming = normalizeIncomingFields(body.incoming ?? {});
  if (incoming.categories.length === 0) {
    incoming.categories = ["공통"];
  }

  if (action === "register") {
    const again = await checkGlossaryDuplicate(admin, incoming, excludeId);
    if (again.conflicts) {
      return NextResponse.json(
        {
          error: "glossary_duplicate",
          conflicts: true,
          primary: again.primary,
          others: again.others,
          existing: again.existing,
          incoming
        },
        { status: 409 }
      );
    }

    const result = excludeId
      ? await bumpGlossaryVersion(admin, {
          termId: excludeId,
          fields: incoming,
          userId: user.id,
          editorName,
          changeNote: "이름 변경 등록"
        })
      : await insertGlossaryTerm(admin, {
          fields: incoming,
          userId: user.id,
          editorName,
          changeNote: "최초 등록"
        });
    if ("error" in result) {
      const msg = result.error;
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return NextResponse.json(
          { error: "이미 있는 용어입니다", message: msg },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    await archiveCandidate(candidateId);
    return NextResponse.json({
      ok: true,
      action: "register",
      message: "새로 등록했어요",
      term: result
    });
  }

  const existingId =
    typeof body.existing_id === "string" ? body.existing_id.trim() : "";
  if (!existingId) {
    return NextResponse.json({ error: "existing_id required" }, { status: 400 });
  }

  const fields =
    action === "merge"
      ? normalizeIncomingFields(body.merged ?? body.incoming ?? {})
      : incoming;
  if (!fields.term_ko.trim() && !fields.term_en.trim()) {
    return NextResponse.json(
      { error: "한국어 또는 영문 중 하나 이상 있어야 합니다." },
      { status: 400 }
    );
  }
  if (fields.categories.length === 0) fields.categories = ["공통"];
  if (!fields.term_ko.trim()) fields.term_ko = fields.term_en;

  const changeNote = action === "merge" ? "중복 병합" : "중복 교체";

  // 편집 중이던 레코드(loser)를 먼저 soft-delete → term_ko unique 충돌 방지
  if (excludeId && excludeId !== existingId) {
    const del = await softDeleteGlossaryTerm(admin, {
      termId: excludeId,
      userId: user.id,
      editorName,
      changeNote:
        action === "merge"
          ? "중복 병합 — 다른 용어로 통합"
          : "중복 교체 — 다른 용어로 통합"
    });
    if ("error" in del) {
      return NextResponse.json({ error: del.error }, { status: 500 });
    }
  }

  const result = await bumpGlossaryVersion(admin, {
    termId: existingId,
    fields,
    userId: user.id,
    editorName,
    changeNote
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await archiveCandidate(candidateId);

  return NextResponse.json({
    ok: true,
    action,
    message: action === "merge" ? "합쳤어요" : "교체했어요",
    term: result,
    deleted_id:
      excludeId && excludeId !== existingId ? excludeId : null
  });
}
