import type { SupabaseClient } from '@supabase/supabase-js';

export const NOTION_BODY_VERSION = 2;
export function isNotionBodyReady(health: unknown): boolean {
  if (!health || typeof health !== 'object') return false;
  const h = health as Record<string, unknown>;
  return h.version === NOTION_BODY_VERSION && (h.state === 'ready' || h.state === 'empty');
}
export function completeNotionHealth(input: { blocks: number; chunks: number; eligible: number; embedded: number; bodyHash: string }) {
  if (input.embedded !== input.eligible) throw new Error(`incomplete embeddings: ${input.embedded}/${input.eligible}`);
  return { version: NOTION_BODY_VERSION, state: input.chunks ? 'ready' : 'empty',
    blocks: input.blocks, chunks: input.chunks, eligible_embeddings: input.eligible,
    verified_embeddings: input.embedded, body_hash: input.bodyHash, checked_at: new Date().toISOString() };
}
export async function markNotionBodyFailure(admin: SupabaseClient, pageId: string, error: string) {
  const { error: writeError } = await admin.from('luna_notion_pages').update({
    index_health: { version: NOTION_BODY_VERSION, state: 'failed', error: error.slice(0, 300), checked_at: new Date().toISOString() }
  }).eq('page_id', pageId);
  if (writeError) console.error('[notion-index] health update failed', writeError.message);
}
