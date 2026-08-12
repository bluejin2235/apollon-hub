import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { normalizeThread } from "@/lib/luna/candidates";

export const runtime = "nodejs";

/**
 * GET /api/luna/popup/pending
 * 내게 배정된 질문 1건 + 후보함 대기 수.
 * snoozed_until 이 미래면 제외.
 */
export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const now = Date.now();

  const { data: rows, error } = await admin
    .from("luna_learnings")
    .select(
      "id, content, evidence, thread, source_conversation_id, created_at, snoozed_until, assigned_to, meta"
    )
    .eq("source", "question")
    .eq("status", "candidate")
    .eq("assigned_to", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("[luna/popup/pending]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row =
    (rows ?? []).find((r) => {
      if (!r.snoozed_until) return true;
      const until = new Date(String(r.snoozed_until)).getTime();
      return Number.isFinite(until) && until <= now;
    }) ?? null;

  const { count: candidateCount } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "candidate")
    .neq("category", "identity");

  let profileName = "님";
  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  if (typeof profile?.name === "string" && profile.name.trim()) {
    profileName = profile.name.trim();
  }

  if (!row) {
    return NextResponse.json({
      question: null,
      candidate_count: candidateCount ?? 0,
      user_name: profileName
    });
  }

  const thread = normalizeThread(row.thread);
  const lunaAsk =
    [...thread].reverse().find((t) => t.role === "luna")?.text ||
    (typeof row.content === "string" ? row.content : "");

  return NextResponse.json({
    question: {
      id: row.id as string,
      content: lunaAsk,
      knowledge: typeof row.content === "string" ? row.content : "",
      evidence: typeof row.evidence === "string" ? row.evidence : null,
      source_conversation_id:
        typeof row.source_conversation_id === "string"
          ? row.source_conversation_id
          : null,
      created_at: row.created_at as string | null,
      thread
    },
    candidate_count: candidateCount ?? 0,
    user_name: profileName
  });
}
