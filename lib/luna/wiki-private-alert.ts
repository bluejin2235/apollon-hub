import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeWikiSources, type WikiSourceRef } from "@/lib/luna/wiki-match";
import { notifyPrivateWikiOveruse } from "@/lib/wiki/notify";

export const PRIVATE_WIKI_OVERUSE_THRESHOLD = 5;

export function countPrivateWikiRefsInConversation(
  messages: Array<{ metadata?: Record<string, unknown> | null }>
): Map<string, { count: number; docTitle: string }> {
  const counts = new Map<string, { count: number; docTitle: string }>();
  for (const msg of messages) {
    const meta = msg.metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
    const refs = normalizeWikiSources(meta.private_wiki_refs) ?? [];
    for (const ref of refs) {
      const prev = counts.get(ref.slug);
      counts.set(ref.slug, {
        count: (prev?.count ?? 0) + 1,
        docTitle: ref.title || prev?.docTitle || ref.slug
      });
    }
  }
  return counts;
}

async function alreadyNotified(
  admin: SupabaseClient,
  conversationId: string,
  slug: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("hub_notifications")
    .select("id")
    .eq("category", "wiki_private_overuse")
    .contains("meta", { conversation_id: conversationId, slug })
    .limit(1);
  if (error) {
    console.error("[wiki] private overuse lookup", error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export async function checkAndNotifyPrivateWikiOveruse(
  admin: SupabaseClient,
  opts: {
    conversationId: string;
    userName: string;
    usedPrivateRefs: WikiSourceRef[];
  }
): Promise<void> {
  if (opts.usedPrivateRefs.length === 0) return;

  const { data: rows, error } = await admin
    .from("luna_messages")
    .select("metadata")
    .eq("conversation_id", opts.conversationId)
    .eq("role", "assistant");
  if (error) {
    console.error("[wiki] private overuse messages", error);
    return;
  }

  const counts = countPrivateWikiRefsInConversation(rows ?? []);
  const slugsThisTurn = new Set(opts.usedPrivateRefs.map((r) => r.slug));

  for (const slug of slugsThisTurn) {
    const row = counts.get(slug);
    if (!row || row.count < PRIVATE_WIKI_OVERUSE_THRESHOLD) continue;
    if (await alreadyNotified(admin, opts.conversationId, slug)) continue;
    await notifyPrivateWikiOveruse(admin, {
      conversationId: opts.conversationId,
      userName: opts.userName,
      slug,
      docTitle: row.docTitle,
      count: row.count
    });
  }
}
