/**
 * 「같은 것」↔「지식후보」동기화 검증 (확인 후 원복)
 * reviewSameLinks / questions POST 와 동일한 DB 갱신 경로를 직접 실행한다.
 * npx tsx scripts/verify-same-judgment-sync.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";

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

async function main() {
  const admin = adminClient();
  const { data: link, error: lErr } = await admin
    .from("luna_links")
    .select("id, status, source")
    .eq("kind", "same")
    .neq("source", "human")
    .neq("status", "rejected")
    .limit(1)
    .maybeSingle();
  if (lErr) throw new Error(lErr.message);
  if (!link) throw new Error("확인할 same need 링크가 없습니다");

  const { data: profile } = await admin.from("profiles").select("id").limit(1).maybeSingle();
  const userId = String(profile?.id);
  if (!userId) throw new Error("profiles 없음");

  const snap = {
    id: String(link.id),
    status: String(link.status),
    source: String(link.source)
  };
  const now = new Date().toISOString();

  const { data: inserted, error: iErr } = await admin
    .from("luna_questions")
    .insert({
      question: "[verify] same sync",
      context: JSON.stringify({ kind: "same", link_id: snap.id }),
      link_id: snap.id,
      status: "pending",
      source: "conflict",
      category: "판단기준"
    })
    .select("id")
    .single();
  if (iErr) throw new Error(iErr.message);
  const questionId = inserted.id as string;

  // reviewSameLinks(confirm) + syncQuestionsForSameLinks
  {
    const { error } = await admin
      .from("luna_links")
      .update({
        source: "human",
        status: "active",
        confirmed_by: userId,
        confirmed_at: now
      })
      .eq("kind", "same")
      .eq("id", snap.id);
    if (error) throw new Error(error.message);
    const { error: qErr } = await admin
      .from("luna_questions")
      .update({
        status: "answered",
        answer: "같아요",
        answered_by: userId,
        answered_at: now
      })
      .in("link_id", [snap.id])
      .eq("status", "pending");
    if (qErr) throw new Error(qErr.message);
  }

  const { data: q1 } = await admin
    .from("luna_questions")
    .select("status, answer")
    .eq("id", questionId)
    .single();
  const { data: l1 } = await admin
    .from("luna_links")
    .select("status, source")
    .eq("id", snap.id)
    .single();
  const linkClosesQuestion =
    q1?.status === "answered" &&
    q1?.answer === "같아요" &&
    l1?.source === "human" &&
    l1?.status === "active";

  // undo
  await admin
    .from("luna_links")
    .update({ status: snap.status, source: snap.source })
    .eq("id", snap.id);
  await admin
    .from("luna_questions")
    .update({
      status: "pending",
      answer: null,
      answered_by: null,
      answered_at: null
    })
    .eq("id", questionId);

  // answerQuestion + reviewSameLinks(reject)
  {
    const { error } = await admin
      .from("luna_questions")
      .update({
        answer: "달라요",
        status: "answered",
        answered_by: userId,
        answered_at: now
      })
      .eq("id", questionId);
    if (error) throw new Error(error.message);
    const { error: lErr2 } = await admin
      .from("luna_links")
      .update({ status: "rejected" })
      .eq("kind", "same")
      .eq("id", snap.id);
    if (lErr2) throw new Error(lErr2.message);
  }

  const { data: q2 } = await admin
    .from("luna_questions")
    .select("status, answer")
    .eq("id", questionId)
    .single();
  const { data: l2 } = await admin
    .from("luna_links")
    .select("status")
    .eq("id", snap.id)
    .single();
  const questionClosesLink =
    q2?.status === "answered" &&
    q2?.answer === "달라요" &&
    l2?.status === "rejected";

  await admin
    .from("luna_links")
    .update({ status: snap.status, source: snap.source })
    .eq("id", snap.id);
  await admin.from("luna_questions").delete().eq("id", questionId);

  console.log(
    JSON.stringify(
      {
        link_id: snap.id,
        link_closes_question: linkClosesQuestion,
        question_closes_link: questionClosesLink,
        ok: linkClosesQuestion && questionClosesLink
      },
      null,
      2
    )
  );
  if (!(linkClosesQuestion && questionClosesLink)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
