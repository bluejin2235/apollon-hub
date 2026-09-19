/** 클라이언트·서버 공용 — 개인 memo 타입 */

export const ANSWER_LENGTH_IDS = ["short", "normal", "detailed"] as const;
export type AnswerLength = (typeof ANSWER_LENGTH_IDS)[number];

export const ANSWER_LENGTH_LABELS: Record<AnswerLength, string> = {
  short: "짧게",
  normal: "보통",
  detailed: "자세히"
};

export function isAnswerLength(value: unknown): value is AnswerLength {
  return (
    typeof value === "string" &&
    (ANSWER_LENGTH_IDS as readonly string[]).includes(value)
  );
}

export type LunaUserMemory = {
  user_id: string;
  memo: string;
  answer_length: AnswerLength;
  source_count: number;
  updated_at: string;
};

/** memo 글자 상한 — 넘으면 LLM 이 오래된 것을 버린다 */
export const USER_MEMO_MAX_CHARS = 2000;

/** 답변 길이 지시 — 시스템 프롬프트에 넣는다 */
export function answerLengthRule(length: AnswerLength): string {
  if (length === "short") {
    return "[답 길이]\r\n이 사람은 짧게를 고쳤다. 결론부터 2~4문장. 군더더기·서론 금지.";
  }
  if (length === "detailed") {
    return "[답 길이]\r\n이 사람은 자세히를 고쳤다. 근거·경로·맥락을 충분히 보여 준다.";
  }
  return "";
}
