import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canAssignIssue,
  canEditIssueContent,
  canManageIssueStatus,
  requireIssueUser
} from "@/lib/issues/access";
import { mentionedNames, sanitizeIssueHtml, wrapMentionNames } from "@/lib/issues/html";
import { notifyAssigned, notifyMentioned, notifyStatusInApp } from "@/lib/issues/notify";
import {
  isIssueArea,
  isIssueKind,
  isIssueStatus,
  type IssueDetail,
  type IssueEventKind,
  type IssueKind,
  type IssueStatus,
  type IssueTimelineItem
} from "@/lib/issues/types";

export const runtime = "nodejs";

type IssueRow = {
  id: string;
  seq: number;
  kind: IssueKind;
  area: string;
  title: string;
  body: string | null;
  status: IssueStatus;
  author_id: string;
  assignee_id: string | null;
  created_at: string;
  closed_at: string | null;
};

type ProfileRow = { id: string; name: string | null; email: string | null };

function displayName(profile: ProfileRow | undefined): string {
  return profile?.name?.trim() || "—";
}

function parseIssueEventKind(kind: string): IssueEventKind {
  if (kind === "assignee" || kind === "edit") return kind;
  return "status";
}

async function findIssue(admin: SupabaseClient, key: string): Promise<IssueRow | null> {
  const numeric = /^\d+$/.test(key);
  const query = admin
    .from("issues")
    .select("id, seq, kind, area, title, body, status, author_id, assignee_id, created_at, closed_at");
  const { data, error } = numeric
    ? await query.eq("seq", Number(key)).maybeSingle()
    : await query.eq("id", key).maybeSingle();
  if (error) {
    console.error("[issues] find", error);
    return null;
  }
  return (data as IssueRow | null) ?? null;
}

async function loadProfiles(admin: SupabaseClient, ids: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, name, email").in("id", unique);
  for (const row of data ?? []) {
    map.set(row.id as string, row as ProfileRow);
  }
  return map;
}

