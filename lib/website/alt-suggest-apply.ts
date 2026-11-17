/** AI 응답 적용 직전: 요청 중 사람이 칸을 고쳤으면 덮어쓰지 않는다. */

export function shouldApplyAiAlt(opts: {
  koBefore: string;
  enBefore: string;
  koNow: string;
  enNow: string;
}): boolean {
  return opts.koBefore === opts.koNow && opts.enBefore === opts.enNow;
}
