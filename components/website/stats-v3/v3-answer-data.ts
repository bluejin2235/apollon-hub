/**
 * AI ② 「답에 씀」 — 운영이 주 1회 AI 에 직접 물어본 기록(홈페이지 stats/ai-answers)을 목업 칸에 맞춘다.
 * 최신 회차 기준, 앞 회차와 견준다. 기록이 없으면 null 이고 화면은 「준비 중」을 그대로 둔다.
 */

import { answerColumns } from "@/components/website/stats-v3/v3-ai-data";
import type { AiAnswerSummary } from "@/lib/website/stats";

export type AnswerRow = {
  id: number;
  question: string;
  /** 열 이름 순서대로 ○ · × · 기록 없음(null) */
  cells: (boolean | null)[];
  /** 언급한 AI 수 차이(앞 회차 대비). 앞 회차가 없으면 null */
  diff: number | null;
};

export type AnswerView = {
  latest: string;
  previous: string | null;
  /** 목업 큰 숫자 — 한 AI 라도 우리 이름을 말한 질문 수 / 물어본 질문 수 */
  questionsMentioned: number;
  questionsChecked: number;
  /** 앞 회차의 같은 값. 앞 회차가 없으면 null */
  questionsMentionedBefore: number | null;
  /** 두 회차 모두 확인한 질문 수 (비교 분모) */
  questionsCheckedBefore: number | null;
  /** 그 질문들 가운데 이번 회차에 언급된 수 (비교 분자) */
  questionsMentionedComparable: number | null;
  mentioned: number;
  checked: number;
  diffCount: number | null;
  diffPp: number | null;
  columns: string[];
  rows: AnswerRow[];
  citedTop: { url: string; count: number }[];
  wrongFacts: number;
};

/** 바뀐 질문 먼저, 그다음 언급이 많은 질문. 목업처럼 몇 줄만 보인다 */
export function answerView(summary: AiAnswerSummary | null, limit = 8): AnswerView | null {
  if (!summary || !summary.latest || summary.total.checked === 0) return null;
  const labelOf = new Map(summary.services.map((s) => [s.label, s.ai_service]));
  const columns = answerColumns(summary.services.filter((s) => s.checked > 0).map((s) => s.label));

  const rows = summary.grid.map((row): AnswerRow & { score: number; changed: boolean } => {
    const cells = columns.map((label) => {
      const key = labelOf.get(label);
      const cell = key ? row.cells[key] : undefined;
      return cell ? cell.mentioned : null;
    });
    // 증감은 두 회차 모두 확인한 AI 끼리만 센다(이번에 처음 확인한 AI 는 섞지 않는다)
    let score = 0;
    let nowBoth = 0;
    let beforeBoth = 0;
    let comparable = false;
    for (const cell of Object.values(row.cells)) {
      if (!cell) continue;
      if (cell.mentioned) score += 1;
      if (cell.previous != null) {
        comparable = true;
        if (cell.mentioned) nowBoth += 1;
        if (cell.previous) beforeBoth += 1;
      }
    }
    return {
      id: row.question_id,
      question: row.question,
      cells,
      diff: comparable ? nowBoth - beforeBoth : null,
      score,
      changed: row.changed
    };
  });

  rows.sort((a, b) => Number(b.changed) - Number(a.changed) || b.score - a.score || a.id - b.id);

  // 큰 숫자: 이번 회차 전체. 비교: 두 회차 모두 확인한 질문·AI 끼리 같은 단위로
  let qNow = 0;
  let qChecked = 0;
  let qNowBoth = 0;
  let qBefore = 0;
  let qBoth = 0;
  for (const row of summary.grid) {
    const cells = Object.values(row.cells).filter((cell): cell is NonNullable<typeof cell> => Boolean(cell));
    if (cells.length > 0) {
      qChecked += 1;
      if (cells.some((cell) => cell.mentioned)) qNow += 1;
    }
    const both = cells.filter((cell) => cell.previous != null);
    if (both.length > 0) {
      qBoth += 1;
      if (both.some((cell) => cell.mentioned)) qNowBoth += 1;
      if (both.some((cell) => cell.previous)) qBefore += 1;
    }
  }
  const hasBefore = summary.previous != null && qBoth > 0;

  return {
    latest: summary.latest,
    previous: summary.previous,
    questionsMentioned: qNow,
    questionsChecked: qChecked,
    questionsMentionedBefore: hasBefore ? qBefore : null,
    questionsCheckedBefore: hasBefore ? qBoth : null,
    questionsMentionedComparable: hasBefore ? qNowBoth : null,
    mentioned: summary.total.mentioned,
    checked: summary.total.checked,
    diffCount: summary.total.diff_count,
    diffPp: summary.total.diff_pp,
    columns,
    rows: rows.slice(0, limit).map(({ id, question, cells, diff }) => ({ id, question, cells, diff })),
    citedTop: summary.cited_top.slice(0, 5),
    wrongFacts: summary.wrong_facts.length
  };
}
