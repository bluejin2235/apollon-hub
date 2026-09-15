"use client";

import { useMemo } from "react";
import { DevnoteMarkdown } from "@/components/devnote/devnote-markdown";
import { DevnoteButton, DevnoteError } from "@/components/devnote/devnote-ui";

export function DevnoteMarkdownPanel({
  content,
  editing,
  draft,
  saving,
  error,
  onChangeDraft,
  onSave,
  onCancel,
  onStartEdit
}: {
  content: string;
  editing: boolean;
  draft: string;
  saving: boolean;
  error: string | null;
  onChangeDraft: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onStartEdit: () => void;
}) {
  const empty = !content.trim();
  const lineCount = useMemo(
    () => Math.max(18, draft.split("\n").length + 2),
    [draft]
  );

  if (editing) {
    return (
      <div>
        {error ? <DevnoteError message={error} /> : null}
        <textarea
          value={draft}
          onChange={(e) => onChangeDraft(e.target.value)}
          rows={lineCount}
          disabled={saving}
          className="min-h-[400px] w-full resize-none rounded-lg border border-[#E2E5EA] bg-white p-3 font-mono text-[13px] leading-relaxed text-[#15171C] [field-sizing:content] disabled:opacity-70"
        />
        <div className="mt-3 flex gap-2">
          <DevnoteButton tone="primary" disabled={saving} onClick={onSave}>
            {saving ? "저장 중" : "저장"}
          </DevnoteButton>
          <DevnoteButton disabled={saving} onClick={onCancel}>
            취소
          </DevnoteButton>
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="rounded-[10px] border border-dashed border-[#E2E5EA] px-6 py-8 text-center">
        <p className="text-[13px] text-[#858C9A]">
          아직 비어 있습니다. 편집을 눌러 적어주세요.
        </p>
        <DevnoteButton className="mt-3" onClick={onStartEdit}>
          편집
        </DevnoteButton>
      </div>
    );
  }

  return <DevnoteMarkdown content={content} />;
}
