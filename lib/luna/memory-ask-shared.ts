/** 대화 중 한 줄 묻기 — 공유 타입 */

export type MemoryAskPayload = {
  question: string;
  options: [string, string];
  /** 수락 시 memo 에 반영할 한 줄 */
  accept_line: string;
  /** 거절 시 개인에만 남길지 / 팀 질문으로 올릴지 */
  reject_as: "case_by_case" | "open_question";
  topic: string;
};

export type MemoryAskAnswer = "accept" | "reject";
