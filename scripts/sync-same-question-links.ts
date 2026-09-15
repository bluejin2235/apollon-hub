/**
 * luna_questions.link_id 백필 + 이미 확정된 판정 질문 정리 + 중복 삭제
 * npx tsx scripts/sync-same-question-links.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { dedupeSameQuestions } from "@/lib/luna-admin/question-pairs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseCtx(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

async function main() {
  const admin = adminClient();
  const { data: questions, error: qErr } = await admin
    .from("luna_questions")
    .select("id, context, status, link_id, answer, answered_at");
  if (qErr) throw new Error(qErr.message);

  const { data: links, error: lErr } = await admin
    .from("luna_links")
    .select("id, from_type, from_id, to_type, to_id, status, source, kind")
    .eq("kind", "same");
  if (lErr) throw new Error(lErr.message);

  const linkById = new Map((links ?? []).map((l) => [String(l.id), l]));
  const linkByPair = new Map<string, (typeof links)[number]>();
  for (const l of links ?? []) {
    const key = `${l.from_type}\t${l.from_id}\t${l.to_type}\t${l.to_id}`;
    linkByPair.set(key, l);
    const rev = `${l.to_type}\t${l.to_id}\t${l.from_type}\t${l.from_id}`;
    if (!linkByPair.has(rev)) linkByPair.set(rev, l);
  }

  let linked = 0;
  let closedHuman = 0;
  const now = new Date().toISOString();

  for (const q of questions ?? []) {
    const ctx = parseCtx(q.context);
    let linkId =
      (typeof q.link_id === "string" && q.link_id) ||
      (typeof ctx.link_id === "string" ? ctx.link_id : "");

    if (!linkId || !linkById.has(linkId)) {
      const key = `${ctx.from_type ?? ""}\t${ctx.from_id ?? ""}\t${ctx.to_type ?? ""}\t${ctx.to_id ?? ""}`;
      const match = linkByPair.get(key);
      if (match) linkId = String(match.id);
    }

    if (!linkId || !linkById.has(linkId)) continue;

    const link = linkById.get(linkId)!;
    const patch: Record<string, unknown> = {};
    if (q.link_id !== linkId) {
      patch.link_id = linkId;
      linked += 1;
    }

    const decided =
      link.source === "human" ||
      link.status === "rejected" ||
      (link.status === "active" && link.source === "human");
    if (q.status === "pending" && decided) {
      patch.status = "answered";
      patch.answer =
        link.status === "rejected"
          ? "달라요"
          : q.answer && String(q.answer).trim()
            ? q.answer
            : "같아요";
      patch.answered_at = q.answered_at ?? now;
      closedHuman += 1;
    }

    if (Object.keys(patch).length === 0) continue;
    const { error } = await admin.from("luna_questions").update(patch).eq("id", q.id);
    if (error) throw new Error(error.message);
  }

  // context 에 link_id 만 있고 컬럼이 비어 있던 건 linked 카운트에 포함
  const { count: withLinkCol } = await admin
    .from("luna_questions")
    .select("id", { count: "exact", head: true })
    .not("link_id", "is", null);

  const dedupe = await dedupeSameQuestions(admin);

  const { count: pendingAll } = await admin
    .from("luna_questions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  console.log(
    JSON.stringify(
      {
        link_id_filled_this_run: linked,
        link_id_total: withLinkCol ?? 0,
        closed_already_decided: closedHuman,
        dedupe,
        pending_questions: pendingAll ?? 0
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
