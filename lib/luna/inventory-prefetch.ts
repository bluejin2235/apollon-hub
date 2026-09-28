/** Launch independent reads together; only project materials depend on Notion evidence. */
export function prefetchInventory<E, N, B, M, I>(options: {
  enabled: boolean;
  embedding: Promise<E>;
  notion: Promise<N>;
  body: (embedding: E) => Promise<B>;
  media: (embedding: E) => Promise<M>;
  materials: (notion: N) => Promise<I>;
}) {
  if (!options.enabled) return null;
  return {
    body: options.embedding.then(options.body),
    media: options.embedding.then(options.media),
    materials: options.notion.then(options.materials)
  };
}
