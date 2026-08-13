/** reflect 후보 중복·상한 판정 헬퍼 */

const MAX_CANDIDATES_PER_CONVERSATION = 3;

export function reflectCandidateCap(): number {
  return MAX_CANDIDATES_PER_CONVERSATION;
}

export function contentPrefixKey(text: string, n = 30): string {
  return text.replace(/\s+/g, "").slice(0, n);
}

export function extractKeyNouns(text: string): Set<string> {
  const matches = text.match(/[가-힣]{2,}|[A-Za-z]{2,}/g) ?? [];
  return new Set(matches.map((m) => m.toLowerCase()));
}

/** 앞 30자 일치 또는 핵심 명사 집합 80% 이상 겹침 */
export function isNearDuplicateContent(a: string, b: string): boolean {
  const ta = a.trim();
  const tb = b.trim();
  if (!ta || !tb) return false;
  const pa = contentPrefixKey(ta);
  const pb = contentPrefixKey(tb);
  if (pa.length >= 12 && pb.length >= 12 && (pa === pb || ta.includes(pb) || tb.includes(pa))) {
    return true;
  }
  const na = extractKeyNouns(ta);
  const nb = extractKeyNouns(tb);
  if (na.size === 0 || nb.size === 0) return false;
  let overlap = 0;
  for (const x of na) {
    if (nb.has(x)) overlap += 1;
  }
  const denom = Math.min(na.size, nb.size);
  return denom > 0 && overlap / denom >= 0.8;
}

export function filterNewCaptureItems<T extends { content: string }>(
  items: T[],
  existingContents: string[],
  room: number
): T[] {
  if (room <= 0) return [];
  const accepted: T[] = [];
  const pool = [...existingContents];
  for (const item of items) {
    if (accepted.length >= room) break;
    const dup = pool.some((prev) => isNearDuplicateContent(prev, item.content));
    if (dup) continue;
    accepted.push(item);
    pool.push(item.content);
  }
  return accepted;
}
