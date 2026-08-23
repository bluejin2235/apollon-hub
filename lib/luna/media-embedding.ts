/** luna_media_index.embedding 파싱 */
export function parseMediaEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const vec = raw.map(Number).filter((n) => Number.isFinite(n));
    return vec.length > 0 ? vec : null;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return null;
  const vec = inner.split(",").map((s) => Number(s.trim()));
  if (vec.some((n) => !Number.isFinite(n))) return null;
  return vec;
}
