const SUPPLY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** QR에 넣을 비품 식별자 (라벨 인쇄·스캔용) */
export function formatSupplyQrPayload(supplyId: string): string {
  return `https://apollon-hub.vercel.app/supplies/${supplyId}/loan`;
}

/**
 * 스캔 문자열에서 비품 UUID 추출.
 * - supply:{uuid}
 * - {uuid}
 * - https://.../supplies/{uuid}
 * - /supplies/{uuid}
 */
export function parseSupplyIdFromQr(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith("supply:")) {
    const id = trimmed.slice(7).trim();
    return SUPPLY_UUID_RE.test(id) ? id.toLowerCase() : null;
  }

  if (SUPPLY_UUID_RE.test(trimmed)) return trimmed.toLowerCase();

  const pathMatch = trimmed.match(/\/supplies\/([0-9a-f-]{36})/i);
  if (pathMatch && SUPPLY_UUID_RE.test(pathMatch[1])) {
    return pathMatch[1].toLowerCase();
  }

  try {
    const url = new URL(trimmed);
    const urlMatch = url.pathname.match(/\/supplies\/([0-9a-f-]{36})/i);
    if (urlMatch && SUPPLY_UUID_RE.test(urlMatch[1])) {
      return urlMatch[1].toLowerCase();
    }
  } catch {
    /* not a URL */
  }

  return null;
}

export function supplyIdsMatch(scannedId: string, expectedId: string): boolean {
  return scannedId.toLowerCase() === expectedId.toLowerCase();
}
