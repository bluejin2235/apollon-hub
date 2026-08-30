/** 워크 어드민·업로드 화면에 쓰는 규격 (가이드 문서와 동일한 값) */
export const SPEC = {
  keyImage: { ratio: "16:9", minWidth: 2560, minHeight: 1440 },
  bodyImage: { ratio: "16:9", minLong: 1600, recommendLong: 3200 },
  /** T-L · Thumbnail Large */
  thumbLarge: { w: 1280, h: 720, maxMB: 1.5 },
  /** T-S · Thumbnail Small */
  thumbSmall: { w: 640, h: 360, maxMB: 0.5 },
  /** D-M · Detail Movie */
  detailMovie: { w: 1920, h: 1080, maxMB: 200 },
  limits: { image: 15, gif: 50, video: 200 }
} as const;

export const VIDEO_LABELS = {
  thumbLarge: "T-L · 큰 화면용",
  thumbSmall: "T-S · 작은 화면용",
  detailMovie: "D-M · 본문 영상"
} as const;

export const SPEC_BYTES = {
  image: SPEC.limits.image * 1024 * 1024,
  gif: SPEC.limits.gif * 1024 * 1024,
  video: SPEC.limits.video * 1024 * 1024,
  thumbLarge: SPEC.thumbLarge.maxMB * 1024 * 1024,
  thumbSmall: SPEC.thumbSmall.maxMB * 1024 * 1024
} as const;

export function formatKeyImageSize(): string {
  return `${SPEC.keyImage.minWidth}×${SPEC.keyImage.minHeight}`;
}

export function formatKeyImageHint(): string {
  return `${SPEC.keyImage.ratio} · ${formatKeyImageSize()} 이상`;
}

export function formatKeyImageEmptyHint(): string {
  return `${formatKeyImageHint()} · ${SPEC.limits.image}MB 이하`;
}

export function formatBodyImageHint(): string {
  return `16:9 · 긴 변 ${SPEC.bodyImage.recommendLong} 이상 권장 (최소 ${SPEC.bodyImage.minLong})`;
}

export function formatBodyImageRejectHint(): string {
  return "16:9 가 아니면 등록되지 않습니다";
}

export function formatPortraitBodyImageHint(): string {
  return "3:4 · 2:3 권장 · 긴 변 2000 이상 권장";
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
  return `PNG · WebP · AVIF · JPG · ${SPEC.limits.image}MB 이하 · GIF 는 ${SPEC.limits.gif}MB 까지`;
}

export function formatVideoUploadGuide(): string {
  return `${formatDetailMovieHint()}.\n10분이 넘으면 유튜브에 올리고 주소를 붙여넣으세요.`;
}

export function formatBodyImageTooSmallHint(count?: number): string {
  const min = SPEC.bodyImage.minLong;
  if (count && count > 0) {
    return `${count}장이 ${min}px 미만입니다. 크게 볼 때 흐립니다`;
  }
  return `${min}px 미만 이미지가 있습니다. 크게 볼 때 흐립니다`;
}
