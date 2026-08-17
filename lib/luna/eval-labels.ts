/** 정기 점검 화면·알림용 표기. DB tier 값 light/heavy 는 바꾸지 않는다. */

export function evalTierLabel(tier: string | null | undefined): string {
  if (tier === "light") return "매일 점검";
  if (tier === "heavy") return "주간 점검";
  if (tier === "prompt") return "프롬프트 점검";
  if (tier === "mixed") return "전체";
  if (!tier) return "구 문항 기준";
  return tier;
}

export function evalFailKindLabel(kind: string | null | undefined): string {
  if (kind === "must_pass") return "지켜야 할 것을 어김";
  if (kind === "quality") return "더 잘할 수 있었음";
  return "";
}
