import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyFailureCause,
  failureCauseMeta,
  isInspectFailure,
  listLunaFailures,
  type FailureCauseType,
  type FailureRow
} from "@/lib/luna/failures";
import { isMissingTableError } from "@/lib/luna-admin/db";
import type {
  AnalysisAction,
  AnalysisGroup,
  AnalysisPayload
} from "@/lib/luna-admin/types";

export type { AnalysisAction, AnalysisGroup, AnalysisPayload };

const COMMON_CAUSE: Record<FailureCauseType, string> = {
  search_miss: "문서 안의 고유명사가 색인에 안 잡힙니다. 본문에만 있는 이름은 용어사전·제목에 없어 검색에 걸리지 않습니다.",
  wiki_gap: "물어본 규정·절차가 위키에 없습니다. 찾아갈 문서가 없어 추측으로 답합니다.",
  clarify_mishandle:
    "선택지를 냈는데 「1번」이라고만 답하면 원래 질문과 이어붙이지 못합니다.",
  shallow_answer: "자료는 찾았는데 핵심을 답에 못 담았습니다.",
  slow_response: "응답이 너무 오래 걸립니다.",
  human_correction: "사람이 틀린 내용이라고 고쳤습니다. 지식이 비었거나 엇나갑니다.",
  low_understanding: "대상이 없는 요청에서 무엇을 할지 되묻지 않고 그냥 답했습니다.",
  unclassified: "규칙으로 원인을 묶지 못했습니다."
};

function actionsFor(cause: FailureCauseType): AnalysisAction[] {
  if (cause === "search_miss") {
    return [
      { id: "named-entity-index", title: "고유명사 색인", when: "tonight" },
      { id: "work-link", title: "Work 연결 만들기", when: "tomorrow" }
    ];
  }
  if (cause === "wiki_gap") {
    return [{ id: "wiki-draft", title: "위키 초안 쓰기", when: "tonight" }];
  }
  if (cause === "clarify_mishandle" || cause === "low_understanding") {
    return [{ id: "prompt-fix", title: "프롬프트 수정 제안", when: "brain" }];
  }
  if (cause === "shallow_answer") {
    return [{ id: "answer-depth", title: "답변 깊이 점검", when: "tonight" }];
  }
  if (cause === "human_correction") {
    return [{ id: "knowledge-fix", title: "지식 고치기", when: "tonight" }];
  }
  return [];
}

function sampleLabel(row: FailureRow): string {
  const q = (row.question ?? "").replace(/\s+/g, " ").trim();
  if (q.length > 48) return `${q.slice(0, 48)}…`;
  return q || "(질문 없음)";
}

export async function buildFailureAnalysis(
  admin: SupabaseClient
): Promise<AnalysisPayload> {
  let rows: FailureRow[] = [];
  try {
    rows = await listLunaFailures(admin, { verdict: "open" });
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.error("[luna-admin/analysis]", err);
    }
  }

  const inspect = rows.filter((r) => isInspectFailure(r));
  const humanish = rows.filter((r) => !isInspectFailure(r));

  const buckets = new Map<FailureCauseType, FailureRow[]>();
  for (const row of humanish) {
    const cause =
      row.cause_type ??
      classifyFailureCause({
        question: row.question,
        answer_excerpt: row.answer_excerpt,
        signal: row.signal,
        signals: row.signals,
        intent_score: row.intent_score,
        confidence_score: row.confidence_score,
        sources_used: row.sources_used,
        duration_ms: row.duration_ms,
        types: row.types,
        source_ref: row.source_ref
      });
    const list = buckets.get(cause) ?? [];
    list.push(row);
    buckets.set(cause, list);
  }

  const groups: AnalysisGroup[] = [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cause, list]) => {
      const meta = failureCauseMeta(cause);
      return {
        cause,
        title: meta.title,
        emoji: meta.emoji,
        count: list.length,
        common_cause: COMMON_CAUSE[cause],
        samples: list.slice(0, 5).map(sampleLabel).filter(Boolean),
        actions: actionsFor(cause),
        failure_ids: list.map((r) => r.id)
      };
    });

  return {
    total: rows.length,
    inspect_count: inspect.length,
    groups
  };
}
