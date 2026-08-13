import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  shouldRegisterGlossary,
  tryRegisterGlossaryFromCandidate
} from "@/lib/luna/candidate-glossary";
import { normalizeCategories } from "@/lib/glossary/categories";
import type { GlossaryCategory } from "@/lib/glossary/types";
import {
  isGlossaryCandidate,
  looksLikeDefinitionSentence,
  parseGlossaryMeta
} from "@/lib/luna/candidate-format";
import {
  makeTurn,
  normalizeThread,
  runDialogueTurn,
  type ThreadTurn
} from "@/lib/luna/candidates";
export const runtime = "nodejs";

type Action = "confirm" | "revise" | "reject" | "not_needed";

type GlossaryPatch = {
  term_ko?: string;
  term_en?: string | null;
  term_zh?: string | null;
  definition?: string;
  categories?: unknown;
  category?: unknown;
};

type Body = {
  id?: string;
  action?: string;
  text?: string;
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
} | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    term_ko: typeof raw.term_ko === "string" ? raw.term_ko.trim() : "",
    term_en:
      typeof raw.term_en === "string" && raw.term_en.trim()
        ? raw.term_en.trim()
        : null,
    term_zh:
      typeof raw.term_zh === "string" && raw.term_zh.trim()
        ? raw.term_zh.trim()
        : null,
    definition:
      typeof raw.definition === "string" ? raw.definition.trim() : "",
    categories: normalizeCategories(raw.categories, raw.category)
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
    actionRaw === "not_needed"
      ? actionRaw
      : null;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const glossaryPatch = normalizeGlossaryPatch(body.glossary);

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

  const { data: current, error: loadError } = await admin
    .from("luna_learnings")
    .select(
      "id, content, status, source, evidence, thread, meta, author_id, assigned_to, category, review_reason, merge_target, raw_input"
    )
    .eq("id", id)
    .maybeSingle();

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
  const rawInput =
    typeof current.raw_input === "string" ? current.raw_input.trim() : "";
  const prevMeta =
    current.meta && typeof current.meta === "object" && !Array.isArray(current.meta)
      ? (current.meta as Record<string, unknown>)
      : {};

  if (action === "reject") {
    // 중복 후보 반려: 후보만 archived (본문 merge_target 은 그대로)
    const { data, error } = await admin
      .from("luna_learnings")
      .update({
        status: "archived",
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
      const nextMeta: Record<string, unknown> = {
        ...prevMeta,
        kind: "glossary",
        term_ko: glossaryPatch.term_ko,
        term_en: glossaryPatch.term_en,
        term_zh: glossaryPatch.term_zh,
        definition: glossaryPatch.definition,
        categories: glossaryPatch.categories
      };
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
    const lunaText =
      (await runDialogueTurn(admin, {
        mode: "revise",
        content,
        thread: nextThread,
        humanText: text,
        evidence
      })) || `고친 내용으로 이렇게 이해했어요: ${text} 맞아요?`;
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

  // confirm — 정리 중복 후보: 본문에 병합 후 후보는 archived
  if (reviewReason === "duplicate" && mergeTarget) {
    const merged = (text || rawInput || content).trim();
    if (!merged) {
      return NextResponse.json(
        { error: "duplicate candidate missing merge draft" },
        { status: 400 }
      );
    }

    const { data: keepRow, error: keepLoadError } = await admin
      .from("luna_learnings")
      .select("id, content, status")
      .eq("id", mergeTarget)
      .eq("status", "active")
      .maybeSingle();

    if (keepLoadError) {
      console.error("[luna/candidates/respond] duplicate keep load", keepLoadError);
      return NextResponse.json({ error: keepLoadError.message }, { status: 500 });
    }
    if (!keepRow) {
      return NextResponse.json(
        { error: "merge_target not found or not active" },
        { status: 404 }
      );
    }

    const { data: lastVer } = await admin
      .from("luna_learning_versions")
      .select("version")
      .eq("learning_id", mergeTarget)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion =
      typeof lastVer?.version === "number" && Number.isFinite(lastVer.version)
        ? lastVer.version + 1
        : 1;

    const { data: profile } = await admin
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();
    const editorName =
      typeof profile?.name === "string" && profile.name.trim()
        ? profile.name.trim()
        : null;

    const { error: verError } = await admin.from("luna_learning_versions").insert({
      learning_id: mergeTarget,
      version: nextVersion,
      content: typeof keepRow.content === "string" ? keepRow.content : "",
      status: "active",
      change_note: "중복 병합",
      edited_by: user.id,
      editor_name: editorName
    });
    if (verError) {
      console.error("[luna/candidates/respond] duplicate version", verError);
      return NextResponse.json({ error: verError.message }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    const { error: keepError } = await admin
      .from("luna_learnings")
      .update({
        content: merged,
        resolved_by: user.id,
        resolved_at: nowIso
      })
      .eq("id", mergeTarget)
      .eq("status", "active");

    if (keepError) {
      console.error("[luna/candidates/respond] duplicate keep update", keepError);
      return NextResponse.json({ error: keepError.message }, { status: 500 });
    }

    const { data, error } = await admin
      .from("luna_learnings")
      .update({
        status: "archived",
        meta: { ...prevMeta, merged_into: mergeTarget },
        resolved_by: user.id,
        resolved_at: nowIso
      })
      .eq("id", id)
      .eq("status", "candidate")
      .select("id, status, content, thread, meta")
      .maybeSingle();

    if (error) {
      console.error("[luna/candidates/respond] duplicate archive", error);
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
      meta: data.meta,
      merged_into: mergeTarget
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
    meta = {
      ...prevMeta,
      kind: "glossary",
      term_ko: glossaryPatch.term_ko,
      term_en: glossaryPatch.term_en,
      term_zh: glossaryPatch.term_zh,
      definition: glossaryPatch.definition,
      categories: glossaryPatch.categories
    };
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
  }

  // 용어형·직접 수정본은 AI 윤문 없이 확정. 맞아요만 윤문 허용.
  const polished = isGlossary
    ? (
        (typeof meta.definition === "string" && meta.definition.trim()) ||
        text ||
        workingContent
      ).trim()
    : text
      ? text
      : (await runDialogueTurn(admin, {
          mode: "confirm",
          content: workingContent,
          thread,
          evidence
        })) || workingContent.trim();

  let finalThread = thread;
  if (text) {
    finalThread = [...thread, makeTurn("human", text)];
  }
  finalThread = [
    ...finalThread,
    makeTurn(
      "luna",
      isGlossary
        ? `용어사전에 등록했어요: ${polished}`
        : `확정했어요: ${polished}`
    )
  ];

  const confirmPatch: Record<string, unknown> = {
    content: polished,
    status: "active",
    thread: finalThread,
    confidence: 4,
    importance: 4,
    resolved_by: user.id,
    resolved_at: new Date().toISOString()
  };
  if (glossaryPatch && isGlossary) {
    confirmPatch.meta = meta;
    confirmPatch.category = "term";
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

  let glossary_registered: boolean | undefined;
  let glossary_notice: string | undefined;
  if (isGlossary) {
    const glossaryResult = await tryRegisterGlossaryFromCandidate(
      admin,
      user.id,
      meta,
      polished
    );
    glossary_registered = glossaryResult.registered;
    if (glossaryResult.notice) glossary_notice = glossaryResult.notice;
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
