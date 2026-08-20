import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJsonObject } from "@/lib/luna/candidates";
import { lunaLlmComplete } from "@/lib/luna/llm/client";

export type AnswerSelfScore = {
  intent_score: number;
  confidence_score: number;
  self_note: string;
};

const SCORE_PROMPT = `질문과 답변을 보고 JSON만 반환하세요.

의도 이해 (intent_score, 1~10)
  9~10 분명하다
  6~8  대체로 알겠으나 한 가지 애매
  3~5  여러 뜻으로 읽힘, 짐작
  1~2  모르겠다, 되물어야 함

답변 자신감 (confidence_score, 1~10)
  9~10 근거가 있고 정확
  6~8  대체로 맞을 것, 일부 일반 지식
  3~5  방향만, 사실 확인 필요
  1~2  답하지 못함

self_note: 한 줄 (예: "무엇을 묻는지는 알겠는데 우리 자료에서 근거를 찾지 못했어요.")

{"intent_score":8,"confidence_score":7,"self_note":"..."}`;

function clipScore(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  if (v < 1 || v > 10) return null;
  return v;
}

export async function scoreAnswerSelf(
  admin: SupabaseClient,
  opts: {
    question: string;
    answer: string;
  }
): Promise<AnswerSelfScore | null> {
  const question = opts.question.trim();
  const answer = opts.answer.trim();
  if (!question || !answer) return null;

  try {
    const result = await lunaLlmComplete(admin, {
      tier: "B",
      feature: "chat_answer",
      system: SCORE_PROMPT,
      user: `질문:\n${question.slice(0, 1500)}\n\n답변:\n${answer.slice(0, 2500)}`,
      maxTokens: 256
    });
    const parsed = parseJsonObject(result.text);
    if (!parsed) return null;
    const intent = clipScore(parsed.intent_score);
    const confidence = clipScore(parsed.confidence_score);
    const selfNote =
      typeof parsed.self_note === "string" ? parsed.self_note.trim() : "";
    if (!intent || !confidence || !selfNote) return null;
    return {
      intent_score: intent,
      confidence_score: confidence,
      self_note: selfNote.slice(0, 200)
    };
  } catch (err) {
    console.error("[luna/answer-self-score]", err);
    return null;
  }
}
