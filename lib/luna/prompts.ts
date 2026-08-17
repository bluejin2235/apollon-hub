import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyPromptStageFields,
  formatStageNumber,
  type PromptNumberInput
} from "@/lib/luna/prompt-stages";

export type LunaPromptLevel = "L1" | "L2" | "L3" | "L4" | "L5";
export type LunaPromptKind =
  | "identity"
  | "perspective"
  | "role"
  | "task"
  | "system";

/** 체계 v2 로더 등록 키 (상시·대화·배움·자기개선). */
export const LUNA_PROMPT_KEYS = {
  identity: "identity.apollon",
  understand: "talk.understand",
  assume: "talk.assume",
  search: "talk.search",
  find: "type.find",
  classify: "type.classify",
  know: "type.know",
  make: "type.make",
  learn: "type.learn",
  answer: "talk.answer",
  keywordExtract: "search.keyword_extract",
  requery: "search.requery",
  selfEval: "eval.self",
  synthesis: "answer.synthesis",
  clarifyGuard: "talk.clarify_guard",
  workserverStructure: "source.workserver_structure",
  capture: "learn.capture",
  dialogue: "learn.dialogue",
  selfstudy: "learn.selfstudy",
  upgrade: "self.upgrade",
  report: "self.report"
} as const;

export type LunaPromptKey =
  (typeof LUNA_PROMPT_KEYS)[keyof typeof LUNA_PROMPT_KEYS];

/** 채팅/런타임에서 getPrompts 로 한 번에 불러올 키 목록. */
export const LUNA_RUNTIME_PROMPT_KEYS: LunaPromptKey[] = [
  LUNA_PROMPT_KEYS.identity,
  LUNA_PROMPT_KEYS.understand,
  LUNA_PROMPT_KEYS.assume,
  LUNA_PROMPT_KEYS.find,
  LUNA_PROMPT_KEYS.classify,
  LUNA_PROMPT_KEYS.know,
  LUNA_PROMPT_KEYS.make,
  LUNA_PROMPT_KEYS.learn,
  LUNA_PROMPT_KEYS.answer,
  LUNA_PROMPT_KEYS.keywordExtract,
  LUNA_PROMPT_KEYS.requery,
  LUNA_PROMPT_KEYS.selfEval,
  LUNA_PROMPT_KEYS.synthesis,
  LUNA_PROMPT_KEYS.clarifyGuard,
  LUNA_PROMPT_KEYS.workserverStructure,
  LUNA_PROMPT_KEYS.capture,
  LUNA_PROMPT_KEYS.dialogue,
  LUNA_PROMPT_KEYS.selfstudy,
  LUNA_PROMPT_KEYS.upgrade,
  LUNA_PROMPT_KEYS.report
];

export type LunaLoadedPrompt = {
  prompt_key: string;
  content: string;
  title: string;
  level: LunaPromptLevel;
  kind: LunaPromptKind;
  sort_order: number;
  stage?: number | null;
  stage_order?: number | null;
  parent_key?: string | null;
};

export function withFallback(db: string | undefined, fallback: string): string {
  const text = db?.trim() ?? "";
  return text || fallback;
}

/** L1·L5 는 사람만 수정. 루나 자동 수정 API 에서 거부. */
export function isHumanOnlyPromptLevel(level: string): boolean {
  return level === "L1" || level === "L5";
}

export type LunaPromptVersionContent = {
  title: string;
  description: string;
  purpose: string;
  content: string;
  owner_id: string | null;
  sort_order: number;
};

export type LunaPromptVerifyResult =
  | "confirmed"
  | "refuted"
  | "inconclusive";

export type LunaPromptVersionRow = {
  id: string;
  target_type: string;
  target_id: string;
  version: number;
  content: LunaPromptVersionContent | Record<string, unknown>;
  change_summary: string | null;
  changed_by: string | null;
  changed_by_luna: boolean;
  created_at: string;
  editor_name?: string | null;
  prediction?: string | null;
  verify_run_id?: string | null;
  verify_result?: LunaPromptVerifyResult | null;
  verify_note?: string | null;
  verified_at?: string | null;
  prompt_title?: string | null;
};

export type LunaPromptGroupRow = {
  group_key: string;
  label: string;
  tagline: string | null;
  description: string | null;
  when_runs: string | null;
  sort_order: number;
};

export type LunaPromptRow = {
  id: string;
  level: LunaPromptLevel;
  kind: LunaPromptKind;
  prompt_key: string | null;
  group_name?: string | null;
  title: string;
  description: string | null;
  purpose: string | null;
  content: string;
  is_active: boolean;
  sort_order: number;
  stage?: number | null;
  stage_order?: number | null;
  parent_key?: string | null;
  owner_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_editor_name?: string | null;
  changed_by_luna?: boolean;
  versions?: LunaPromptVersionRow[];
};

