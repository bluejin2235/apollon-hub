"use client";

import { useMemo, useState } from "react";
import { RichTextEditor } from "@/components/website/rich-text-editor";
import { uploadIssueMedia } from "@/lib/issues/client";
import { issueToEditorHtml, sanitizeIssueHtml } from "@/lib/issues/html";
import { nameInitial, type IssueMember } from "@/lib/issues/types";
import "@/components/issues/issues.css";

type Props = {
  value: string;
  onChange: (html: string) => void;
  members: IssueMember[];
  compact?: boolean;
};

export function IssueEditor({ value, onChange, members, compact = false }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members.slice(0, 8);
    return members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [members, query]);

  function detectMention(html: string) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    const match = text.match(/@([^\s@]{0,12})$/);
    if (match) {
      setQuery(match[1] ?? "");
      setOpen(true);
    } else {
      setOpen(false);
      setQuery("");
    }
  }

  function insertMention(name: string) {
    const next = value.replace(/@([^\s<@]{0,12})$/, "").replace(/@([^<]{0,12})$/, "");
    const html = `${next}<span class="mention">@${name}</span>&nbsp;`;
    onChange(html);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={`iss-ed-wrap iss-ed${compact ? " compact" : ""}`}>
      <RichTextEditor
        surface="insight-body"
        sanitize={sanitizeIssueHtml}
        toEditorHtml={issueToEditorHtml}
        allowMedia
        onUploadFile={uploadIssueMedia}
        fields={[
          {
            id: "body",
            value: value || "<p><br></p>",
            onChange: (html) => {
              onChange(html);
              detectMention(html);
            }
          }
        ]}
      />
      {open && hits.length > 0 ? (
        <div className="iss-mentions">
          {hits.map((member) => (
            <button
              key={member.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                insertMention(member.name);
              }}
            >
              <span className="iss-av">{nameInitial(member.name)}</span>
              {member.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
