export const IMAGE_PRESETS = [
  "full",
  "split",
  "triple",
  "offset",
  "offset-reverse",
  "gallery-auto",
  "carousel",
  "compare"
] as const;

export const IMAGE_TEXT_PRESETS = ["image-text", "text-image", "portrait-text"] as const;
export const VIDEO_PRESETS = ["video-full", "video-text"] as const;
export const TEXT_TAB_PRESETS = ["text-only", "text-split", "text-triple"] as const;
export const TEXT_PRESETS = [
  "text-only",
  "text-split",
  "text-triple",
  "image-text",
  "text-image",
  "portrait-text",
  "video-text"
] as const;

export const PICKER_TABS = [
  { id: "all", label: "전체" },
  { id: "image", label: "이미지" },
  { id: "text", label: "글" },
  { id: "image-text", label: "이미지+글" },
  { id: "video", label: "영상" },
  { id: "embed", label: "임베드" }
] as const;

export type PickerTabId = (typeof PICKER_TABS)[number]["id"];

export const PICKER_PRESETS = [
  ...IMAGE_PRESETS,
  ...TEXT_TAB_PRESETS,
  ...IMAGE_TEXT_PRESETS,
  ...VIDEO_PRESETS,
  "embed"
] as const;

export const EMBED_PROVIDERS = [
  { id: "youtube", label: "YouTube" },
  { id: "vimeo", label: "Vimeo" },
  { id: "behance", label: "Behance" },
  { id: "sketchfab", label: "Sketchfab" },
  { id: "matterport", label: "Matterport" },
  { id: "kuula", label: "Kuula" },
  { id: "figma", label: "Figma" },
  { id: "googlemaps", label: "Google Maps" }
] as const;

export const PRESET_LABEL: Record<string, string> = {
  full: "전폭 이미지",
  split: "2단 나란히",
  triple: "3단 나란히",
  offset: "가로 + 세로",
  "offset-reverse": "세로 + 가로",
  "gallery-auto": "자동 배치 갤러리",
  carousel: "가로 스크롤",
  compare: "전후 비교",
  "image-text": "이미지 + 글 나란히",
  "text-image": "글 + 큰 이미지",
  "portrait-text": "세로 이미지 + 글",
  "video-full": "영상 전폭",
  "video-text": "영상 + 글",
  embed: "임베드",
  "text-only": "전폭 글",
  "text-split": "2단 글",
  "text-triple": "3단 글"
};

export const PRESET_DESCRIPTION: Record<string, string> = {
  full: "본문 전폭. 이미지 1장만. 가로는 16:9 로 올려야 합니다.",
  split: "두 장을 나란히. 가로 이미지는 16:9. 높이를 맞춥니다.",
  triple: "세 장을 나란히. 가로 이미지는 16:9. 높이를 맞춥니다.",
  offset:
    "왼쪽에 가로 사진, 오른쪽에 세로 사진. 가로 사진은 16:9. 왼쪽 사진이 높이를 정하고 오른쪽은 그 높이에 맞춰 잘립니다.",
  "offset-reverse":
    "왼쪽에 세로 사진, 오른쪽에 가로 사진. 가로 사진은 16:9. 오른쪽 사진이 높이를 정하고 왼쪽은 그 높이에 맞춰 잘립니다.",
  compare: "두 장을 겹쳐 전후를 비교합니다. 가로 이미지는 16:9 입니다.",
  "gallery-auto": "여러 장을 자동 배치합니다. 가로 이미지는 16:9 로 올려야 합니다.",
  carousel: "가로로 넘겨 보는 스크롤 갤러리입니다. 가로 이미지는 16:9 입니다.",
  "image-text": "이미지와 글을 나란히 둡니다. 가로 이미지는 16:9 입니다.",
  "text-image": "글을 두고 큰 이미지를 옆에 둡니다. 가로 이미지는 16:9 입니다.",
  "portrait-text": "세로 이미지와 글을 나란히 둡니다. 3:4 · 2:3 권장.",
  "video-full": "영상을 본문 전폭으로 둡니다.",
  "video-text": "영상과 글을 나란히 둡니다.",
  embed: "Sketchfab · Matterport · Google Maps",
  "text-only": "본문 폭 가득",
  "text-split": "글을 두 칸으로 나란히",
  "text-triple": "글을 세 칸으로 나란히"
};

export const ALL_PRESETS = Object.keys(PRESET_LABEL);

export function imageLimitForPreset(preset: string): number | null {
  if (
    preset === "full" ||
    preset === "image-text" ||
    preset === "text-image" ||
    preset === "portrait-text"
  ) {
    return 1;
  }
  if (preset === "split" || preset === "offset" || preset === "offset-reverse" || preset === "compare") {
    return 2;
  }
  if (preset === "triple") {
    return 3;
  }
  if (preset === "gallery-auto" || preset === "carousel") {
    return null;
  }
  return 0;
}

export function hasImages(preset: string): boolean {
  const limit = imageLimitForPreset(preset);
  return limit === null || limit > 0;
}

export function hasBody(preset: string): boolean {
  return (TEXT_PRESETS as readonly string[]).includes(preset);
}

export function textColumnCount(preset: string): number {
  if (preset === "text-split") return 2;
  if (preset === "text-triple") return 3;
  return 0;
}