/** 단계 번호 1-1, 4-2-a. 컬럼이 없으면 prompt_key 시드, 그것도 없으면 L1-01. */
export function formatPromptNumber(p: PromptNumberInput): string {
  return formatStageNumber(applyPromptStageFields(p));
}

/** luna_prompts 에서 prompt_key 로 active content 조회. 실패 시 "". */
export async function getPrompt(
  admin: SupabaseClient,
  key: string
): Promise<string> {
  try {
    const { data, error } = await admin
      .from("luna_prompts")
      .select("content")
      .eq("prompt_key", key)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("[luna/prompts] getPrompt", key, error);
      return "";
    }
    return typeof data?.content === "string" ? data.content : "";
  } catch (err) {
    console.error("[luna/prompts] getPrompt", key, err);
    return "";
  }
}

/** 여러 prompt_key 를 한 번에 조회해 맵으로 반환. */
export async function getPrompts(
  admin: SupabaseClient,
  keys: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of keys) result[key] = "";
  if (keys.length === 0) return result;

  try {
    const { data, error } = await admin
      .from("luna_prompts")
      .select("prompt_key, content")
      .in("prompt_key", keys)
      .eq("is_active", true);

    if (error) {
      console.error("[luna/prompts] getPrompts", error);
      return result;
    }

    for (const row of data ?? []) {
      const key = typeof row.prompt_key === "string" ? row.prompt_key : "";
      if (!key) continue;
      result[key] = typeof row.content === "string" ? row.content : "";
    }
    return result;
  } catch (err) {
    console.error("[luna/prompts] getPrompts", err);
    return result;
  }
}

/** 여러 prompt_key 의 content+메타. 없으면 키만 빈 값. */
export async function getPromptRows(
  admin: SupabaseClient,
  keys: string[]
): Promise<Record<string, LunaLoadedPrompt>> {
  const result: Record<string, LunaLoadedPrompt> = {};
  if (keys.length === 0) return result;

  try {
    const { data, error } = await admin
      .from("luna_prompts")
      .select(
        "prompt_key, content, title, level, kind, sort_order, stage, stage_order, parent_key"
      )
      .in("prompt_key", keys)
      .eq("is_active", true);

    if (error) {
      const missing =
        error.code === "42703" ||
        /stage|parent_key/i.test(error.message ?? "");
      if (!missing) {
        console.error("[luna/prompts] getPromptRows", error);
        return result;
      }
      const retry = await admin
        .from("luna_prompts")
        .select("prompt_key, content, title, level, kind, sort_order")
        .in("prompt_key", keys)
        .eq("is_active", true);
      if (retry.error) {
        console.error("[luna/prompts] getPromptRows", retry.error);
        return result;
      }
      for (const row of retry.data ?? []) {
        const key = typeof row.prompt_key === "string" ? row.prompt_key : "";
        if (!key) continue;
        const staged = applyPromptStageFields({
          prompt_key: key,
          level: row.level as LunaPromptLevel,
          kind: row.kind as LunaPromptKind,
          sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
          stage: null,
          stage_order: null,
          parent_key: null
        });
        result[key] = {
          prompt_key: key,
          content: typeof row.content === "string" ? row.content : "",
          title: typeof row.title === "string" ? row.title : key,
          level: staged.level as LunaPromptLevel,
          kind: staged.kind as LunaPromptKind,
          sort_order: staged.sort_order ?? 0,
          stage: staged.stage,
          stage_order: staged.stage_order,
          parent_key: staged.parent_key
        };
      }
      return result;
    }

    for (const row of data ?? []) {
      const key = typeof row.prompt_key === "string" ? row.prompt_key : "";
      if (!key) continue;
      const staged = applyPromptStageFields({
        prompt_key: key,
        level: row.level as LunaPromptLevel,
        kind: row.kind as LunaPromptKind,
        sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
        stage: typeof row.stage === "number" ? row.stage : null,
        stage_order: typeof row.stage_order === "number" ? row.stage_order : null,
        parent_key: typeof row.parent_key === "string" ? row.parent_key : null
      });
      result[key] = {
        prompt_key: key,
        content: typeof row.content === "string" ? row.content : "",
        title: typeof row.title === "string" ? row.title : key,
        level: staged.level as LunaPromptLevel,
        kind: staged.kind as LunaPromptKind,
        sort_order: staged.sort_order ?? 0,
        stage: staged.stage,
        stage_order: staged.stage_order,
        parent_key: staged.parent_key
      };
    }
    return result;
  } catch (err) {
    console.error("[luna/prompts] getPromptRows", err);
    return result;
  }
}