async function loadMembers(admin: SupabaseClient): Promise<ProfileRow[]> {
  const { data } = await admin
    .from("profiles")
    .select("id, name, email")
    .neq("role", "홈페이지테스터")
    .order("name");
  return (data ?? []) as ProfileRow[];
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;
  const { id } = await context.params;
  const issue = await findIssue(gate.admin, id);
  if (!issue) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [{ data: comments }, { data: events }, { data: watchers }] = await Promise.all([
    gate.admin
      .from("issue_comments")
      .select("id, author_id, body, created_at")
      .eq("issue_id", issue.id)
      .order("created_at", { ascending: true }),
    gate.admin
      .from("issue_events")
      .select("id, actor_id, kind, from_value, to_value, created_at")
      .eq("issue_id", issue.id)
      .order("created_at", { ascending: true }),
    gate.admin.from("issue_watchers").select("user_id").eq("issue_id", issue.id)
  ]);

  const watcherIds = (watchers ?? []).map((row) => row.user_id as string);
  const people = await loadProfiles(gate.admin, [
    issue.author_id,
    issue.assignee_id ?? "",
    ...((comments ?? []).map((row) => row.author_id as string)),
    ...((events ?? []).map((row) => row.actor_id as string)),
    ...watcherIds
  ]);

  const timeline: IssueTimelineItem[] = [];
  timeline.push({
    type: "body",
    id: `body-${issue.id}`,
    author_id: issue.author_id,
    author_name: displayName(people.get(issue.author_id)),
    body: issue.body ?? "",
    created_at: issue.created_at
  });
  for (const row of comments ?? []) {
    timeline.push({
      type: "comment",
      id: row.id as string,
      author_id: row.author_id as string,
      author_name: displayName(people.get(row.author_id as string)),
      body: (row.body as string) ?? "",
      created_at: row.created_at as string
    });
  }
  for (const row of events ?? []) {
    timeline.push({
      type: "event",
      id: row.id as string,
      actor_id: row.actor_id as string,
      actor_name: displayName(people.get(row.actor_id as string)),
      kind: parseIssueEventKind(row.kind as string),
      from_value: (row.from_value as string | null) ?? null,
      to_value: (row.to_value as string | null) ?? null,
      created_at: row.created_at as string
    });
  }
  timeline.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const memberRows = await loadMembers(gate.admin);
  const members = memberRows
    .map((m) => ({ id: m.id, name: (m.name ?? "").trim() }))
    .filter((m) => m.name);

  const detail: IssueDetail = {
    id: issue.id,
    seq: Number(issue.seq),
    kind: issue.kind,
    area: issue.area,
    title: issue.title,
    body: issue.body ?? "",
    status: issue.status,
    author_id: issue.author_id,
    author_name: displayName(people.get(issue.author_id)),
    assignee_id: issue.assignee_id,
    assignee_name: issue.assignee_id ? displayName(people.get(issue.assignee_id)) : null,
    created_at: issue.created_at,
    closed_at: issue.closed_at,
    watchers: watcherIds
      .map((userId) => ({
        id: userId,
        name: displayName(people.get(userId))
      }))
      .filter((row) => row.name !== "—"),
    timeline,
    members,
    watching: watcherIds.includes(gate.user.id),
    can_manage: canManageIssueStatus({
      isAdmin: gate.isAdmin,
      userId: gate.user.id,
      authorId: issue.author_id,
      assigneeId: issue.assignee_id
    }),
    can_assign: canAssignIssue({
      isAdmin: gate.isAdmin,
      userId: gate.user.id,
      assigneeId: issue.assignee_id
    }),
    can_edit: canEditIssueContent({
      isAdmin: gate.isAdmin,
      userId: gate.user.id,
      authorId: issue.author_id
    })
  };

  return NextResponse.json(detail);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;
  const { id } = await context.params;
  const issue = await findIssue(gate.admin, id);
  if (!issue) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const manage = canManageIssueStatus({
    isAdmin: gate.isAdmin,
    userId: gate.user.id,
    authorId: issue.author_id,
    assigneeId: issue.assignee_id
  });
  const canAssign = canAssignIssue({
    isAdmin: gate.isAdmin,
    userId: gate.user.id,
    assigneeId: issue.assignee_id
  });
  const canEdit = canEditIssueContent({
    isAdmin: gate.isAdmin,
    userId: gate.user.id,
    authorId: issue.author_id
  });

  const patch: Record<string, unknown> = {};
  const events: Array<{
    kind: IssueEventKind;
    from_value: string | null;
    to_value: string | null;
  }> = [];

  const { data: actor } = await gate.admin
    .from("profiles")
    .select("name")
    .eq("id", gate.user.id)
    .maybeSingle();
  const actorName = (actor?.name as string | undefined)?.trim() || "—";

  if ("status" in body) {
    if (!manage) {
      return NextResponse.json({ error: "상태를 바꿀 수 없습니다" }, { status: 403 });
    }
    const status = typeof body.status === "string" ? body.status : "";
    if (!isIssueStatus(status)) {
      return NextResponse.json({ error: "상태가 올바르지 않습니다" }, { status: 400 });
    }
    if (status !== issue.status) {
      patch.status = status;
      patch.closed_at = status === "완료" || status === "취소" ? new Date().toISOString() : null;
      events.push({ kind: "status", from_value: issue.status, to_value: status });
    }
  }

  if ("assignee_id" in body) {
    if (!canAssign) {
      return NextResponse.json({ error: "맡은 사람을 바꿀 수 없습니다" }, { status: 403 });
    }
    if (!gate.isAdmin && !issue.assignee_id) {
      return NextResponse.json({ error: "맡은 사람을 바꿀 수 없습니다" }, { status: 403 });
    }
    const nextId =
      body.assignee_id === null || body.assignee_id === ""
        ? null
        : typeof body.assignee_id === "string"
          ? body.assignee_id
          : null;
    if (nextId !== issue.assignee_id) {
      const people = await loadProfiles(gate.admin, [issue.assignee_id ?? "", nextId ?? ""]);
      patch.assignee_id = nextId;
      events.push({
        kind: "assignee",
        from_value: issue.assignee_id ? displayName(people.get(issue.assignee_id)) : "—",
        to_value: nextId ? displayName(people.get(nextId)) : "—"
      });
    }
  }

  if ("title" in body || "body" in body || "kind" in body || "area" in body) {
    if (!canEdit) {
      return NextResponse.json({ error: "본문은 올린 사람만 고칩니다" }, { status: 403 });
    }
    let contentChanged = false;
    if (typeof body.title === "string" && body.title.trim() && body.title.trim() !== issue.title) {
      patch.title = body.title.trim();
      contentChanged = true;
    }
    if (typeof body.body === "string") {
      const members = await loadMembers(gate.admin);
      const names = members.map((m) => (m.name ?? "").trim()).filter(Boolean);
      const nextBody = wrapMentionNames(sanitizeIssueHtml(body.body), names);
      if (nextBody !== (issue.body ?? "")) {
        patch.body = nextBody;
        contentChanged = true;
      }
    }
    if ("kind" in body) {
      const kind = typeof body.kind === "string" ? body.kind : "";
      if (!isIssueKind(kind)) {
        return NextResponse.json({ error: "종류가 올바르지 않습니다" }, { status: 400 });
      }
      if (kind !== issue.kind) {
        patch.kind = kind;
        contentChanged = true;
      }
    }
    if ("area" in body) {
      const area = typeof body.area === "string" ? body.area : "";
      if (!isIssueArea(area)) {
        return NextResponse.json({ error: "서비스가 올바르지 않습니다" }, { status: 400 });
      }
      if (area !== issue.area) {
        patch.area = area;
        contentChanged = true;
      }
    }
    if (contentChanged) {
      events.push({ kind: "edit", from_value: null, to_value: null });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  patch.updated_at = new Date().toISOString();
  const { error } = await gate.admin.from("issues").update(patch).eq("id", issue.id);
  if (error) {
    console.error("[issues] update", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (events.length > 0) {
    const { error: eventError } = await gate.admin.from("issue_events").insert(
      events.map((event) => ({
        issue_id: issue.id,
        actor_id: gate.user.id,
        kind: event.kind,
        from_value: event.from_value,
        to_value: event.to_value
      }))
    );
    if (eventError) {
      console.error("[issues] events", eventError);
    }
  }

  const statusEvent = events.find((event) => event.kind === "status");
  if (statusEvent) {
    await notifyStatusInApp(gate.admin, {
      seq: Number(issue.seq),
      issueId: issue.id,
      title: issue.title,
      authorId: issue.author_id,
      actorId: gate.user.id,
      fromStatus: statusEvent.from_value ?? "",
      toStatus: statusEvent.to_value ?? ""
    });
  }

  const assignEvent = events.find((event) => event.kind === "assignee");
  if (assignEvent && typeof patch.assignee_id === "string") {
    await gate.admin.from("issue_watchers").upsert({
      issue_id: issue.id,
      user_id: patch.assignee_id
    });
    await notifyAssigned(gate.admin, {
      seq: Number(issue.seq),
      issueId: issue.id,
      title: issue.title,
      assigneeId: patch.assignee_id,
      actorId: gate.user.id,
      actorName
    });
  }

  if (typeof patch.body === "string") {
    const members = await loadMembers(gate.admin);
    const names = members.map((m) => (m.name ?? "").trim()).filter(Boolean);
    const mentioned = mentionedNames(patch.body, names);
    if (mentioned.length > 0) {
      await notifyMentioned(gate.admin, {
        seq: Number(issue.seq),
        issueId: issue.id,
        title: typeof patch.title === "string" ? patch.title : issue.title,
        actorId: gate.user.id,
        actorName,
        names: mentioned,
        members
      });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;
  const { id } = await context.params;
  const issue = await findIssue(gate.admin, id);
  if (!issue) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (issue.author_id !== gate.user.id && !gate.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { error } = await gate.admin.from("issues").delete().eq("id", issue.id);
  if (error) {
    console.error("[issues] delete", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
