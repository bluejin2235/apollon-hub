const SUPPLY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** QR에 넣을 비품 식별 URL (라벨 인쇄·모바일 카메라 직접 인식용) */
export function formatSupplyQrPayload(supplyId: string): string {
  return `https://apollon-hub.vercel.app/s/${supplyId}`;
}

function extractSupplyIdFromPath(pathname: string): string | null {
  const shortMatch = pathname.match(/\/s\/([0-9a-f-]{36})/i);
  if (shortMatch && SUPPLY_UUID_RE.test(shortMatch[1])) {
    return shortMatch[1].toLowerCase();
  }

  const suppliesMatch = pathname.match(/\/supplies\/([0-9a-f-]{36})/i);
  if (suppliesMatch && SUPPLY_UUID_RE.test(suppliesMatch[1])) {
    return suppliesMatch[1].toLowerCase();
  }

  return null;
}

/**
 * 스캔 문자열에서 비품 UUID 추출.
 * - supply:{uuid}
 * - {uuid}
 * - https://.../s/{uuid}
 * - /s/{uuid}
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

  const pathMatch = extractSupplyIdFromPath(trimmed);
  if (pathMatch) return pathMatch;

  try {
    const url = new URL(trimmed);
    return extractSupplyIdFromPath(url.pathname);
  } catch {
    /* not a URL */
  }

  return null;
}

export function supplyIdsMatch(scannedId: string, expectedId: string): boolean {
  return scannedId.toLowerCase() === expectedId.toLowerCase();
}
