/** 두뇌 > 프롬프트 단계. DB 컬럼이 없을 때만 시드로 채운다. */

export type PromptStageDef = {
  stage: number;
  title: string;
  subtitle: string;
  description: string;
  note?: string;
};

export type PromptStageFields = {
  stage?: number | null;
  stage_order?: number | null;
  parent_key?: string | null;
};

export type PromptNumberInput = PromptStageFields & {
  level?: string;
  kind?: string;
  sort_order?: number | null;
  prompt_key?: string | null;
};

export type PromptDisplayBadge = "core" | "always" | "manual";

export const PROMPT_STAGES: PromptStageDef[] = [
  {
    stage: 1,
    title: "나는 누구인가",
    subtitle: "언제나 먼저 읽는다",
    description: "아폴론이 어떤 회사이고 루나가 무엇을 하는 존재인지. 모든 답변의 바탕."
  },
  {
    stage: 2,
    title: "누가 묻고 있는가",
    subtitle: "묻는 사람의 부서로 자동 선택",
    description: "같은 질문도 직능에 따라 필요한 답이 다르다. 부서는 각 관점 안에 적혀 있다."
  },
  {
    stage: 3,
    title: "이 질문이 무엇을 원하는가",
    subtitle: "모든 갈림길이 여기서 정해진다",
    description: "가장 중요한 단계. 여기서 유형이 정해지면 그 뒤 경로가 전부 달라진다."
  },
  {
    stage: 4,
    title: "유형에 맞게 답한다",
    subtitle: "판정된 것만 읽는다",
    description: "네 갈래. 각자 보는 곳과 답하는 형태가 다르다.",
    note: "인사·잡담으로 판정되면 아무 프롬프트도 읽지 않고 짧게 답한다."
  },
  {
    stage: 5,
    title: "답할 때 지키는 것",
    subtitle: "유형과 무관하게 항상",
    description: "어떤 유형이든 답을 쓸 때 공통으로 지킨다."
  },
  {
    stage: 6,
    title: "답한 뒤에 배운다",
    subtitle: "대화가 끝나고",
    description: "대화에서 배울 것을 골라 후보로 올린다. 확정은 사람이 한다."
  },
  {
    stage: 7,
    title: "스스로 자란다",
    subtitle: "밤과 주말에",
    description: "사람이 없을 때 혼자 공부하고 스스로를 고친다."
  }
];

export const PROMPT_STAGE_SEED: Record<
  string,
  { stage: number; stage_order: number; parent_key: string | null }
> = {
  "identity.apollon": { stage: 1, stage_order: 1, parent_key: null },

  "lens.space-planning": { stage: 2, stage_order: 1, parent_key: null },
  "lens.space-design": { stage: 2, stage_order: 2, parent_key: null },
  "lens.content-planning": { stage: 2, stage_order: 3, parent_key: null },
  "lens.content-design": { stage: 2, stage_order: 4, parent_key: null },
  "lens.hardware-design": { stage: 2, stage_order: 5, parent_key: null },
  "lens.role": { stage: 2, stage_order: 6, parent_key: null },

  "type.classify": { stage: 3, stage_order: 1, parent_key: null },

  "type.know": { stage: 4, stage_order: 1, parent_key: null },
  "type.find": { stage: 4, stage_order: 2, parent_key: null },
  "search.keyword_extract": { stage: 4, stage_order: 1, parent_key: "type.find" },
  "source.workserver_structure": {
    stage: 4,
    stage_order: 2,
    parent_key: "type.find"
  },
  "eval.self": { stage: 4, stage_order: 3, parent_key: "type.find" },
  "search.requery": { stage: 4, stage_order: 4, parent_key: "type.find" },
  "answer.synthesis": { stage: 4, stage_order: 5, parent_key: "type.find" },
  "type.make": { stage: 4, stage_order: 3, parent_key: null },
  "type.learn": { stage: 4, stage_order: 4, parent_key: null },

  "talk.understand": { stage: 5, stage_order: 1, parent_key: null },
  "talk.clarify_guard": { stage: 5, stage_order: 1, parent_key: "talk.understand" },
  "talk.assume": { stage: 5, stage_order: 2, parent_key: null },
  "talk.answer": { stage: 5, stage_order: 3, parent_key: null },

  "learn.capture": { stage: 6, stage_order: 1, parent_key: null },
  "learn.dialogue": { stage: 6, stage_order: 2, parent_key: null },

  "learn.selfstudy": { stage: 7, stage_order: 1, parent_key: null },
  "self.upgrade": { stage: 7, stage_order: 2, parent_key: null },
  "self.report": { stage: 7, stage_order: 3, parent_key: null }
};

export const PROMPT_DISPLAY_BADGE: Record<string, PromptDisplayBadge> = {
  "type.classify": "core",
  "identity.apollon": "always",
  "talk.understand": "always",
  "talk.assume": "always",
  "talk.answer": "always",
  "lens.role": "manual"
};

const CHILD_LETTERS = "abcdefghijklmnopqrstuvwxyz";

export function applyPromptStageFields<T extends PromptNumberInput>(
  p: T
): T & {
  stage: number | null;
  stage_order: number | null;
  parent_key: string | null;
} {
  const seed = p.prompt_key ? PROMPT_STAGE_SEED[p.prompt_key] : undefined;
  return {
    ...p,
    stage: p.stage ?? seed?.stage ?? null,
    stage_order: p.stage_order ?? seed?.stage_order ?? null,
    parent_key: p.parent_key ?? seed?.parent_key ?? null
  };
}

export function promptDisplayBadge(promptKey: string | null | undefined): PromptDisplayBadge | null {
  if (!promptKey) return null;
  return PROMPT_DISPLAY_BADGE[promptKey] ?? null;
}

export function formatStageNumber(p: PromptNumberInput): string {
  const row = applyPromptStageFields(p);
  if (row.parent_key) {
    const parentSeed = PROMPT_STAGE_SEED[row.parent_key];
    const parentNum = formatStageNumber({
      prompt_key: row.parent_key,
      stage: parentSeed?.stage ?? row.stage,
      stage_order: parentSeed?.stage_order ?? null,
      parent_key: parentSeed?.parent_key ?? null,
      level: p.level,
      sort_order: p.sort_order
    });
    const idx = (row.stage_order ?? 1) - 1;
    const letter = CHILD_LETTERS[idx] ?? String(row.stage_order ?? 0);
    return `${parentNum}-${letter}`;
  }
  if (row.stage != null && row.stage_order != null) {
    return `${row.stage}-${row.stage_order}`;
  }
  const n = String(p.sort_order ?? 0).padStart(2, "0");
  return `${p.level ?? "L"}-${n}`;
}
