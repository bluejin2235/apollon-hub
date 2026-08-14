"use client";

import { useEffect, useMemo } from "react";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import { WorkserverPathCard } from "@/components/luna/WorkserverPathCard";
import { parseLunaAnswer } from "@/lib/luna/answer-render";
import type { LunaNasDriveMode } from "@/lib/luna/nas-path";
import type { MarkdownSegment } from "@/lib/luna/nas-path";

type LunaMarkdownProps = {
  content: string;
  className?: string;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
  /** 렌더 경로 추적 (스트리밍 / 완료 / DB 로드 등) */
  source?: string;
};

function AssumeBlocks({ assumptions }: { assumptions: string[] }) {
  if (assumptions.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {assumptions.map((a, i) => (
        <div
          key={`${i}-${a.slice(0, 24)}`}
          className="rounded-lg bg-[#FAEEDA] px-[11px] py-[9px] text-[13px] leading-[1.6] text-[#633806]"
        >
          {a}
        </div>
      ))}
    </div>
  );
}

function renderSegments(
  segments: MarkdownSegment[],
  nasDriveMode: LunaNasDriveMode,
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void,
  onCopyToast?: (message: string) => void
) {
  return segments.map((seg, index) => {
    if (seg.type === "text") {
      if (!seg.value) return null;
      return (
        <SafeMarkdown
          key={`text-${index}`}
          content={seg.value}
          variant="luna"
        />
      );
    }

    if (seg.groups.length === 0) return null;

    return (
      <div key={`paths-${index}`} className="my-2.5 space-y-2">
        {seg.groups.map((group, groupIndex) => (
          <WorkserverPathCard
            key={`${group.drive}-${group.folderRawPath}-${groupIndex}`}
            group={group}
            mode={nasDriveMode}
            onModeChange={onNasDriveModeChange}
            onCopyToast={onCopyToast}
          />
        ))}
      </div>
    );
  });
}

export function LunaMarkdown({
  content,
  className = "",
  nasDriveMode,
  onNasDriveModeChange,
  onCopyToast,
  source = "luna-md"
}: LunaMarkdownProps) {
  const parsed = useMemo(() => parseLunaAnswer(content), [content]);

  useEffect(() => {
    const pathSegs = parsed.segments.filter((s) => s.type === "paths");
    console.info("[luna-render]", {
      source,
      assumeCount: parsed.assumptions.length,
      segmentTypes: parsed.segments.map((s) => s.type),
      pathGroups: pathSegs.length,
      files: pathSegs.flatMap((s) =>
        s.type === "paths" ? s.groups.flatMap((g) => g.files) : []
      ),
      preview: content.slice(0, 120)
    });
  }, [content, parsed, source]);

  if (!content.trim()) return null;

  const { segments, assumptions } = parsed;
  const hasContent = segments.some(
    (s) => (s.type === "text" && s.value.trim()) || (s.type === "paths" && s.groups.length > 0)
  );

  return (
    <div
      className={`break-words ${className}`.trim()}
      data-luna-render={source}
      data-luna-paths={segments.filter((s) => s.type === "paths").length}
      data-luna-assume={assumptions.length}
    >
      {hasContent ? renderSegments(segments, nasDriveMode, onNasDriveModeChange, onCopyToast) : null}
      <AssumeBlocks assumptions={assumptions} />
    </div>
  );
}
