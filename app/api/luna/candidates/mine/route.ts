import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  dialogueTurnLabel,
  questionDeadlineLabel
} from "@/lib/luna/candidate-format";
import {
  normalizeThread,
  resolveCandidateSource
} from "@/lib/luna/candidates";
import { clipText } from "@/lib/luna/knowledge-format";

export const runtime = "nodejs";

type Row = {
  id: string;
  content: string;
  source: string | null;
  origin: string;
  evidence: string | null;
  thread: unknown;
  author_id: string | null;
  assigned_to: string | null;
  created_at: string | null;
  snoozed_until: string | null;
  meta: Record<string, unknown> | null;
};

function isSnoozed(row: Row): boolean {
  if (!row.snoozed_until) return false;
  const until = new Date(String(row.snoozed_until)).getTime();
  return Number.isFinite(until) && until > Date.now();
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: myProfile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  const myName =
    (typeof myProfile?.name === "string" && myProfile.name.trim()) || "님";

  const { data, error } = await admin
    .from("luna_learnings")
    .select(
      "id, content, source, origin, evidence, thread, author_id, assigned_to, created_at, snoozed_until, meta"
    )
    .eq("status", "candidate")
    .neq("category", "identity")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[luna/candidates/mine] list", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];

  const assignedCandidates = rows.filter(
    (r) =>
      resolveCandidateSource(r.source, r.origin) === "question" &&
      r.assigned_to === user.id &&
      !isSnoozed(r)
  );

  const assignedQuestion = assignedCandidates[0]
    ? (() => {
        const r = assignedCandidates[0];
        const thread = normalizeThread(r.thread);
        const firstLuna = thread.find((t) => t.role === "luna")?.text;
        const ask =
          firstLuna ||
          (typeof r.meta?.ask === "string" ? r.meta.ask : null) ||
          r.content;
        const subtitle =
          typeof r.evidence === "string" && r.evidence.trim()
            ? clipText(r.evidence, 60)
            : "어제 대화에서";
        return {
          id: r.id,
          greeting: `${myName.endsWith("님") ? myName : `${myName}님`}, 하나만 여쭤봐도 돼요?`,
          question: ask,
          subtitle,
          hint: clipText(r.content, 120),
          deadline_label: questionDeadlineLabel(r.created_at),
          thread_count: thread.length,
          turn_label: thread.length > 0 ? dialogueTurnLabel(thread.length) : null
        };
      })()
    : null;

  const myDialogues = rows
    .filter((r) => {
      const src = resolveCandidateSource(r.source, r.origin);
      const thread = normalizeThread(r.thread);
      if (thread.length === 0) return false;
      if (r.assigned_to !== user.id && r.author_id !== user.id) return false;
      if (src === "question" && r.id === assignedQuestion?.id) return false;
      return src === "chat" || src === "direct" || src === "question";
    })
    .map((r) => {
      const thread = normalizeThread(r.thread);
      const src = resolveCandidateSource(r.source, r.origin);
      const title =
        (typeof r.meta?.title === "string" && r.meta.title.trim()) ||
        clipText(r.content, 48);
      return {
        id: r.id,
        source: src,
        title,
        turn_label: dialogueTurnLabel(thread.length)
      };
    })
    .slice(0, 20);

  const questionRows = rows.filter(
    (r) => resolveCandidateSource(r.source, r.origin) === "question"
  );
  const assigneeIds = Array.from(
    new Set(
      questionRows
        .map((r) => r.assigned_to)
        .filter((id): id is string => Boolean(id))
    )
  );
  const unassignedCount = questionRows.filter((r) => !r.assigned_to).length;

  const nameMap = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", assigneeIds);
    for (const p of profiles ?? []) {
      nameMap.set(
        p.id as string,
        ((p.name as string) || "").trim() || "이름 없음"
      );
    }
  }

  const teamCounts = new Map<string, number>();
  for (const r of questionRows) {
    const key = r.assigned_to ?? "__unassigned__";
    teamCounts.set(key, (teamCounts.get(key) ?? 0) + 1);
  }

  const team_overview = [
    ...assigneeIds.map((id) => ({
      user_id: id,
      name: nameMap.get(id) ?? "—",
      count: teamCounts.get(id) ?? 0
    })),
    ...(unassignedCount > 0
      ? [{ user_id: null as string | null, name: "미배정", count: unassignedCount }]
      : [])
  ].sort((a, b) => b.count - a.count);

  return NextResponse.json({
    assigned_question: assignedQuestion,
    my_dialogues: myDialogues,
    team_overview,
    my_turn_count: assignedCandidates.length
  });
}
