import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  checkGlossaryDuplicate,
  insertGlossaryTerm,
  normalizeIncomingFields,
  resolveGlossaryDuplicateTx
} from "@/lib/glossary/duplicate-service";

export const runtime = "nodejs";

type ResolveAction = "merge" | "replace" | "keep" | "register";

/**
 * POST /api/glossary/resolve-duplicate
 *
 * 수정 모드 (exclude_id 있음, candidate 없음):
 * - keep: 아무 것도 삭제하지 않음 (클라이언트에서 편집 취소)
 * - replace: survivor = exclude_id, losers = 충돌 상대들
 * - merge: survivor = survivor_id (클라이언트가 고름)
 * - register: exclude 는 그대로 두고 신규 insert
 *
 * 신규/후보 모드:
 * - keep: 후보만 archive
 * - replace/merge: survivor = existing_id, losers = 추가 충돌만
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
    survivor_id?: string | null;
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
  const existingId =
    typeof body.existing_id === "string" ? body.existing_id.trim() : "";
  const isEditMode = Boolean(excludeId) && !candidateId;

  if (action === "keep") {
    // 수정 모드: 삭제 없음. 신규/후보: 후보만 archive
    if (!isEditMode) {
      await archiveCandidate(candidateId);
    }
    return NextResponse.json({
      ok: true,
      action: "keep",
      message: isEditMode
        ? "수정을 취소하고 원래 값으로 되돌렸어요"
        : "기존 것을 유지했어요",
      term_id: isEditMode ? excludeId : existingId || null,
      deleted_ids: []
    });
  }

  const incoming = normalizeIncomingFields(body.incoming ?? {});
  if (incoming.categories.length === 0) {
    incoming.categories = ["공통"];
  }

  if (action === "register") {
    const again = await checkGlossaryDuplicate(
      admin,
      incoming,
      // 수정 모드에서도 자기 자신은 그대로 두고 신규 insert 이므로 exclude 하지 않음
      // (자기 이름과 같아도 신규 행이 생김 → unique 걸릴 수 있음 → exclude 없이 검사)
      null
    );
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

    // 수정·신규 모두 별개 용어로 insert (편집 중인 행은 건드리지 않음)
    const result = await insertGlossaryTerm(admin, {
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
      term: result,
      deleted_ids: []
    });
  }

  if (!existingId && !excludeId) {
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

  // survivor 결정
  let survivorId = existingId;
  if (isEditMode && action === "replace") {
    survivorId = excludeId!;
  } else if (isEditMode && action === "merge") {
    const requested =
      typeof body.survivor_id === "string" && body.survivor_id.trim()
        ? body.survivor_id.trim()
        : "";
    if (requested === excludeId || requested === existingId) {
      survivorId = requested;
    } else {
      survivorId = existingId;
    }
  }

  // loser 수집: 절대 수정 모드 keep처럼 exclude 를 기본 loser 로 넣지 않음
  const remaining = await checkGlossaryDuplicate(admin, fields, survivorId);
  const loserIds = new Set<string>();

  if (Array.isArray(body.loser_ids)) {
    for (const id of body.loser_ids) {
      if (typeof id === "string" && id) loserIds.add(id);
    }
  }
  if (remaining.primary) loserIds.add(remaining.primary.existing_id);
  for (const m of remaining.others) loserIds.add(m.existing_id);

  if (isEditMode) {
    if (action === "replace") {
      // 충돌 상대만 삭제. 편집 중 용어는 survivor
      if (existingId) loserIds.add(existingId);
      loserIds.delete(excludeId!);
    } else if (action === "merge") {
      // survivor 가 아닌 쪽(편집 or 상대) + 추가 충돌
      if (survivorId === excludeId) {
        if (existingId) loserIds.add(existingId);
      } else {
        loserIds.add(excludeId!);
      }
    }
  }
  // 신규/후보: exclude 없음. survivor=existing, 추가 충돌만 loser
  loserIds.delete(survivorId);

  const changeNote = action === "merge" ? "중복 병합" : "중복 교체";
  const loserNote =
    action === "merge"
      ? "중복 병합 — 다른 용어로 통합"
      : "중복 교체 — 다른 용어로 통합";

  const result = await resolveGlossaryDuplicateTx(admin, {
    survivorId,
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
