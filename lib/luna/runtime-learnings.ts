import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningMatchRow } from "@/lib/luna/knowledge-match";
import { isProductionData } from "@/lib/luna/data-context";

/** One injection boundary for interactive chat and the existing evaluator. */
export async function loadRuntimeLearnings(admin: SupabaseClient) {
  const result = await admin.from("luna_learnings")
    .select("id, content, category, importance, use_count, created_at, data_context, meta, source_conversation_id")
    .eq("status", "active")
    .eq("data_context", "production")
    .neq("category", "identity")
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (result.error) return { data: null, error: result.error };

  const rows = (result.data ?? []).filter(isProductionData);
  const ids = [...new Set(rows.map((row) => row.source_conversation_id).filter(Boolean))];
  if (ids.length === 0) return { data: rows as LearningMatchRow[], error: null };

  // A conversation may have been marked synthetic after a learning was created.
  const conversations = await admin.from("luna_conversations")
    .select("id, title, data_context").in("id", ids);
  if (conversations.error) return { data: null, error: conversations.error };
  const allowed = new Set((conversations.data ?? []).filter(isProductionData).map((row) => row.id));
  return {
    data: rows.filter((row) => !row.source_conversation_id || allowed.has(row.source_conversation_id)) as LearningMatchRow[],
    error: null
  };
}
