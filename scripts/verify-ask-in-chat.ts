/**
 * 대화 중·말풍선 질문: 관련 매칭 · 답변 시 질문/링크 동기화 (확인 후 원복)
 * npx tsx scripts/verify-ask-in-chat.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import {
  classifyQuestionTarget,
  isRelatedToTopic,
  questionTopicTokens
} from "@/lib/luna/question-target";
import { resolveLunaQuestionAnswer } from "@/lib/luna/question-ask";

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

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function testRelated() {
  const q = {
    question: "「착수보고」와 「수행계획서」가 같은 뜻인가요?",
    context: { kind: "same", from_title: "착수보고", to_title: "수행계획서" }
  };
  const tokens = questionTopicTokens(q);
  assert(
    isRelatedToTopic(
      tokens,
      "인스파이어 시즌4 착수보고 자료 어디 있어?"
    ),
    "착수보고 대화와 관련되어야 함"
  );
  assert(
    !isRelatedToTopic(tokens, "오늘 점심 뭐 먹지"),
    "무관한 대화에는 뜨면 안 됨"
  );
  assert(classifyQuestionTarget(q) === "project", "같은 것 질문은 프로젝트");
  const term = {
    question: "「킥오프」가 무슨 뜻인가요?",
    context: { kind: "term", from_title: "킥오프" },
    category: "term"
  };
  assert(classifyQuestionTarget(term) === "term", "용어 질문");
  console.log("related/classify ok", tokens);
}

async function testAnswerSync() {
  const admin = adminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .limit(1)
    .maybeSingle();
  const userId = String(profile?.id ?? "");
  if (!userId) throw new Error("profiles 없음");

  const { data: inserted, error: iErr } = await admin
    .from("luna_questions")
    .insert({
      question: "[verify] 대화 중 질문 동기화",
      context: {
        kind: "same",
        from_title: "해운대스퀘어 공공부지사업",
        to_title: "해운대구남로 미디어쇼"
      },
      status: "pending",
      source: "conflict",
      category: "판단기준",
      target_user_id: userId
    })
    .select("id")
    .single();
  if (iErr) throw new Error(iErr.message);
  const questionId = inserted.id as string;

  try {
    const resolved = await resolveLunaQuestionAnswer({
      admin,
      questionId,
      userId,
      answer: "같아요"
    });
    assert(resolved.ok, resolved.error ?? "resolve 실패");

    const { data: q } = await admin
      .from("luna_questions")
      .select("status, answer")
      .eq("id", questionId)
      .maybeSingle();
    assert(q?.status === "answered", "질문 status 가 answered 여야 함");
    assert(q?.answer === "같아요", "질문 answer 가 같아요여야 함");
    console.log("answer-sync ok", questionId);
  } finally {
    await admin.from("luna_questions").delete().eq("id", questionId);
  }
}

async function main() {
  testRelated();
  await testAnswerSync();
  console.log("verify-ask-in-chat ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
