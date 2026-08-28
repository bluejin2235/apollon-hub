import { wikiFetch } from "@/components/wiki/wiki-fetch";

export type WikiSectionResponse = {
  title: string;
  body: string;
  docSlug: string;
  sectionId: string;
  truncated: boolean;
};

const cache = new Map<string, WikiSectionResponse>();
const inflight = new Map<string, Promise<WikiSectionResponse>>();

function cacheKey(docSlug: string, sectionId: string): string {
  return `${docSlug}:${sectionId}`;
}

export function getCachedWikiSection(
  docSlug: string,
  sectionId: string
): WikiSectionResponse | undefined {
  return cache.get(cacheKey(docSlug, sectionId));
}

export async function fetchWikiSection(
  docSlug: string,
  sectionId: string
): Promise<WikiSectionResponse> {
  const key = cacheKey(docSlug, sectionId);
  const hit = cache.get(key);
  if (hit) return hit;

  let pending = inflight.get(key);
  if (!pending) {
    const qs = new URLSearchParams({ slug: docSlug, id: sectionId });
    pending = wikiFetch<WikiSectionResponse>(`/api/wiki/section?${qs}`)
      .then((data) => {
        cache.set(key, data);
        inflight.delete(key);
        return data;
      })
      .catch((err) => {
        inflight.delete(key);
        throw err;
      });
    inflight.set(key, pending);
  }

  return pending;
}
