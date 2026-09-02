import type { ContentBlock, WorkDetail } from "@/lib/website/work-detail";

const VIDEO_PRESETS = new Set(["video-full", "video-text"]);
const HOSTED_KINDS = new Set(["hosted", "loop"]);
const YOUTUBE_PLACEHOLDER = "https://www.youtube.com/watch?v=";

export type VideoBlockGap = {
  blockId: string;
  preset: string;
  field: "video_url" | "video_poster" | "video_alt";
  message: string;
};

function isBlankVideoUrl(url: string | null | undefined): boolean {
  const trimmed = (url ?? "").trim();
  return !trimmed || trimmed === YOUTUBE_PLACEHOLDER;
}

function altKoMissing(alt: { ko?: string; en?: string } | null | undefined): boolean {
  return !(alt?.ko?.trim());
}

function gapsForBlock(block: ContentBlock): VideoBlockGap[] {
  if (!VIDEO_PRESETS.has(block.preset)) {
    return [];
  }

  const kind = block.video_kind ?? "embed";
  const gaps: VideoBlockGap[] = [];

  if (HOSTED_KINDS.has(kind)) {
    if (isBlankVideoUrl(block.video_url)) {
      gaps.push({
        blockId: block.id,
        preset: block.preset,
        field: "video_url",
        message: "영상 파일을 올려 주세요",
      });
    }
    if (!(block.video_poster ?? "").trim()) {
      gaps.push({
        blockId: block.id,
        preset: block.preset,
        field: "video_poster",
        message: "재생 전 이미지를 선택해 주세요",
      });
    }
    if (altKoMissing(block.video_alt)) {
      gaps.push({
        blockId: block.id,
        preset: block.preset,
        field: "video_alt",
        message: "영상 대체 텍스트를 입력해 주세요",
      });
    }
  } else {
    if (isBlankVideoUrl(block.video_url)) {
      gaps.push({
        blockId: block.id,
        preset: block.preset,
        field: "video_url",
        message: "영상 주소를 입력해 주세요",
      });
    }
    if (altKoMissing(block.video_alt)) {
      gaps.push({
        blockId: block.id,
        preset: block.preset,
        field: "video_alt",
        message: "영상 대체 텍스트를 입력해 주세요",
      });
    }
  }

  return gaps;
}

export function findVideoBlockGaps(work: WorkDetail): VideoBlockGap[] {
  const gaps: VideoBlockGap[] = [];
  for (const section of work.work_sections ?? []) {
    for (const block of section.content_blocks ?? []) {
      gaps.push(...gapsForBlock(block));
    }
  }
  return gaps;
}

export function buildVideoBlockCheckItems(work: WorkDetail) {
  return findVideoBlockGaps(work).map((gap) => ({
    flag: `video:${gap.blockId}:${gap.field}` as const,
    kind: "problem" as const,
    tab: "content" as const,
    title: gap.message,
    where: `본문 · ${gap.preset === "video-text" ? "영상+텍스트" : "영상"} 블록`,
  }));
}
