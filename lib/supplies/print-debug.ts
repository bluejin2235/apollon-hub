/** QR 라벨 인쇄 디버그 (개발 환경 또는 localStorage 플래그) */
export function isPrintLabelDebugEnabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage.getItem("apollon:print-label-debug") === "1") return true;
    } catch {
      /* ignore */
    }
  }
  return process.env.NODE_ENV === "development";
}

export function printLabelLog(step: string, detail?: Record<string, unknown>): void {
  if (!isPrintLabelDebugEnabled()) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[print-label] ${step}`, detail);
  } else {
    console.log(`[print-label] ${step}`);
  }
}
