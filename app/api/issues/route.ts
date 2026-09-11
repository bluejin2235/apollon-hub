import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireIssueUser } from "@/lib/issues/access";
import { mentionedNames, sanitizeIssueHtml, wrapMentionNames, issuePlainText } from "@/lib/issues/html";
import { notifyMentioned, notifyNewIssue } from "@/lib/issues/notify";
import {
  isIssueArea,
  isIssueKind,
  isIssueSort,
  isIssueStatus,
  type IssueCounts,
  type IssueKind,
  type IssueListItem,
  type IssueStatus
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
};

type ProfileRow = { id: string; name: string | null; email: string | null };

function emptyCounts(): IssueCounts {
  return { 접수: 0, "실행 중": 0, 완료: 0, 보류: 0, 취소: 0 };
}

async function loadProfiles(
  admin: SupabaseClient,
  ids: string[]
): Promise<Map<string, ProfileRow>> {
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

function displayName(profile: ProfileRow | undefined): string {
  return profile?.name?.trim() || "—";
}

export async function GET(request: NextRequest) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;

  const summary = request.nextUrl.searchParams.get("summary") === "1";
  const { data, error } = await gate.admin
    .from("issues")
    .select("id, seq, kind, area, title, body, status, author_id, assignee_id, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[issues] list", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as IssueRow[];
  const counts = emptyCounts();
  for (const row of rows) {
    if (row.status in counts) counts[row.status] += 1;
  }

  if (summary) {
    const recent = rows.slice(0, 2).map((row) => ({
      id: row.id,
      seq: row.seq,
      kind: row.kind,
      title: row.title
    }));
    return NextResponse.json({
      접수: counts.접수,
      "실행 중": counts["실행 중"],
      recent
    });
  }

  const statusFilter = request.nextUrl.searchParams.get("status") ?? "";
  const kindFilter = request.nextUrl.searchParams.get("kind") ?? "";
  const areaFilter = request.nextUrl.searchParams.get("area") ?? "";
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const sortRaw = request.nextUrl.searchParams.get("sort") ?? "최신순";
  const sort = isIssueSort(sortRaw) ? sortRaw : "최신순";

  let filtered = rows;
  if (isIssueStatus(statusFilter)) {
    filtered = filtered.filter((row) => row.status === statusFilter);
  }
  if (isIssueKind(kindFilter)) {
    filtered = filtered.filter((row) => row.kind === kindFilter);
  }
  if (areaFilter) {
    filtered = filtered.filter((row) => row.area === areaFilter);
  }
  if (q) {
    filtered = filtered.filter((row) => {
      const body = issuePlainText(row.body ?? "").toLowerCase();
      return row.title.toLowerCase().includes(q) || body.includes(q);
    });
  }

  const ids = filtered.map((row) => row.id);
  const commentCount = new Map<string, number>();
  if (ids.length > 0) {
    const { data: comments } = await gate.admin
      .from("issue_comments")
      .select("issue_id")
      .in("issue_id", ids);
    for (const row of comments ?? []) {
      const issueId = row.issue_id as string;
      commentCount.set(issueId, (commentCount.get(issueId) ?? 0) + 1);
    }
  }

  if (sort === "오래된순") {
    filtered = [...filtered].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  } else if (sort === "댓글 많은순") {
    filtered = [...filtered].sort(
      (a, b) => (commentCount.get(b.id) ?? 0) - (commentCount.get(a.id) ?? 0)
    );
  }

  const people = await loadProfiles(
    gate.admin,
    filtered.flatMap((row) => [row.author_id, row.assignee_id ?? ""])
  );
  const members = await loadMembers(gate.admin);
  const { data: meRow } = await gate.admin
    .from("profiles")
    .select("id, name")
    .eq("id", gate.user.id)
    .maybeSingle();

  const issues: IssueListItem[] = filtered.map((row) => ({
    id: row.id,
    seq: Number(row.seq),
    kind: row.kind,
    area: row.area,
    title: row.title,
    status: row.status,
    author_id: row.author_id,
    author_name: displayName(people.get(row.author_id)),
    assignee_id: row.assignee_id,
    assignee_name: row.assignee_id ? displayName(people.get(row.assignee_id)) : null,
    created_at: row.created_at,
    comment_count: commentCount.get(row.id) ?? 0
  }));

  return NextResponse.json({
    issues,
    counts,
    members: members
      .map((m) => ({ id: m.id, name: (m.name ?? "").trim() }))
      .filter((m) => m.name),
    me: {
      id: gate.user.id,
      name: (meRow?.name as string | undefined)?.trim() || "—",
      is_admin: gate.isAdmin
    }
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind : "";
  const area = typeof body.area === "string" ? body.area : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const rawBody = typeof body.body === "string" ? body.body : "";
  if (!isIssueKind(kind) || !isIssueArea(area) || !title) {
    return NextResponse.json({ error: "제목과 종류·서비스를 적어 주세요" }, { status: 400 });
  }

  const members = await loadMembers(gate.admin);
  const names = members.map((m) => (m.name ?? "").trim()).filter(Boolean);
  const html = wrapMentionNames(sanitizeIssueHtml(rawBody), names);

  const { data, error } = await gate.admin
    .from("issues")
    .insert({
      kind,
      area,
      title,
      body: html,
      status: "접수",
      author_id: gate.user.id
    })
    .select("id, seq")
    .maybeSingle();

  if (error || !data) {
    console.error("[issues] insert", error);
    return NextResponse.json({ error: error?.message ?? "저장하지 못했습니다" }, { status: 500 });
  }

  const issueId = data.id as string;
  const issueSeq = Number(data.seq);
  await gate.admin.from("issue_watchers").insert({
    issue_id: issueId,
    user_id: gate.user.id
  });

  const { data: author } = await gate.admin
    .from("profiles")
    .select("name")
    .eq("id", gate.user.id)
    .maybeSingle();
  const authorName = (author?.name as string | undefined)?.trim() || "—";

  await notifyNewIssue(gate.admin, {
    seq: issueSeq,
    issueId,
    title,
    kind,
    area,
    authorId: gate.user.id,
    authorName
  });

  const mentioned = mentionedNames(html, names).filter((name) => name !== authorName);
  if (mentioned.length > 0) {
    await notifyMentioned(gate.admin, {
      seq: issueSeq,
      issueId,
      title,
      actorId: gate.user.id,
      actorName: authorName,
      names: mentioned,
      members
    });
  }

  return NextResponse.json({ id: issueId, seq: issueSeq });
}
