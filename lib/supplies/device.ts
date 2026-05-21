/** 모바일 판별 (width < 768 또는 모바일 UA) */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  if (window.innerWidth < 768) return true;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
}
