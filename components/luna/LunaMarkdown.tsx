"use client";

import { useMemo } from "react";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import { WorkserverPathCard } from "@/components/luna/WorkserverPathCard";
import type { LunaNasDriveMode } from "@/lib/luna/nas-path";
import { splitMarkdownByWorkserverPaths } from "@/lib/luna/nas-path";

type LunaMarkdownProps = {
  content: string;
  className?: string;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
};

export function LunaMarkdown({
  content,
  className = "",
  nasDriveMode,
  onNasDriveModeChange,
  onCopyToast
}: LunaMarkdownProps) {
  const segments = useMemo(
    () => splitMarkdownByWorkserverPaths(content),
    [content]
  );

  if (!content.trim()) return null;

  return (
    <div className={`break-words ${className}`.trim()}>
      {segments.map((seg, index) => {
        if (seg.type === "text") {
          if (!seg.value.trim()) return null;
          return (
            <SafeMarkdown
              key={`text-${index}`}
              content={seg.value}
              variant="luna"
            />
          );
        }

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
      })}
    </div>
  );
}
