/** 워크 어드민·업로드 화면에 쓰는 규격 (가이드 문서와 동일한 값) */
export const SPEC = {
  keyImage: { minLong: 1600, storeLong: 2560 },
  bodyImage: { minLong: 1600, storeLong: 3200, frameW: 1600, frameH: 900 },
  /** T-L · Thumbnail Large */
  thumbLarge: { w: 1280, h: 720, maxMB: 1.5 },
  /** T-S · Thumbnail Small */
  thumbSmall: { w: 640, h: 360, maxMB: 0.5 },
  /** D-M · Detail Movie */
  detailMovie: { w: 1920, h: 1080, maxMB: 200 },
  limits: { video: 200 }
} as const;

export const VIDEO_LABELS = {
  thumbLarge: "T-L · 큰 화면용",
  thumbSmall: "T-S · 작은 화면용",
  detailMovie: "D-M · 본문 영상"
} as const;

export const SPEC_BYTES = {
  video: SPEC.limits.video * 1024 * 1024,
  thumbLarge: SPEC.thumbLarge.maxMB * 1024 * 1024,
  thumbSmall: SPEC.thumbSmall.maxMB * 1024 * 1024
} as const;

export function formatKeyImageSize(): string {
  return `긴 변 ${SPEC.keyImage.minLong}`;
}

export function formatKeyImageHint(): string {
  return `긴 변이 ${SPEC.keyImage.minLong} 이상이어야 합니다`;
}

export function formatKeyImageEmptyHint(): string {
  return formatKeyImageHint();
}

export function formatBodyImageHint(): string {
  return `긴 변이 ${SPEC.bodyImage.minLong} 픽셀 이상의 이미지를 권장합니다.`;
}

export function formatFullBodyImageHint(): string {
  return formatBodyImageHint();
}

export function formatBodyImageRejectHint(): string {
  return `긴 변이 ${SPEC.bodyImage.minLong} 이상이어야 합니다`;
}

export function formatPortraitBodyImageHint(): string {
  return formatBodyImageHint();
}

export function formatThumbLargeHint(): string {
  return `MP4 · ${SPEC.thumbLarge.w}×${SPEC.thumbLarge.h} · ${SPEC.thumbLarge.maxMB}MB 이하 · 소리 없음`;
}

export function formatThumbSmallHint(): string {
  return `MP4 · ${SPEC.thumbSmall.w}×${SPEC.thumbSmall.h} · ${SPEC.thumbSmall.maxMB}MB 이하 · 소리 없음`;
}

export function formatDetailMovieHint(): string {
  return `MP4 (H.264) · ${SPEC.detailMovie.w}×${SPEC.detailMovie.h} · ${SPEC.detailMovie.maxMB}MB 이하 · 소리 있음 · AAC 192kbps`;
}

export function formatImageUploadGuide(): string {
  return formatKeyImageHint();
}

export function formatVideoUploadGuide(): string {
  return `${formatDetailMovieHint()}.\n10분이 넘으면 유튜브에 올리고 주소를 붙여넣으세요.`;
}

export function formatBodyImageTooSmallHint(count?: number): string {
  const min = SPEC.bodyImage.minLong;
  if (count && count > 0) {
    return `${count}장의 긴 변이 ${min} 미만입니다`;
  }
  return `긴 변이 ${min} 미만인 이미지가 있습니다`;
}

export function formatSmallBodyImageTitle(count: number): string {
  return `작은 이미지가 ${count}장 있습니다`;
}

export function formatSmallBodyImageWhere(blockIndex: number): string {
  return `${blockIndex}번째 블록 · 긴 변 ${SPEC.bodyImage.minLong} 미만`;
}

export const SMALL_IMAGE_PILL = "작은 이미지";
export const SMALL_IMAGE_HINT = "긴 변 1600 미만 · 크게 볼 때 흐릴 수 있습니다";
export const SMALL_IMAGE_CONFIRM_LEAD_BEFORE = "긴 변이 ";
export const SMALL_IMAGE_CONFIRM_LEAD_EMPHASIS = "1600 픽셀";
export const SMALL_IMAGE_CONFIRM_LEAD_AFTER = " 이상의 이미지를 권장합니다.";
export const SMALL_IMAGE_CONFIRM_FRAME = "1600 × 900";
export const SMALL_IMAGE_CONFIRM_FOOT_1 = "업로드한 이미지 실제 1600×900 기준 사이즈";
export const SMALL_IMAGE_CONFIRM_FOOT_2 = "그래도 업로드 하겠습니까?";
