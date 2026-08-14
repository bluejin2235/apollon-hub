"use client";

import {
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { ArrowUp, Link2, Mic, Paperclip, Plus } from "lucide-react";
import type { LunaPromptRow } from "@/lib/luna/prompts";
import { supabase } from "@/lib/supabase/client";

export type LunaConnectorsState = {
  notion: boolean;
  web: boolean;
  nas: boolean;
};

export type LunaAttachmentRef = {
  id: string;
  file_name: string;
  mime_type: string;
};

export type LunaSkillsSelection = {
  perspective_ids: string[];
  role_ids: string[];
  task_ids: string[];
};

export type LunaManualOverrides = {
  connectors: LunaConnectorsState;
  skills: LunaSkillsSelection;
};

type ScopeKey = "notion" | "nas" | "web";

const SCOPE_ITEMS: { key: ScopeKey; label: string }[] = [
  { key: "notion", label: "노션" },
  { key: "nas", label: "Work서버" },
  { key: "web", label: "웹" }
];

type LunaInputProps = {
  onSend: (
    message: string,
    connectors: LunaConnectorsState,
    attachmentIds: string[],
    attachmentMeta: LunaAttachmentRef[],
    skills: LunaSkillsSelection
  ) => void;
  disabled?: boolean;
  conversationId: string | null;
  onEnsureConversation: () => Promise<string | null>;
  focusTick?: number;
};

const EMPTY_CONNECTORS: LunaConnectorsState = {
  notion: false,
  web: false,
  nas: false
};

const EMPTY_SKILLS: LunaSkillsSelection = {
  perspective_ids: [],
  role_ids: [],
  task_ids: []
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function toggleClass(
  kind: "off" | "perspective" | "role" | "task" | "scope"
): string {
  if (kind === "off") {
    return "cursor-pointer border-[#D3D1C7] bg-transparent text-[#6B6A64]";
  }
  if (kind === "perspective") {
    return "cursor-pointer border-[#BA7517] bg-[#FAEEDA] font-medium text-[#412402]";
  }
  if (kind === "role") {
    return "cursor-pointer border-[#1268B3] bg-[#E6F1FB] font-medium text-[#0C447C]";
  }
  if (kind === "task") {
    return "cursor-pointer border-[#534AB7] bg-[#EEEDFE] font-medium text-[#26215C]";
  }
  return "cursor-pointer border-[#0F6E56] bg-[#E1F5EE] font-medium text-[#04342C]";
}

export function LunaInput({
  onSend,
  disabled,
  conversationId,
  onEnsureConversation,
  focusTick = 0
}: LunaInputProps) {
  const [value, setValue] = useState("");
  const [prompts, setPrompts] = useState<LunaPromptRow[]>([]);
  const [perspectiveOn, setPerspectiveOn] = useState<Record<string, boolean>>({});
  const [roleOn, setRoleOn] = useState<Record<string, boolean>>({});
  const [taskOn, setTaskOn] = useState<Record<string, boolean>>({});
  const [scopeOn, setScopeOn] = useState<LunaConnectorsState>(EMPTY_CONNECTORS);
  const [attachments, setAttachments] = useState<LunaAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [manualActive, setManualActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch("/api/luna/prompts?active=true&level=L2", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const json = (await res.json()) as { prompts?: LunaPromptRow[] };
      setPrompts(json.prompts ?? []);
    })();
  }, []);

  const l2Active = prompts.filter((p) => p.level === "L2" && p.is_active === true);
  const perspectiveSkills = l2Active.filter((p) => p.kind === "perspective");
  const roleSkills = l2Active.filter((p) => p.kind === "role");
  const taskSkills = l2Active.filter((p) => p.kind === "task");

  useEffect(() => {
    if (!focusTick) return;
    textareaRef.current?.focus();
  }, [focusTick]);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches;
    const minH = isMobile ? 44 : 36;
    const max = isMobile ? 13.5 * 1.65 * 5 : 14 * 1.55 * 5;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(minH, el.scrollHeight), max)}px`;
  }

  useEffect(() => {
    resizeTextarea();
  }, []);

  function markManual() {
    setManualActive(true);
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0 || disabled || uploading) return;

    const token = await getAccessToken();
    if (!token) return;

    let convId = conversationId;
    if (!convId) {
      convId = await onEnsureConversation();
      if (!convId) return;
    }

    setUploading(true);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append("file", file);
        form.append("conversation_id", convId);
        const res = await fetch("/api/luna/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form
        });
        if (!res.ok) {
          console.error("[luna] upload", await res.text());
          continue;
        }
        const json = (await res.json()) as LunaAttachmentRef;
        if (json.id && json.file_name) {
          setAttachments((prev) => [
            ...prev,
            {
              id: json.id,
              file_name: json.file_name,
              mime_type: json.mime_type
            }
          ]);
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function buildManualOverrides(): LunaManualOverrides {
    return {
      connectors: { ...scopeOn },
      skills: {
        perspective_ids: perspectiveSkills
          .filter((s) => perspectiveOn[s.id])
          .map((s) => s.id),
        role_ids: roleSkills.filter((s) => roleOn[s.id]).map((s) => s.id),
        task_ids: taskSkills.filter((s) => taskOn[s.id]).map((s) => s.id)
      }
    };
  }

  function submit() {
    const trimmed = value.trim();
    if (disabled || uploading) return;
    if (!trimmed && attachments.length === 0) return;

    const overrides = manualActive
      ? buildManualOverrides()
      : { connectors: EMPTY_CONNECTORS, skills: EMPTY_SKILLS };

    onSend(
      trimmed,
      overrides.connectors,
      attachments.map((a) => a.id),
      attachments,
      overrides.skills
    );
    setValue("");
    setAttachments([]);
    requestAnimationFrame(resizeTextarea);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (disabled || uploading) return;
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    if (e.dataTransfer.files?.length) {
      void uploadFiles(e.dataTransfer.files);
    }
  }

  const chipClass =
    "shrink-0 whitespace-nowrap rounded-[11px] border border-solid px-2 py-0.5 text-[10px] leading-[1.6] max-md:h-[30px] max-md:px-3 max-md:py-1.5 max-md:text-[12px]";

  return (
    <form
      onSubmit={onSubmit}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`bg-transparent px-3 pb-3 pt-2 max-md:px-3 ${dragOver ? "outline outline-1 outline-[#534AB7]" : ""}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
        }}
      />

      <div className="rounded-[22px] border border-[#e7e8ec] bg-white px-[14px] py-3">
        {panelOpen ? (
          <div className="mb-2.5 space-y-2 border-b border-[#eef0f3] pb-2.5">
            <div className="flex flex-wrap gap-1.5">
              {SCOPE_ITEMS.map((item) => {
                const on = scopeOn[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`${chipClass} ${toggleClass(on ? "scope" : "off")}`}
                    onClick={() => {
                      markManual();
                      setScopeOn((prev) => ({
                        ...prev,
                        [item.key]: !prev[item.key]
                      }));
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {perspectiveSkills.map((s) => (
                <button
                  key={`p-${s.id}`}
                  type="button"
                  className={`${chipClass} ${toggleClass(perspectiveOn[s.id] ? "perspective" : "off")}`}
                  onClick={() => {
                    markManual();
                    setPerspectiveOn((prev) => ({ ...prev, [s.id]: !prev[s.id] }));
                  }}
                >
                  {s.title}
                </button>
              ))}
              {roleSkills.map((s) => (
                <button
                  key={`r-${s.id}`}
                  type="button"
                  className={`${chipClass} ${toggleClass(roleOn[s.id] ? "role" : "off")}`}
                  onClick={() => {
                    markManual();
                    setRoleOn((prev) => ({ ...prev, [s.id]: !prev[s.id] }));
                  }}
                >
                  {s.title}
                </button>
              ))}
              {taskSkills.map((s) => (
                <button
                  key={`t-${s.id}`}
                  type="button"
                  className={`${chipClass} ${toggleClass(taskOn[s.id] ? "task" : "off")}`}
                  onClick={() => {
                    markManual();
                    setTaskOn((prev) => ({ ...prev, [s.id]: !prev[s.id] }));
                  }}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            requestAnimationFrame(resizeTextarea);
          }}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled || uploading}
          placeholder="루나에게 물어보기"
          className="mb-2 w-full min-w-0 resize-none overflow-y-auto border-0 bg-transparent p-0 text-[14px] leading-[1.55] text-[#1c1d21] outline-none placeholder:text-[#9aa0a8] disabled:opacity-50 max-md:text-[14px]"
        />

        <div className="flex items-center gap-[9px]">
          <button
            type="button"
            aria-label="파일 첨부"
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex shrink-0 items-center justify-center text-[#6b6f76] disabled:opacity-40"
          >
            <Plus className="h-[17px] w-[17px]" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="링크 첨부"
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex shrink-0 items-center justify-center text-[#6b6f76] disabled:opacity-40"
          >
            <Link2 className="h-[15px] w-[15px]" strokeWidth={1.75} aria-hidden />
          </button>

          <span className="ml-auto" />

          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="shrink-0 text-[11.5px] text-[#9aa0a8] hover:text-[#6b6f76]"
          >
            직접 지정
          </button>

          <button
            type="button"
            aria-label="음성 입력"
            className="flex shrink-0 items-center justify-center text-[#6b6f76]"
          >
            <Mic className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>

          <button
            type="submit"
            disabled={disabled || uploading || (!value.trim() && attachments.length === 0)}
            aria-label="전송"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-white disabled:opacity-40 max-md:h-[34px] max-md:w-[34px]"
          >
            <ArrowUp className="h-[15px] w-[15px] max-md:h-4 max-md:w-4" strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {attachments.length > 0 || uploading ? (
        <div className="mt-1.5 flex flex-wrap gap-1 px-1">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex max-w-[200px] items-center gap-1 rounded-[11px] border border-[#D3D1C7] px-2 py-0.5 text-[10px] text-[#6B6A64]"
            >
              <Paperclip className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="truncate">{att.file_name}</span>
              <button
                type="button"
                aria-label={`${att.file_name} 제거`}
                className="text-[#6B6A64]"
                onClick={() =>
                  setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                }
              >
                ✕
              </button>
            </span>
          ))}
          {uploading ? (
            <span className="text-[10px] text-[#6B6A64]">업로드 중…</span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
