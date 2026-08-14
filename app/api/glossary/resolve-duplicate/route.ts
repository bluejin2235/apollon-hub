import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  checkGlossaryDuplicate,
  insertGlossaryTerm,
  bumpGlossaryVersion,
  normalizeIncomingFields,
  resolveGlossaryDuplicateTx
} from "@/lib/glossary/duplicate-service";

export const runtime = "nodejs";

type ResolveAction = "merge" | "replace" | "keep" | "register";

/**
 * POST /api/glossary/resolve-duplicate
 *
 * 합치기·교체:
 * - survivor = existing_id (사전에 있던 쪽, primary)
 * - losers = exclude_id + 모든 충돌 용어 id (loser_ids) — survivor 제외, soft-delete
 * - 한 트랜잭션 RPC 로 soft-delete → survivor 전필드 갱신 → 이력
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
    loser_ids?: string[] | null;
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
    if (again.conflicts && again.primary) {
      return NextResponse.json(
        {
          error: again.primary.message,
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
          {
            error: `한국어 이름이 다른 활성 용어와 겹칩니다 — ${incoming.term_ko}`,
            message: msg
          },
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

  // 저장할 내용 기준으로 남은 충돌 용어를 모두 loser 로 모은다
  const remaining = await checkGlossaryDuplicate(admin, fields, existingId);
  const loserIds = new Set<string>();
  if (excludeId) loserIds.add(excludeId);
  if (Array.isArray(body.loser_ids)) {
    for (const id of body.loser_ids) {
      if (typeof id === "string" && id) loserIds.add(id);
    }
  }
  if (remaining.primary) loserIds.add(remaining.primary.existing_id);
  for (const m of remaining.others) loserIds.add(m.existing_id);
  loserIds.delete(existingId);

  const changeNote = action === "merge" ? "중복 병합" : "중복 교체";
  const loserNote =
    action === "merge"
      ? "중복 병합 — 다른 용어로 통합"
      : "중복 교체 — 다른 용어로 통합";

  const result = await resolveGlossaryDuplicateTx(admin, {
    survivorId: existingId,
    loserIds: Array.from(loserIds),
    fields,
    userId: user.id,
    editorName,
    changeNote,
    loserNote
  });

  if ("error" in result) {
    return NextResponse.json(
      {
        error: result.error,
        conflict_term_ko: result.conflict_term_ko,
        conflict_term_id: result.conflict_term_id
      },
      { status: result.status ?? 500 }
    );
  }

  await archiveCandidate(candidateId);

  return NextResponse.json({
    ok: true,
    action,
    message: action === "merge" ? "합쳤어요" : "교체했어요",
    term: { id: result.id, version: result.version },
    deleted_ids: result.deleted_ids
  });
}
