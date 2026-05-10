/** 카카오 로컬 API 키워드 검색 `documents[]` 항목 (필요 필드만) */
export type KakaoKeywordPlace = {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
};

export type KakaoKeywordSearchResponse = {
  documents?: KakaoKeywordPlace[];
  meta?: { total_count?: number; is_end?: boolean };
};

export function pickDisplayAddress(doc: KakaoKeywordPlace): string {
  const road = doc.road_address_name?.trim();
  const jibun = doc.address_name?.trim();
  return road || jibun || "";
}
