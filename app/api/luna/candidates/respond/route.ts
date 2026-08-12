import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  shouldRegisterGlossary,
  tryRegisterGlossaryFromCandidate
} from "@/lib/luna/candidate-glossary";
import {
  makeTurn,
  normalizeThread,
  runDialogueTurn,
  type ThreadTurn
} from "@/lib/luna/candidates";
import { lunaNotify } from "@/lib/luna/notify";

export const runtime = "nodejs";

type Action = "confirm" | "revise" | "reject" | "not_needed";

type Body = {
  id?: string;
  action?: string;
  text?: string;
};

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

  if (!id || !action) {
    return NextResponse.json(
      { error: "id and action are required" },
      { status: 400 }
    );
  }
  if (action === "revise" && !text) {
    return NextResponse.json(
      { error: "text is required for revise" },
      { status: 400 }
    );
  }

  const { data: current, error: loadError } = await admin
    .from("luna_learnings")
    .select(
      "id, content, status, source, evidence, thread, meta, author_id, assigned_to, category"
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

  if (action === "reject") {
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
    const prevMeta =
      current.meta && typeof current.meta === "object" && !Array.isArray(current.meta)
        ? (current.meta as Record<string, unknown>)
        : {};
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

  // confirm
  const polished =
    (await runDialogueTurn(admin, {
      mode: "confirm",
      content: text || content,
      thread,
      humanText: text || undefined,
      evidence
    })) || (text || content).trim();

  let finalThread = thread;
  if (text) {
    finalThread = [...thread, makeTurn("human", text)];
  }
  finalThread = [
    ...finalThread,
    makeTurn("luna", `확정했어요: ${polished}`)
  ];

  const { data, error } = await admin
    .from("luna_learnings")
    .update({
      content: polished,
      status: "active",
      thread: finalThread,
      confidence: 4,
      importance: 4,
      resolved_by: user.id,
      resolved_at: new Date().toISOString()
    })
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
  const meta =
    current.meta && typeof current.meta === "object" && !Array.isArray(current.meta)
      ? (current.meta as Record<string, unknown>)
      : {};
  const category =
    typeof current.category === "string" ? current.category : undefined;
  if (shouldRegisterGlossary(meta, category)) {
    const glossaryResult = await tryRegisterGlossaryFromCandidate(
      admin,
      user.id,
      meta,
      polished
    );
    glossary_registered = glossaryResult.registered;
    if (glossaryResult.notice) glossary_notice = glossaryResult.notice;
  }

  await lunaNotify(
    admin,
    "reflect",
    glossary_registered ? "용어사전 등록" : "기억 확정",
    glossary_registered
      ? `용어가 사전에 등록됐어요: ${polished.slice(0, 80)}`
      : `후보가 기억으로 확정됐어요: ${polished.slice(0, 80)}`,
    { level: "success", meta: { learning_id: id } }
  );

  return NextResponse.json({
    id: data.id,
    status: data.status,
    content: data.content,
    thread: normalizeThread(data.thread),
    glossary_registered,
    glossary_notice
  });
}
