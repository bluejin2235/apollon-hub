import type { SupabaseClient } from "@supabase/supabase-js";

export type LunaPromptLevel = "L1" | "L2" | "L3";
export type LunaPromptKind = "identity" | "perspective" | "task" | "system";

export type LunaPromptVersionContent = {
  title: string;
  description: string;
  purpose: string;
  content: string;
  owner_id: string | null;
  sort_order: number;
};

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
};

export type LunaPromptRow = {
  id: string;
  level: LunaPromptLevel;
  kind: LunaPromptKind;
  prompt_key: string | null;
  title: string;
  description: string | null;
  purpose: string | null;
  content: string;
  is_active: boolean;
  sort_order: number;
  owner_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_editor_name?: string | null;
  changed_by_luna?: boolean;
  versions?: LunaPromptVersionRow[];
};

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
