/**
 * 이미지 색인 규모 — 회사 PC 전수 dry-run 실측(폴더 include 필터 해제 전 파이프라인).
 * 2,436,857(확장자 스캔) → 198,302(제외 규칙) → 예전 77,065(레퍼런스·KV include).
 * 2026-09-19 include 필터 해제 후 대상은 image_after_exclude 규모.
 * dry-run 재집계 후 숫자를 갱신한다.
 */
export const IMAGE_CORPUS_TOTAL = 198_302;
/** 이미지 색인 파이프라인 — 회사 PC 전수 스캔 규모 (nas_directory 가 아님) */
export const IMAGE_SCAN_TOTAL = 2_436_857;
export const IMAGE_AFTER_EXCLUDE = 198_302;
export const IMAGE_UNREAD = 235;
