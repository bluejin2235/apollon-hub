/** 클라이언트·서버 공용 — 열린 질문 */

export type OpenQuestionRow = {
  id: string;
  title: string;
  why: string;
  preview: string;
  related_count: number;
  status: string;
  created_at: string;
  updated_at: string;
};
