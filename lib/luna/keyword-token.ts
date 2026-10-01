/** Single-syllable domain nouns are meaningful search constraints, not particles. */
const SINGLE_NOUNS = new Set(['숲', '빛', '물', '산', '강', '꽃', '밤', '낮', '눈', '비', '별', '벽', '길', '돌', '풀', '색', '흙']);
export function isSearchToken(token: string): boolean {
  return token.length >= 2 || SINGLE_NOUNS.has(token);
}
