"use client";

import { useMemo } from "react";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import { WorkserverPathCard } from "@/components/luna/WorkserverPathCard";
import type { LunaNasDriveMode } from "@/lib/luna/nas-path";
import {
  splitMarkdownByWorkserverPaths,
  type MarkdownSegment
} from "@/lib/luna/nas-path";

type LunaMarkdownProps = {
  content: string;
  className?: string;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
};

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
  onCopyToast
}: LunaMarkdownProps) {
  const split = useMemo(() => {
    try {
      const segments = splitMarkdownByWorkserverPaths(content);
      return { ok: true as const, segments };
    } catch {
      return { ok: false as const };
    }
  }, [content]);

  if (!content.trim()) return null;

  if (!split.ok) {
    return (
      <SafeMarkdown content={content} variant="luna" className={className} />
    );
  }

  const { segments } = split;
  const hasPaths = segments.some((s) => s.type === "paths");
  if (!hasPaths) {
    return (
      <SafeMarkdown content={content} variant="luna" className={className} />
    );
  }

  return (
    <div className={`break-words ${className}`.trim()}>
      {renderSegments(segments, nasDriveMode, onNasDriveModeChange, onCopyToast)}
    </div>
  );
}
