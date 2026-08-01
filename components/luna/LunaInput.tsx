"use client";

import {
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { Paperclip } from "lucide-react";
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

type ScopeKey = "notion" | "nas" | "web" | "youtube";

const SCOPE_ITEMS: {
  key: ScopeKey;
  label: string;
  defaultOn: boolean;
  disabled: boolean;
}[] = [
  { key: "notion", label: "노션", defaultOn: true, disabled: false },
  { key: "nas", label: "Work서버", defaultOn: true, disabled: false },
  { key: "web", label: "웹", defaultOn: true, disabled: false },
  { key: "youtube", label: "YouTube", defaultOn: false, disabled: true }
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
  connectors?: LunaConnectorsState;
  onConnectorsChange?: (next: LunaConnectorsState) => void;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function toggleClass(
  kind: "off" | "perspective" | "role" | "task" | "scope" | "disabled"
): string {
  if (kind === "disabled") {
    return "cursor-not-allowed border-[#D3D1C7] bg-transparent text-[#6B6A64] opacity-40";
  }
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
  connectors: connectorsProp,
  onConnectorsChange
}: LunaInputProps) {
  const [value, setValue] = useState("");
  const [prompts, setPrompts] = useState<LunaPromptRow[]>([]);
  const [perspectiveOn, setPerspectiveOn] = useState<Record<string, boolean>>({});
  const [roleOn, setRoleOn] = useState<Record<string, boolean>>({});
  const [taskOn, setTaskOn] = useState<Record<string, boolean>>({});
  const [scopeOn, setScopeOn] = useState<Record<ScopeKey, boolean>>({
    notion: true,
    nas: true,
    web: true,
    youtube: false
  });
  const [attachments, setAttachments] = useState<LunaAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scopeOnEffective: Record<ScopeKey, boolean> = {
    notion: connectorsProp?.notion ?? scopeOn.notion,
    nas: connectorsProp?.nas ?? scopeOn.nas,
    web: connectorsProp?.web ?? scopeOn.web,
    youtube: scopeOn.youtube
  };

  function setScopeKey(key: ScopeKey, next: boolean) {
    if (key === "youtube") {
      setScopeOn((prev) => ({ ...prev, youtube: next }));
      return;
    }
    if (connectorsProp && onConnectorsChange) {
      onConnectorsChange({
        notion: key === "notion" ? next : connectorsProp.notion,
        nas: key === "nas" ? next : connectorsProp.nas,
        web: key === "web" ? next : connectorsProp.web
      });
      return;
    }
    setScopeOn((prev) => ({ ...prev, [key]: next }));
  }

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
  const perspectiveCount = perspectiveSkills.filter((s) => perspectiveOn[s.id]).length;
  const roleCount = roleSkills.filter((s) => roleOn[s.id]).length;
  const analysisBranchCount = perspectiveCount + roleCount;

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 12 * 1.5 * 5; // 5 lines at 12px / 1.5
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
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

  function submit() {
    const trimmed = value.trim();
    if (disabled || uploading) return;
    if (!trimmed && attachments.length === 0) return;

    const connectors: LunaConnectorsState = {
      notion: scopeOnEffective.notion,
      web: scopeOnEffective.web,
      nas: scopeOnEffective.nas
    };
    const skillsPayload: LunaSkillsSelection = {
      perspective_ids: perspectiveSkills
        .filter((s) => perspectiveOn[s.id])
        .map((s) => s.id),
      role_ids: roleSkills.filter((s) => roleOn[s.id]).map((s) => s.id),
      task_ids: taskSkills.filter((s) => taskOn[s.id]).map((s) => s.id)
    };

    onSend(
      trimmed,
      connectors,
      attachments.map((a) => a.id),
      attachments,
      skillsPayload
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

  const baseToggle =
    "shrink-0 whitespace-nowrap rounded-[11px] border border-solid px-2 py-0.5 text-[10px] leading-[1.6]";

  return (
    <form
      onSubmit={onSubmit}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-t border-[#E4E2DA] bg-white ${dragOver ? "outline outline-1 outline-[#534AB7]" : ""}`}
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

      {/* 1단 토글 줄 */}
      <div
        className="flex items-center gap-1 overflow-x-auto px-2.5 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {perspectiveSkills.map((s) => {
          const on = Boolean(perspectiveOn[s.id]);
          return (
            <button
              key={s.id}
              type="button"
              className={`${baseToggle} ${toggleClass(on ? "perspective" : "off")}`}
              onClick={() =>
                setPerspectiveOn((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
              }
            >
              {s.title}
            </button>
          );
        })}

        {perspectiveSkills.length > 0 && roleSkills.length > 0 ? (
          <span className="mx-[3px] h-[13px] w-px shrink-0 bg-[#D3D1C7]" aria-hidden />
        ) : null}

        {roleSkills.map((s) => {
          const on = Boolean(roleOn[s.id]);
          return (
            <button
              key={s.id}
              type="button"
              className={`${baseToggle} ${toggleClass(on ? "role" : "off")}`}
              onClick={() =>
                setRoleOn((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
              }
            >
              {s.title}
            </button>
          );
        })}

        {(perspectiveSkills.length > 0 || roleSkills.length > 0) &&
        taskSkills.length > 0 ? (
          <span className="mx-[3px] h-[13px] w-px shrink-0 bg-[#D3D1C7]" aria-hidden />
        ) : null}

        {taskSkills.map((s) => {
          const on = Boolean(taskOn[s.id]);
          return (
            <button
              key={s.id}
              type="button"
              className={`${baseToggle} ${toggleClass(on ? "task" : "off")}`}
              onClick={() => setTaskOn((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
            >
              {s.title}
            </button>
          );
        })}

        {perspectiveSkills.length > 0 ||
        roleSkills.length > 0 ||
        taskSkills.length > 0 ? (
          <span className="mx-[3px] h-[13px] w-px shrink-0 bg-[#D3D1C7]" aria-hidden />
        ) : null}

        {SCOPE_ITEMS.map((item) => {
          if (item.disabled) {
            return (
              <button
                key={item.key}
                type="button"
                disabled
                className={`${baseToggle} ${toggleClass("disabled")}`}
              >
                {item.label}
              </button>
            );
          }
          const on = scopeOnEffective[item.key];
          return (
            <button
              key={item.key}
              type="button"
              className={`${baseToggle} ${toggleClass(on ? "scope" : "off")}`}
              onClick={() => setScopeKey(item.key, !on)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* 2단 입력 줄 */}
      <div className="flex items-center gap-[7px] px-2.5 pb-[9px] pt-[7px]">
        <button
          type="button"
          aria-label="파일 첨부"
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-solid border-[#E4E2DA] text-[#6B6A64] disabled:opacity-40"
        >
          <Paperclip className="h-[13px] w-[13px]" strokeWidth={1.75} aria-hidden />
        </button>

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
          placeholder="LUNA에게 메시지 보내기"
          className="max-h-[90px] min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent text-[12px] text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={disabled || uploading || (!value.trim() && attachments.length === 0)}
          aria-label="전송"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#534AB7] text-white disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current" aria-hidden>
            <path d="M12 4l-7 7h4v9h6v-9h4l-7-7z" />
          </svg>
        </button>
      </div>

      {attachments.length > 0 || uploading ? (
        <div className="flex flex-wrap gap-1 px-2.5 pb-2">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex max-w-[200px] items-center gap-1 rounded-[11px] border border-[#D3D1C7] px-2 py-0.5 text-[10px] text-[#6B6A64]"
            >
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

      {/* 3단 분석 전환 배너 */}
      {analysisBranchCount >= 2 ? (
        <div className="flex items-center gap-1.5 border-t border-[#BA7517] bg-[#FAEEDA] px-2.5 py-[5px] text-[10px] text-[#412402]">
          <span aria-hidden>◆</span>
          <span>
            {(() => {
              const parts: string[] = [];
              if (perspectiveCount > 0) parts.push(`관점 ${perspectiveCount}개`);
              if (roleCount > 0) parts.push(`역할 ${roleCount}개`);
              return `${parts.join(" · ")} · 팀별로 나눠 분석하고 정리해서 리포트로 드릴게요. 약 ${
                analysisBranchCount * 40 + 30
              }초 걸려요.`;
            })()}
            {analysisBranchCount > 5 ? " 상위 5개만 분석합니다." : ""}
          </span>
        </div>
      ) : null}
    </form>
  );
}