export function pickerTabForPreset(
  preset: string
): Exclude<PickerTabId, "all"> | "other" {
  if ((IMAGE_PRESETS as readonly string[]).includes(preset)) return "image";
  if ((TEXT_TAB_PRESETS as readonly string[]).includes(preset)) return "text";
  if ((IMAGE_TEXT_PRESETS as readonly string[]).includes(preset)) return "image-text";
  if ((VIDEO_PRESETS as readonly string[]).includes(preset)) return "video";
  if (preset === "embed") return "embed";
  return "other";
}

export function pickerItemsForTab(tab: PickerTabId) {
  return PICKER_PRESETS.filter(
    (preset) => tab === "all" || pickerTabForPreset(preset) === tab
  ).map((preset) => ({
    preset,
    name: PRESET_LABEL[preset] ?? preset,
    description: PRESET_DESCRIPTION[preset] ?? ""
  }));
}

export function defaultTextSide(preset: string): "left" | "right" {
  return preset === "text-image" ? "left" : "right";
}

const box = "rounded-[2px] bg-slate-300";
const dark = "rounded-[2px] bg-slate-500";
const purple = "rounded-[2px] bg-violet-200";
const line = "h-[3px] rounded-full bg-slate-300";

export function BlockDiagram({ preset }: { preset: string }) {
  return (
    <div className="flex h-[72px] items-center justify-center bg-slate-50 p-2.5">
      <DiagramInner preset={preset} />
    </div>
  );
}

function DiagramInner({ preset }: { preset: string }) {
  switch (preset) {
    case "full":
      return <div className={`h-full w-full ${box}`} />;
    case "split":
      return (
        <div className="flex h-full w-full gap-1">
          <div className={`flex-1 ${box}`} />
          <div className={`flex-1 ${box}`} />
        </div>
      );
    case "triple":
      return (
        <div className="flex h-full w-full gap-1">
          <div className={`flex-1 ${box}`} />
          <div className={`flex-1 ${box}`} />
          <div className={`flex-1 ${box}`} />
        </div>
      );
    case "offset":
      return (
        <div className="flex h-full w-full gap-1">
          <div className={`flex-[2] ${box}`} />
          <div className={`flex-1 ${box}`} />
        </div>
      );
    case "offset-reverse":
      return (
        <div className="flex h-full w-full gap-1">
          <div className={`flex-1 ${box}`} />
          <div className={`flex-[2] ${box}`} />
        </div>
      );
    case "gallery-auto":
      return (
        <div className="flex h-full w-full gap-1">
          <div className={`flex-[1.8] ${box}`} />
          <div className={`flex-[0.9] ${box}`} />
          <div className={`flex-[1.3] ${box}`} />
        </div>
      );
    case "carousel":
      return (
        <div className="flex h-full w-full items-center gap-1">
          <div className={`h-3/4 w-4 shrink-0 ${box} opacity-50`} />
          <div className={`h-full flex-1 ${box}`} />
          <div className={`h-full flex-1 ${box}`} />
          <div className={`h-3/4 w-4 shrink-0 ${box} opacity-50`} />
        </div>
      );
    case "compare":
      return (
        <div className="relative flex h-full w-full overflow-hidden rounded-[2px]">
          <div className={`flex-1 ${box}`} />
          <div className={`flex-1 ${dark} opacity-60`} />
          <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white" />
        </div>
      );
    case "image-text":
      return (
        <div className="flex h-full w-full gap-1.5">
          <div className={`flex-[1.2] ${box}`} />
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-3/5`} />
          </div>
        </div>
      );
    case "text-image":
      return (
        <div className="flex h-full w-full gap-1.5">
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-3/5`} />
          </div>
          <div className={`flex-[1.4] ${box}`} />
        </div>
      );
    case "portrait-text":
      return (
        <div className="flex h-full w-full gap-1.5">
          <div className={`w-[38%] ${box}`} />
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-2/3`} />
          </div>
        </div>
      );
    case "video-full":
      return (
        <div className={`relative h-full w-full ${dark}`}>
          <PlayMark />
        </div>
      );
    case "video-text":
      return (
        <div className="flex h-full w-full gap-1.5">
          <div className={`relative flex-[1.4] ${dark}`}>
            <PlayMark />
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-3/5`} />
          </div>
        </div>
      );
    case "embed":
      return (
        <div className={`relative h-full w-full ${purple}`}>
          <PlayMark className="bg-violet-400" />
        </div>
      );
    case "text-only":
      return (
        <div className="flex h-full w-full flex-col justify-center gap-1.5 px-1">
          <div className={`${line} w-full`} />
          <div className={`${line} w-[92%]`} />
          <div className={`${line} w-[78%]`} />
        </div>
      );
    case "text-split":
      return (
        <div className="flex h-full w-full gap-1.5">
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-3/5`} />
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-3/5`} />
          </div>
        </div>
      );
    case "text-triple":
      return (
        <div className="flex h-full w-full gap-1">
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-2/3`} />
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-2/3`} />
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 py-1">
            <div className={`${line} w-full`} />
            <div className={`${line} w-4/5`} />
            <div className={`${line} w-2/3`} />
          </div>
        </div>
      );
    default:
      return <div className={`h-full w-full ${box}`} />;
  }
}

function PlayMark({ className = "bg-white/70" }: { className?: string }) {
  return (
    <span className={`absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 ${className}`} style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }} />
  );
}
