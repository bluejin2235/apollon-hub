export const IMAGE_PRESETS = [
  "full",
  "split",
  "offset",
  "offset-reverse",
  "gallery-auto",
  "carousel",
  "fullbleed",
  "compare"
] as const;

export const IMAGE_TEXT_PRESETS = ["image-text", "text-image", "portrait-text"] as const;
export const VIDEO_PRESETS = ["video-full", "video-text"] as const;
export const TEXT_PRESETS = [
  "text-only",
  "image-text",
  "text-image",
  "portrait-text",
  "video-text"
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
  offset: "2단 2:1",
  "offset-reverse": "2단 1:2",
  "gallery-auto": "자동 배치 갤러리",
  carousel: "가로 스크롤",
  fullbleed: "전체폭 · 여백 없음",
  compare: "전후 비교",
  "image-text": "이미지 + 글 나란히",
  "text-image": "글 + 큰 이미지",
  "portrait-text": "세로 이미지 + 글",
  "video-full": "영상 전폭",
  "video-text": "영상 + 글",
  embed: "임베드",
  "text-only": "글만"
};

export const ALL_PRESETS = Object.keys(PRESET_LABEL);

export function imageLimitForPreset(preset: string): number | null {
  if (
    preset === "full" ||
    preset === "fullbleed" ||
    preset === "image-text" ||
    preset === "text-image" ||
    preset === "portrait-text"
  ) {
    return 1;
  }
  if (preset === "split" || preset === "offset" || preset === "offset-reverse" || preset === "compare") {
    return 2;
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

export function pickerTabForPreset(preset: string): "image" | "image-text" | "video" | "embed" | "other" {
  if ((IMAGE_PRESETS as readonly string[]).includes(preset)) return "image";
  if ((IMAGE_TEXT_PRESETS as readonly string[]).includes(preset)) return "image-text";
  if ((VIDEO_PRESETS as readonly string[]).includes(preset)) return "video";
  if (preset === "embed") return "embed";
  return "other";
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
    case "fullbleed":
      return <div className={`h-full w-full ${box}`} />;
    case "split":
      return (
        <div className="flex h-full w-full gap-1">
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
    default:
      return <div className={`h-full w-full ${box}`} />;
  }
}

function PlayMark({ className = "bg-white/70" }: { className?: string }) {
  return (
    <span className={`absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 ${className}`} style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }} />
  );
}
