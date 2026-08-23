import type { SupabaseClient } from "@supabase/supabase-js";

function extractNounLikeTokens(text: string): string[] {
  const cleaned = text.replace(/[.,·、]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 24);
}

/** 모달 칩 — glossary 매칭 · 프로젝트 · 설명 토큰 (표시만) */
export async function buildImageModalChips(
  admin: SupabaseClient,
  description: string | null | undefined,
  project: string | null | undefined
): Promise<string[]> {
  const chips: string[] = [];
  const text = description?.trim() ?? "";

  if (project?.trim()) chips.push(project.trim());

  const { data: terms, error } = await admin
    .from("glossary_terms")
    .select("term")
    .limit(400);
  if (error) {
    console.warn("[luna/image-modal-chips] glossary", error.message);
  } else if (text) {
    for (const row of terms ?? []) {
      const term = String((row as { term?: string }).term ?? "").trim();
      if (term.length >= 2 && text.includes(term) && !chips.includes(term)) {
        chips.push(term);
      }
    }
  }

  for (const token of extractNounLikeTokens(text)) {
    if (!chips.includes(token)) chips.push(token);
  }

  return chips.slice(0, 14);
}
