const SUPPLY_UUID_RE =

  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;



export function isSupplyUuid(identifier: string): boolean {

  return SUPPLY_UUID_RE.test(identifier.trim());

}



/** QR에 넣을 물품 식별 URL (라벨 인쇄·모바일 카메라 직접 인식용) */

export function formatSupplyQrPayload(code: string): string {

  return `https://apollon-hub.vercel.app/s/${code}`;

}



function normalizeScannedIdentifier(value: string): string | null {

  const trimmed = value.trim();

  if (!trimmed) return null;

  if (isSupplyUuid(trimmed)) return trimmed.toLowerCase();

  return trimmed;

}



function extractSupplyIdentifierFromPath(pathname: string): string | null {

  const shortMatch = pathname.match(/\/s\/([^/?#]+)/i);

  if (shortMatch?.[1]) {

    try {

      return normalizeScannedIdentifier(decodeURIComponent(shortMatch[1]));

    } catch {

      return normalizeScannedIdentifier(shortMatch[1]);

    }

  }



  const suppliesMatch = pathname.match(/\/supplies\/([^/?#]+)/i);

  if (suppliesMatch?.[1]) {

    try {

      return normalizeScannedIdentifier(decodeURIComponent(suppliesMatch[1]));

    } catch {

      return normalizeScannedIdentifier(suppliesMatch[1]);

    }

  }



  return null;

}



/**

 * 스캔 문자열에서 물품 식별자(코드 또는 UUID) 추출.

 * - supply:{uuid|code}

 * - {uuid}

 * - https://.../s/{code|uuid}

 * - /s/{code|uuid}

 * - https://.../supplies/{uuid}

 * - /supplies/{uuid}

 *

 * UUID는 소문자로 정규화, code는 원본 그대로 반환.

 */

export function parseSupplyIdFromQr(raw: string): string | null {

  const trimmed = raw.trim();

  if (!trimmed) return null;



  if (trimmed.toLowerCase().startsWith("supply:")) {

    return normalizeScannedIdentifier(trimmed.slice(7));

  }



  if (isSupplyUuid(trimmed)) return trimmed.toLowerCase();



  const pathMatch = extractSupplyIdentifierFromPath(trimmed);

  if (pathMatch) return pathMatch;



  try {

    const url = new URL(trimmed);

    return extractSupplyIdentifierFromPath(url.pathname);

  } catch {

    /* not a URL */

  }



  return null;

}



export function supplyIdsMatch(

  scannedIdentifier: string,

  expected: { id: string; code: string }

): boolean {

  const scanned = scannedIdentifier.trim();

  if (isSupplyUuid(scanned)) {

    return scanned.toLowerCase() === expected.id.toLowerCase();

  }

  if (scanned.toLowerCase() === expected.id.toLowerCase()) {

    return true;

  }

  return scanned === expected.code;

}


