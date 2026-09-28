import type { LunaCard } from "@/lib/luna/tavily";

/** Image listing is a projection of filtered cards, never a second folder guess. */
export function imageResultAnswer(cards: LunaCard[]): string {
  const images = cards.filter(c => c.type === "image");
  const folders = new Map<string, number>();
  for (const image of images) {
    if (!image.raw_path) continue;
    const parent = image.raw_path.replace(/[\\/][^\\/]+$/, "");
    const path = /^[A-Za-z]:/.test(parent) ? parent : `${image.drive ?? ""}${image.drive ? ":\\" : ""}${parent}`;
    folders.set(path, (folders.get(path) ?? 0) + 1);
  }
  const paths = [...folders].map(([path, count]) => `- ${count}건: \`${path.replace(/`/g, "")}\``);
  return `이번 검색에서 조건에 맞는 이미지 ${images.length}건을 찾았습니다. 아래 이미지 카드를 열어 확인하세요.\n\n${paths.length ? `이미지 원본 폴더:\n${paths.join("\n")}` : "원본 경로는 확인되지 않았습니다."}`;
}

export function scopeResultNote(notion: number, cards: number, wiki: number): string {
  return `\n\n이번에 확인해 제시한 자료는 노션 ${notion}건 · 파일·이미지·링크 ${cards}건 · 위키 ${wiki}건입니다. 색인된 자료 중 검색·선별한 결과이며, 전체 보유 자료를 빠짐없이 확인한 목록은 아닙니다.`;
}
