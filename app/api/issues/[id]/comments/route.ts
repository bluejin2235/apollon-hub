import { NextRequest, NextResponse } from "next/server";
import { canManageIssueStatus, requireIssueUser } from "@/lib/issues/access";
import { mentionedNames, sanitizeIssueHtml, wrapMentionNames } from "@/lib/issues/html";
import { notifyCommentInApp, notifyMentioned, notifyStatusInApp } from "@/lib/issues/notify";

export const runtime = "nodejs";

type IssueRow = {
  id: string;
  seq: number;
  title: string;
  status: string;
  author_id: string;
  assignee_id: string | null;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;
  const { id } = await context.params;

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = typeof payload.body === "string" ? payload.body : "";
  const markDone = payload.mark_done === true;
  const numeric = /^\d+$/.test(id);
  const query = gate.admin
    .from("issues")
    .select("id, seq, title, status, author_id, assignee_id");
  const found = numeric
    ? await query.eq("seq", Number(id)).maybeSingle()
    : await query.eq("id", id).maybeSingle();
  const row = found.data as IssueRow | null;
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: members } = await gate.admin
    .from("profiles")
    .select("id, name, email")
    .neq("role", "홈페이지테스터");
  const names = (members ?? [])
    .map((m) => String(m.name ?? "").trim())
    .filter(Boolean);
  const html = wrapMentionNames(sanitizeIssueHtml(raw), names);
  if (!html.replace(/<[^>]+>/g, "").trim() && !markDone) {
    return NextResponse.json({ error: "댓글을 적어 주세요" }, { status: 400 });
  }

  const { data: actor } = await gate.admin
    .from("profiles")
    .select("name")
    .eq("id", gate.user.id)
    .maybeSingle();
  const actorName = (actor?.name as string | undefined)?.trim() || "—";

  if (html.replace(/<[^>]+>/g, "").trim()) {
    const { error } = await gate.admin.from("issue_comments").insert({
      issue_id: row.id,
      author_id: gate.user.id,
      body: html
    });
    if (error) {
      console.error("[issues] comment", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await gate.admin.from("issue_watchers").upsert({
      issue_id: row.id,
      user_id: gate.user.id
    });
    const { data: watchers } = await gate.admin
      .from("issue_watchers")
      .select("user_id")
      .eq("issue_id", row.id);
    await notifyCommentInApp(gate.admin, {
      seq: Number(row.seq),
      issueId: row.id as string,
      title: String(row.title),
      authorId: row.author_id as string,
      commenterId: gate.user.id,
      commenterName: actorName,
      watcherIds: (watchers ?? []).map((w) => w.user_id as string)
    });
    const mentioned = mentionedNames(html, names);
    if (mentioned.length > 0) {
      await notifyMentioned(gate.admin, {
        seq: Number(row.seq),
        issueId: row.id as string,
        title: String(row.title),
        actorId: gate.user.id,
        actorName,
        names: mentioned,
        members: (members ?? []) as { id: string; name: string | null; email: string | null }[]
      });
    }
  }

  if (markDone) {
    const manage = canManageIssueStatus({
      isAdmin: gate.isAdmin,
      userId: gate.user.id,
      authorId: row.author_id,
      assigneeId: (row.assignee_id as string | null) ?? null
    });
    if (!manage) {
      return NextResponse.json({ error: "상태를 바꿀 수 없습니다" }, { status: 403 });
    }
    const fromStatus = String(row.status);
    if (fromStatus !== "완료") {
      const { error } = await gate.admin
        .from("issues")
        .update({
          status: "완료",
          closed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);
      if (error) {
        console.error("[issues] comment done", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await gate.admin.from("issue_events").insert({
        issue_id: row.id,
        actor_id: gate.user.id,
        kind: "status",
        from_value: fromStatus,
        to_value: "완료"
      });
      await notifyStatusInApp(gate.admin, {
        seq: Number(row.seq),
        issueId: row.id as string,
        title: String(row.title),
        authorId: row.author_id as string,
        actorId: gate.user.id,
        fromStatus,
        toStatus: "완료"
      });
    }
  }

  return NextResponse.json({ ok: true });
}
