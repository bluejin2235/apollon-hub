import { isLongEdgeTooSmall } from "@/lib/website/image-long-edge";
import type { InsightDetail } from "@/lib/website/insight-detail";
import type { WorkDetail } from "@/lib/website/work-detail";

export type SmallBodyImageSpot = {
  blockId: string;
  blockIndex: number;
};

function isSmallSrc(
  width: number | null | undefined,
  height: number | null | undefined,
  src: string | null | undefined
) {
  return isLongEdgeTooSmall(width, height, { src });
}

export function listSmallWorkBodyImages(work: WorkDetail): SmallBodyImageSpot[] {
  const spots: SmallBodyImageSpot[] = [];
  const sections = [...(work.work_sections ?? [])]
    .filter((section) => section.kind !== "interview")
    .sort((a, b) => a.sort - b.sort);
  let blockIndex = 0;
  for (const section of sections) {
    const blocks = [...(section.content_blocks ?? [])].sort((a, b) => a.sort - b.sort);
    for (const block of blocks) {
      blockIndex += 1;
      for (const image of block.block_images ?? []) {
        if (!isSmallSrc(image.width, image.height, image.src)) continue;
        spots.push({ blockId: block.id, blockIndex });
      }
    }
  }
  return spots;
}

export function listSmallInsightBodyImages(insight: InsightDetail): SmallBodyImageSpot[] {
  const sections = [...(insight.insight_sections ?? [])].sort((a, b) => a.sort - b.sort);
  const sectionIds = new Set(sections.map((section) => section.id));
  const blocks = [...(insight.insight_blocks ?? [])].sort((a, b) => a.sort - b.sort);
  const ordered = [
    ...sections.flatMap((section) => blocks.filter((block) => block.section_id === section.id)),
    ...blocks.filter((block) => !block.section_id || !sectionIds.has(block.section_id))
  ];
  const seen = new Set<string>();
  const unique = ordered.filter((block) => {
    if (seen.has(block.id)) return false;
    seen.add(block.id);
    return true;
  });

  const spots: SmallBodyImageSpot[] = [];
  unique.forEach((block, index) => {
    for (const image of block.insight_images ?? []) {
      if (!isSmallSrc(image.width, image.height, image.src)) continue;
      spots.push({ blockId: block.id, blockIndex: index + 1 });
    }
  });
  return spots;
}
