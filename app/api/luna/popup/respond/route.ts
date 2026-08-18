import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  makeTurn,
  normalizeThread,
  runDialogueTurn,
  stripConfirmClaim,
  understoodAsk,
  type ThreadTurn
} from "@/lib/luna/candidates";

export const runtime = "nodejs";

type Action = "answer" | "yes" | "no" | "later";

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
    actionRaw === "answer" ||
    actionRaw === "yes" ||
    actionRaw === "no" ||
    actionRaw === "later"
      ? actionRaw
      : null;
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!id || !action) {
    return NextResponse.json(
      { error: "id and action are required" },
      { status: 400 }
    );
  }
  if (action === "answer" && !text) {
    return NextResponse.json(
      { error: "text is required for answer" },
      { status: 400 }
    );
  }

  const { data: current, error: loadError } = await admin
    .from("luna_learnings")
    .select(
      "id, content, status, source, evidence, thread, assigned_to, meta"
    )
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("[luna/popup/respond] load", loadError);
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (
    !current ||
    current.status !== "candidate" ||
    current.source !== "question" ||
    current.assigned_to !== user.id
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const content = typeof current.content === "string" ? current.content : "";
  const evidence =
    typeof current.evidence === "string" ? current.evidence : null;
  const thread = normalizeThread(current.thread);

  if (action === "later") {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin
      .from("luna_learnings")
      .update({ snoozed_until: until })
      .eq("id", id)
      .eq("status", "candidate");
    if (error) {
      console.error("[luna/popup/respond] later", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      action: "later",
      snoozed_until: until,
      message: "나중에 다시 여쭤볼게요"
    });
  }

  const humanText =
    action === "yes"
      ? "네 맞아요"
      : action === "no"
        ? "아니에요"
        : text;

  const nextThread: ThreadTurn[] = [...thread, makeTurn("human", humanText)];

  if (action === "yes") {
    const polished = stripConfirmClaim(
      (await runDialogueTurn(admin, {
        mode: "confirm",
        content,
        thread: nextThread,
        humanText,
        evidence
      })) || content.trim()
    );

    nextThread.push(makeTurn("luna", understoodAsk(polished)));

    const { error } = await admin
      .from("luna_learnings")
      .update({
        content: polished,
        status: "active",
        thread: nextThread,
        snoozed_until: null,
        confidence: 4,
        importance: 4,
        resolved_by: user.id,
        resolved_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("status", "candidate");

    if (error) {
      console.error("[luna/popup/respond] yes", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      action: "yes",
      status: "active",
      content: polished,
      message: "고마워요. 기억으로 넣었습니다."
    });
  }

  // answer / no → 문답 계속 (후보함에서 이어감)
  const rawLuna =
    (await runDialogueTurn(admin, {
      mode: "revise",
      content,
      thread: nextThread,
      humanText,
      evidence
    })) || null;
  const lunaText =
    action === "no"
      ? rawLuna || "알겠어요. 어떻게 고치면 좋을까요?"
      : understoodAsk(rawLuna || humanText);

  nextThread.push(makeTurn("luna", lunaText));

  const nextContent = action === "answer" && text ? text : content;

  const { error } = await admin
    .from("luna_learnings")
    .update({
      content: nextContent,
      thread: nextThread,
      snoozed_until: null
    })
    .eq("id", id)
    .eq("status", "candidate");

  if (error) {
    console.error("[luna/popup/respond] revise", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    action,
    status: "candidate",
    content: nextContent,
    thread: nextThread,
    message: "반영했어요. 맞으면 확정해 주세요."
  });
}
