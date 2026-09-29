import type { NotionIndexCheckpoint } from '@/lib/luna/notion-index-runner';
import type { NotionSearchObject } from '@/lib/luna/notion-index';

type PageMetaMap = NonNullable<NotionIndexCheckpoint['page_meta']>;

/** A cold worker must retain the original page order and cursor. Properties are
 * intentionally absent from persisted checkpoints; that is not missing discovery.
 */
export async function resumeNotionCheckpoint(
  checkpoint: NotionIndexCheckpoint,
  cached: PageMetaMap | undefined,
  discover: () => Promise<NotionIndexCheckpoint>
): Promise<NotionIndexCheckpoint> {
  if (cached && Object.keys(cached).length) return { ...checkpoint, page_meta: cached };
  if (checkpoint.page_meta && Object.keys(checkpoint.page_meta).length) return checkpoint;
  const fresh = await discover();
  return { ...checkpoint, page_meta: fresh.page_meta };
}

/** Fetch only the page being processed, before any page or relation write. */
export async function hydrateNotionCheckpointPage(
  pageId: string,
  meta: PageMetaMap[string],
  fetchMeta: (id: string) => Promise<NotionSearchObject | null>
): Promise<PageMetaMap[string]> {
  if (Object.prototype.hasOwnProperty.call(meta, 'properties')) return meta;
  const live = await fetchMeta(pageId);
  const id = (s: string) => s.replace(/-/g, '').toLowerCase();
  if (!live || live.object !== 'page' || id(live.id) !== id(pageId) || live.archived) {
    throw new Error(`notion page metadata unavailable: ${pageId}`);
  }
  if (!live.properties || typeof live.properties !== 'object') {
    throw new Error(`notion page properties unavailable: ${pageId}`);
  }
  return { ...meta, properties: live.properties };
}
