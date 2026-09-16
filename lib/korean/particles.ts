/**
 * 한글 조사 — 받침 유무로 을/를 · 이/가 · 은/는 선택
 */

function lastHangul(word: string): string | null {
  const chars = [...word.trim()].reverse();
  for (const ch of chars) {
    if (ch >= "가" && ch <= "힣") return ch;
  }
  return null;
}

/** 마지막 한글에 받침이 있으면 true */
export function hasBatchim(word: string): boolean {
  const ch = lastHangul(word);
  if (!ch) return false;
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}

export function eulReul(word: string): "을" | "를" {
  return hasBatchim(word) ? "을" : "를";
}

export function iGa(word: string): "이" | "가" {
  return hasBatchim(word) ? "이" : "가";
}

export function eunNeun(word: string): "은" | "는" {
  return hasBatchim(word) ? "은" : "는";
}

/** `후보 정리를 고쳐 주세요` */
export function withObjectParticle(word: string, suffix: string): string {
  return `${word}${eulReul(word)}${suffix}`;
}
