/**
 * AI ② 「AI 답변에 우리가 나오나」 — 사람이 AI 에 직접 물어본 기록(홈페이지 stats/ai-answers)을 표로 만든다.
 * 최신 회차 기준, 앞 회차와 견준다. 기록이 없으면 null.
 *
 * 칸은 셋 중 하나 — 나옴 · 안 나옴 · 확인 안 함. 확인하지 않은 칸을 「안 나옴」으로 보이면 안 된다.
 * 칸을 누르면 그 답에서 우리가 어떻게 쓰였는지(답변 내용 · 인용 주소 · 틀린 사실)를 보인다.
 * 답변 내용과 인용 주소는 홈페이지가 칸마다 넘겨줄 때만 있다(지금은 없음 → 화면이 그렇다고 쓴다).
 */

import { answerColumns, answerLabel } from "@/components/website/stats-v3/v3-ai-data";
import type { AiAnswerSummary } from "@/lib/website/stats";

export type AnswerCell = {
  /** null = 이 질문은 이 AI 에 물어보지 않음 */
  mentioned: boolean | null;
  excerpt: string | null;
  cited: string[];
  rank: number | null;
  /** 틀린 사실 메모 — 칸에 없으면 요약의 wrong_facts 에서 찾는다 */
  wrongNote: string | null;
  wrong: boolean;
  /** 홈페이지가 칸마다 답변 내용 · 인용 주소를 넘겨주었나 */
  detailSent: boolean;
};

export type AnswerRow = {
  id: number;
  question: string;
  cells: AnswerCell[];
  /** 언급한 AI 수 차이(앞 회차 대비). 앞 회차가 없으면 null */
  diff: number | null;
};

export type AnswerColumn = {
  label: string;
  /** 이번 회차에 이 AI 로 확인한 질문 수 */
  checked: number;
  mentioned: number;
};

export type AnswerView = {
  latest: string;
  previous: string | null;
  /** 확인한 회차 수(기간 안) */
  rounds: number;
  /** 한 AI 라도 우리 이름을 말한 질문 수 / 물어본 질문 수 */
  questionsMentioned: number;
  questionsChecked: number;
  questionsMentionedBefore: number | null;
  questionsCheckedBefore: number | null;
  questionsMentionedComparable: number | null;
  mentioned: number;
  checked: number;
  diffCount: number | null;
  diffPp: number | null;
  columns: AnswerColumn[];
  rows: AnswerRow[];
  citedTop: { url: string; count: number }[];
  wrongFacts: number;
};

/** 화면 열 이름 → 홈페이지 서비스 열쇠. 요약의 services 에 없는 서비스(그 회차에 확인 안 함)도 칸을 찾게 */
const SERVICE_KEYS: Record<string, string> = {
  ChatGPT: "chatgpt",
  "구글 검색 AI 요약": "google_ai_overview",
  Perplexity: "perplexity",
  Claude: "claude",
  네이버: "naver",
  Gemini: "gemini",
  Copilot: "copilot"
};

/** 바뀐 질문 먼저, 그다음 언급이 많은 질문 */
export function answerView(summary: AiAnswerSummary | null): AnswerView | null {
  if (!summary || !summary.latest || summary.total.checked === 0) return null;
  const keyOf = new Map<string, string>([
    ...Object.entries(SERVICE_KEYS),
    ...summary.services.map((s): [string, string] => [answerLabel(s.label), s.ai_service])
  ]);
  const recorded = summary.services.filter((s) => s.checked > 0).map((s) => s.label);
  const labels = answerColumns(recorded);
  const columns: AnswerColumn[] = labels.map((label) => {
    const service = summary.services.find((s) => answerLabel(s.label) === label);
    return { label, checked: service?.checked ?? 0, mentioned: service?.mentioned ?? 0 };
  });
  const wrongOf = new Map(summary.wrong_facts.map((w) => [`${w.question_id}|${w.ai_service}`, w.note]));

  const rows = summary.grid.map((row): AnswerRow & { score: number; changed: boolean } => {
    const cells = labels.map((label): AnswerCell => {
      const key = keyOf.get(label);
      const cell = key ? row.cells[key] : undefined;
      const wrongKey = key ? `${row.question_id}|${key}` : "";
      const detailSent = Boolean(cell && ("answer_excerpt" in cell || "cited_urls" in cell));
      return {
        mentioned: cell ? cell.mentioned : null,
        excerpt: cell?.answer_excerpt ?? null,
        cited: cell?.cited_urls ?? [],
        rank: cell?.rank_in_answer ?? null,
        wrongNote: cell?.wrong_fact_note ?? wrongOf.get(wrongKey) ?? null,
        wrong: wrongOf.has(wrongKey) || Boolean(cell?.wrong_fact_note),
        detailSent
      };
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
    rounds: summary.rounds.length,
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
    rows: rows
      .filter((row) => row.cells.some((cell) => cell.mentioned != null))
      .map(({ id, question, cells, diff }) => ({ id, question, cells, diff })),
    citedTop: summary.cited_top.slice(0, 5),
    wrongFacts: summary.wrong_facts.length
  };
}
