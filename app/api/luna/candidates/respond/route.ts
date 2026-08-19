import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { normalizeCategories } from "@/lib/glossary/categories";
import { toFieldValues } from "@/lib/glossary/duplicate";
import {
  buildGlossaryMergeDraft,
  checkGlossaryDuplicate,
  normalizeIncomingFields
} from "@/lib/glossary/duplicate-service";
import { normalizeSynonyms } from "@/lib/glossary/synonyms";
import type { GlossaryCategory } from "@/lib/glossary/types";
import {
  shouldRegisterGlossary,
  tryRegisterGlossaryFromCandidate
} from "@/lib/luna/candidate-glossary";
import {
  isGlossaryCandidate,
  looksLikeDefinitionSentence,
  applyGlossaryMetaPatch,
  parseGlossaryMeta,
  sanitizeGlossaryField
} from "@/lib/luna/candidate-format";
import {
  makeTurn,
  normalizeThread,
  runDialogueTurn,
  stripConfirmClaim,
  understoodAsk,
  type ThreadTurn
} from "@/lib/luna/candidates";
import {
  applyDuplicateDecision,
  cachedProposal,
  findDuplicateMatches,
  loadActiveKnowledge,
  type DuplicateDecision
} from "@/lib/luna/knowledge-duplicate";
import {
  clipRejectNote,
  hasRejectMeta,
  isRejectAction,
  mergeRejectMeta
} from "@/lib/luna/reject-note";
export const runtime = "nodejs";

type Action =
  | "confirm"
  | "revise"
  | "reject"
  | "not_needed"
  | "later"
  | DuplicateDecision;

type GlossaryPatch = {
  term_ko?: string;
  term_en?: string | null;
  term_zh?: string | null;
  definition?: string;
  categories?: unknown;
  category?: unknown;
  synonyms?: unknown;
  existing_id?: string;
};

type Body = {
  id?: string;
  action?: string;
  text?: string;
  reject_note?: string;
  glossary?: GlossaryPatch;
};

