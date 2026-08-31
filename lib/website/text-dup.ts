import type { CheckWorks } from "@/lib/website/types";
import { asLoc, type Loc, type WorkDetail } from "@/lib/website/work-detail";

const BLOCK_NAME_CAPTIONS = [
  "전폭 이미지",
  "2단 나란히",
  "3단 나란히",
  "가로 + 세로",
  "세로 + 가로",
  "자동 배치 갤러리",
  "자동배치갤러리",
  "가로 스크롤",
  "전후 비교",
  "이미지 + 글 나란히",
  "글 + 큰 이미지",
  "세로 이미지 + 글",
  "영상 전폭",
  "영상 + 글",
  "임베드"
];

const BLOCK_NAME_KEYS = new Set(BLOCK_NAME_CAPTIONS.map(stripSpaces));

export type LocMap = Record<string, Loc>;

export function stripSpaces(value: string): string {
  return value.replace(/\s+/g, "");
}

export function isBlockNameCaption(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return BLOCK_NAME_KEYS.has(stripSpaces(trimmed));
}

export function exactDupCounts(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    map.set(trimmed, (map.get(trimmed) ?? 0) + 1);
  }
  return map;
}

export function dupCountFor(value: string, counts: Map<string, number>): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const n = counts.get(trimmed) ?? 0;
  return n >= 2 ? n : 0;
}

export function flaggedFieldCount(items: Loc[]): number {
  const ko = exactDupCounts(items.map((item) => item.ko));
  const en = exactDupCounts(items.map((item) => item.en));
  let n = 0;
  for (const item of items) {
    if (dupCountFor(item.ko, ko)) n += 1;
    if (dupCountFor(item.en, en)) n += 1;
  }
  return n;
}

export function collectWorkTextMaps(work: WorkDetail): { captions: LocMap; alts: LocMap } {
  const captions: LocMap = {};
  const alts: LocMap = {};
  for (const section of work.work_sections ?? []) {
    for (const block of section.content_blocks ?? []) {
      for (const image of block.block_images ?? []) {
        captions[image.id] = asLoc(image.caption);
        alts[image.id] = asLoc(image.alt);
      }
      if (block.preset === "video-full" || block.preset === "video-text") {
        alts[`video:${block.id}`] = asLoc(block.video_alt);
        captions[block.id] = asLoc(block.caption);
      }
      if (block.preset === "embed") {
        captions[block.id] = asLoc(block.caption);
      }
    }
  }
  return { captions, alts };
}

export function textDupSummary(work: WorkDetail): {
  duplicate_captions: boolean;
  duplicate_alts: boolean;
  duplicate_caption_count: number;
  duplicate_alt_count: number;
} {
  const { captions, alts } = collectWorkTextMaps(work);
  const captionCount = flaggedFieldCount(Object.values(captions));
  const altCount = flaggedFieldCount(Object.values(alts));
  return {
    duplicate_captions: captionCount > 0,
    duplicate_alts: altCount > 0,
    duplicate_caption_count: captionCount,
    duplicate_alt_count: altCount
  };
}

export function applyTextDupChecks(work: WorkDetail, check: CheckWorks): CheckWorks {
  return { ...check, ...textDupSummary(work) };
}