function normalizeGlossaryPatch(
  raw: GlossaryPatch | undefined
): {
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  definition: string;
  categories: GlossaryCategory[];
  synonyms: string[];
} | null {
  if (!raw || typeof raw !== "object") return null;
  const term_ko =
    typeof raw.term_ko === "string"
      ? sanitizeGlossaryField("term_ko", raw.term_ko)
      : "";
  const term_en_raw =
    typeof raw.term_en === "string"
      ? sanitizeGlossaryField("term_en", raw.term_en)
      : "";
  const term_zh_raw =
    typeof raw.term_zh === "string"
      ? sanitizeGlossaryField("term_zh", raw.term_zh)
      : "";
  return {
    term_ko,
    term_en: term_en_raw || null,
    term_zh: term_zh_raw || null,
    definition:
      typeof raw.definition === "string" ? raw.definition.trim() : "",
    categories: normalizeCategories(raw.categories, raw.category),
    synonyms: normalizeSynonyms(raw.synonyms)
  };
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const actionRaw = typeof body.action === "string" ? body.action.trim() : "";
  const action: Action | null =
    actionRaw === "confirm" ||
    actionRaw === "revise" ||
    actionRaw === "reject" ||
    actionRaw === "not_needed" ||
    actionRaw === "later" ||
    actionRaw === "accept_proposal" ||
    actionRaw === "keep_both" ||
    actionRaw === "replace_with_new" ||
    actionRaw === "discard_new" ||
    actionRaw === "rewrite" ||
    actionRaw === "accept_existing" ||
    actionRaw === "accept_new"
      ? (actionRaw as Action)
      : null;
  let text = typeof body.text === "string" ? body.text.trim() : "";
  const glossaryPatch = normalizeGlossaryPatch(body.glossary);
  const glossaryExistingId =
    typeof body.glossary?.existing_id === "string"
      ? body.glossary.existing_id.trim()
      : "";
  const rejectNote = clipRejectNote(body.reject_note);

  if (!id || !action) {
    return NextResponse.json(
      { error: "id and action are required" },
      { status: 400 }
    );
  }
  if (action === "revise" && !text && !glossaryPatch) {
    return NextResponse.json(
      { error: "text or glossary is required for revise" },
      { status: 400 }
    );
  }

  let { data: current, error: loadError } = await admin
    .from("luna_learnings")
    .select(
      "id, content, status, source, evidence, thread, meta, author_id, assigned_to, category, review_reason, merge_target, duplicate_of, raw_input, created_at, merged_from"
    )
    .eq("id", id)
    .maybeSingle();

  if (loadError && /duplicate_of/i.test(loadError.message)) {
    const retry = await admin
      .from("luna_learnings")
      .select(
        "id, content, status, source, evidence, thread, meta, author_id, assigned_to, category, review_reason, merge_target, raw_input, created_at, merged_from"
      )
      .eq("id", id)
      .maybeSingle();
    current = retry.data
      ? { ...retry.data, duplicate_of: null }
      : retry.data;
    loadError = retry.error;
  }

  if (loadError) {
    console.error("[luna/candidates/respond] load", loadError);
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!current || current.status !== "candidate") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const thread = normalizeThread(current.thread);
  const evidence =
    typeof current.evidence === "string" ? current.evidence : null;
  const content =
    typeof current.content === "string" ? current.content : "";
  const reviewReason =
    typeof current.review_reason === "string" ? current.review_reason : null;
  const mergeTarget =
    typeof current.merge_target === "string" ? current.merge_target.trim() : "";
  const duplicateOf =
    typeof (current as { duplicate_of?: string | null }).duplicate_of === "string"
      ? String((current as { duplicate_of?: string | null }).duplicate_of).trim()
      : "";
  const rawInput =
    typeof current.raw_input === "string" ? current.raw_input.trim() : "";
  const createdAt =
    typeof current.created_at === "string" ? current.created_at : null;
  let prevMeta =
    current.meta && typeof current.meta === "object" && !Array.isArray(current.meta)
      ? (current.meta as Record<string, unknown>)
      : {};
  const isNoPath =
    action === "keep_both" ||
    action === "replace_with_new" ||
    action === "discard_new" ||
    action === "rewrite" ||
    action === "reject";
  if (isNoPath) {
    prevMeta = mergeRejectMeta(
      prevMeta,
      isRejectAction(action) ? action : null,
      rejectNote
    );
  }
  if (action === "reject" && !hasRejectMeta(prevMeta)) {
    return NextResponse.json(
      { error: "선택지 또는 거절 이유가 필요합니다" },
      { status: 400 }
    );
  }

  if (action === "later") {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin
      .from("luna_learnings")
      .update({ snoozed_until: until })
      .eq("id", id)
      .eq("status", "candidate");
    if (error) {
      console.error("[luna/candidates/respond] later", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: "later", snoozed_until: until });
  }

  const isDuplicateRow =
    reviewReason === "duplicate" || Boolean(duplicateOf || mergeTarget);

  if (
    isDuplicateRow &&
    (action === "accept_proposal" ||
      action === "keep_both" ||
      action === "replace_with_new" ||
      action === "discard_new" ||
      action === "rewrite" ||
      action === "accept_existing" ||
      action === "accept_new" ||
      action === "confirm")
  ) {
    const actives = await loadActiveKnowledge(admin);
    let matchId = duplicateOf || mergeTarget;
    let existing = matchId
      ? actives.find((a) => a.id === matchId) ?? null
      : null;
    if (!existing) {
      existing = findDuplicateMatches(content, actives, id)[0] ?? null;
      matchId = existing?.id ?? "";
    }
    if (!existing) {
      return NextResponse.json(
        { error: "겹치는 기존 지식을 찾지 못했습니다" },
        { status: 404 }
      );
    }

    let decision: DuplicateDecision;
    let sentence = text;
    if (action === "confirm" || action === "accept_proposal") {
      const cached = cachedProposal(prevMeta, existing.content, content);
      const kind = cached?.kind ?? "rewrite";
      if (kind === "keep_both") decision = "keep_both";
      else if (kind === "conflict") {
        return NextResponse.json(
          { error: "어느 쪽이 맞는지 골라 주세요" },
          { status: 400 }
        );
      } else if (kind === "update") {
        decision = "accept_proposal";
        sentence = cached?.sentence || content;
      } else {
        decision = "accept_proposal";
        sentence = cached?.sentence || rawInput || content;
      }
    } else if (action === "rewrite") {
      decision = "rewrite";
      if (!sentence) {
        return NextResponse.json({ error: "고친 문장이 필요합니다" }, { status: 400 });
      }
    } else {
      decision = action;
    }

    const applied = await applyDuplicateDecision(admin, {
      candidate: {
        id,
        content,
        created_at: createdAt,
        status: "candidate",
        meta: prevMeta,
        merged_from: (current as { merged_from?: unknown }).merged_from
      },
      existing,
      decision,
      sentence,
      userId: user.id,
      archiveDrop: isNoPath && hasRejectMeta(prevMeta)
    });
    if (!applied.ok) {
      return NextResponse.json({ error: applied.error }, { status: 500 });
    }
    return NextResponse.json({
      id,
      status: decision === "keep_both" ? "active" : "deleted",
      merged_into: applied.keep_id,
      keep_id: applied.keep_id
    });
  }

  if (action === "discard_new") {
    if (hasRejectMeta(prevMeta)) {
      const { error } = await admin
        .from("luna_learnings")
        .update({
          status: "archived",
          review_reason: null,
          merge_target: null,
          duplicate_of: null,
          meta: prevMeta,
          resolved_by: user.id,
          resolved_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("status", "candidate");
      if (error) {
        console.error("[luna/candidates/respond] discard new", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ id, status: "archived" });
    }
    const { error } = await admin.from("luna_learnings").delete().eq("id", id);
    if (error) {
      console.error("[luna/candidates/respond] discard new", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ id, status: "deleted" });
  }

  if (action === "accept_proposal") {
    const cachedNew = prevMeta.luna_new_review;
    if (cachedNew && typeof cachedNew === "object" && !Array.isArray(cachedNew)) {
      const s = (cachedNew as Record<string, unknown>).sentence;
      if (typeof s === "string" && s.trim()) {
        text = s.trim();
      }
    }
  } else if (
    action === "keep_both" ||
    action === "replace_with_new" ||
    action === "accept_existing" ||
    action === "accept_new"
  ) {
    return NextResponse.json(
      { error: "이 후보는 겹침이 아니라 그 처리를 할 수 없습니다" },
      { status: 400 }
    );
  }

  if (action === "reject") {
    const { data, error } = await admin
      .from("luna_learnings")
      .update({
        status: "archived",
        meta: prevMeta,
        resolved_by: user.id,
        resolved_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("status", "candidate")
      .select("id, status, thread, content")
      .maybeSingle();
    if (error) {
      console.error("[luna/candidates/respond] reject", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      id: data?.id,
      status: data?.status,
      content: data?.content,
      thread: normalizeThread(data?.thread)
    });
  }

  if (action === "not_needed") {
    const { data, error } = await admin
      .from("luna_learnings")
      .update({
        status: "archived",
        meta: { ...prevMeta, not_needed: true },
        resolved_by: user.id,
        resolved_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("status", "candidate")
      .select("id, status, thread, content, meta")
      .maybeSingle();
    if (error) {
      console.error("[luna/candidates/respond] not_needed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      id: data?.id,
      status: data?.status,
      content: data?.content,
      thread: normalizeThread(data?.thread),
      meta: data?.meta
    });
  }

  if (action === "revise") {
    const category =
      typeof current.category === "string" ? current.category : undefined;

    // 용어형: 필드별 구조화 저장 (AI 문답 생략)
    if (
      glossaryPatch &&
      isGlossaryCandidate(prevMeta, category)
    ) {
      const nextMeta = applyGlossaryMetaPatch(prevMeta, glossaryPatch);
      const nextContent =
        glossaryPatch.definition ||
        glossaryPatch.term_ko ||
        content;

      const { data, error } = await admin
        .from("luna_learnings")
        .update({
          content: nextContent,
          meta: nextMeta,
          category: "term"
        })
        .eq("id", id)
        .eq("status", "candidate")
        .select("id, status, content, thread, meta")
        .maybeSingle();

      if (error) {
        console.error("[luna/candidates/respond] glossary revise", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        id: data?.id,
        status: data?.status ?? "candidate",
        content: data?.content,
        meta: data?.meta ?? nextMeta,
        thread: normalizeThread(data?.thread ?? thread)
      });
    }

    // 중복 병합 후보: 수정문을 raw_input(병합 초안)에도 반영
    if (reviewReason === "duplicate" && mergeTarget) {
      const { data, error } = await admin
        .from("luna_learnings")
        .update({
          content: text,
          raw_input: text
        })
        .eq("id", id)
        .eq("status", "candidate")
        .select("id, status, content, thread, raw_input")
        .maybeSingle();

      if (error) {
        console.error("[luna/candidates/respond] duplicate revise", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        id: data?.id,
        status: data?.status ?? "candidate",
        content: data?.content,
        thread: normalizeThread(data?.thread ?? thread)
      });
    }

    const nextThread: ThreadTurn[] = [...thread, makeTurn("human", text)];
    const lunaText = understoodAsk(
      (await runDialogueTurn(admin, {
        mode: "revise",
        content,
        thread: nextThread,
        humanText: text,
        evidence
      })) || text
    );
    nextThread.push(makeTurn("luna", lunaText));

    // 사람 수정문을 초안에 반영 (확정 전 작업본)
    const { data, error } = await admin
      .from("luna_learnings")
      .update({
        content: text,
        thread: nextThread
      })
      .eq("id", id)
      .eq("status", "candidate")
      .select("id, status, content, thread")
      .maybeSingle();

    if (error) {
      console.error("[luna/candidates/respond] revise", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: data?.id,
      status: data?.status ?? "candidate",
      content: data?.content,
      thread: normalizeThread(data?.thread)
    });
  }

  // confirm
  const category =
    typeof current.category === "string" ? current.category : undefined;

  // 고쳐서 확정: glossary 패치가 오면 meta/content 에 바로 반영 후 등록
  let meta: Record<string, unknown> = { ...prevMeta };
  let workingContent = content;
  if (
    glossaryPatch &&
    (isGlossaryCandidate(prevMeta, category) || glossaryPatch.term_ko)
  ) {
    meta = applyGlossaryMetaPatch(prevMeta, glossaryPatch);
    workingContent =
      glossaryPatch.definition || glossaryPatch.term_ko || content;
  }

  const isGlossary = shouldRegisterGlossary(meta, category || (glossaryPatch ? "term" : null));
  if (isGlossary) {
    const draft = parseGlossaryMeta(meta, workingContent);
    if (
      !draft.term_ko.trim() ||
      looksLikeDefinitionSentence(draft.term_ko)
    ) {
      return NextResponse.json(
        { error: "용어명이 비어 있어 용어사전에 등록할 수 없습니다." },
        { status: 400 }
      );
    }

    const incoming = normalizeIncomingFields(draft);
    const dup = await checkGlossaryDuplicate(admin, incoming, null);
    if (
      !glossaryExistingId &&
      dup.conflicts &&
      dup.primary &&
      dup.existing
    ) {
      const merge_draft = await buildGlossaryMergeDraft(
        toFieldValues(dup.existing),
        incoming
      );
      return NextResponse.json(
        {
          error: "glossary_duplicate",
          conflicts: true,
          primary: dup.primary,
          others: dup.others,
          existing: dup.existing,
          incoming,
          merge_draft
        },
        { status: 409 }
      );
    }
  }

  // 용어형·직접 수정본도 원문 복사 없이 재진술. 맞아요만 윤문 허용이 아니라 LLM 우선.
  const polished = isGlossary
    ? stripConfirmClaim(
        (
          (typeof meta.definition === "string" && meta.definition.trim()) ||
          text ||
          workingContent
        ).trim()
      )
    : stripConfirmClaim(
        (await runDialogueTurn(admin, {
          mode: "confirm",
          content: workingContent,
          thread: text ? [...thread, makeTurn("human", text)] : thread,
          humanText: text || undefined,
          evidence
        })) ||
          text ||
          workingContent.trim()
      );

  let finalThread = thread;
  if (text) {
    finalThread = [...thread, makeTurn("human", text)];
  }
  finalThread = [
    ...finalThread,
    makeTurn("luna", understoodAsk(polished))
  ];

  let glossary_registered: boolean | undefined;
  let glossary_notice: string | undefined;
  if (isGlossary) {
    const glossaryResult = await tryRegisterGlossaryFromCandidate(
      admin,
      user.id,
      meta,
      polished,
      { existingId: glossaryExistingId || null }
    );
    glossary_registered = glossaryResult.registered;
    if (glossaryResult.notice) glossary_notice = glossaryResult.notice;
    if (
      glossaryResult.conflict?.conflicts &&
      glossaryResult.conflict.primary &&
      glossaryResult.conflict.existing
    ) {
      const merge_draft = await buildGlossaryMergeDraft(
        toFieldValues(glossaryResult.conflict.existing),
        glossaryResult.conflict.incoming
      );
      return NextResponse.json(
        {
          error: "glossary_duplicate",
          conflicts: true,
          primary: glossaryResult.conflict.primary,
          others: glossaryResult.conflict.others,
          existing: glossaryResult.conflict.existing,
          incoming: glossaryResult.conflict.incoming,
          merge_draft
        },
        { status: 409 }
      );
    }
    if (!glossaryResult.registered) {
      return NextResponse.json(
        { error: glossary_notice || "용어사전 등록에 실패했습니다." },
        { status: 400 }
      );
    }
    meta = {
      ...meta,
      glossary_registered: true,
      glossary_term_id: glossaryResult.term_id ?? null
    };
  }

  const confirmPatch: Record<string, unknown> = {
    content: polished,
    status: isGlossary ? "archived" : "active",
    thread: finalThread,
    confidence: 4,
    importance: 4,
    resolved_by: user.id,
    resolved_at: new Date().toISOString()
  };
  if (isGlossary) {
    confirmPatch.meta = meta;
    confirmPatch.category = "term";
  } else if (hasRejectMeta(meta)) {
    confirmPatch.meta = meta;
  }

  const { data, error } = await admin
    .from("luna_learnings")
    .update(confirmPatch)
    .eq("id", id)
    .eq("status", "candidate")
    .select("id, status, content, thread")
    .maybeSingle();

  if (error) {
    console.error("[luna/candidates/respond] confirm", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    content: data.content,
    thread: normalizeThread(data.thread),
    glossary_registered,
    glossary_notice
  });
}
