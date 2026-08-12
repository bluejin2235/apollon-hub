"use client";

import {
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
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
  /** 값 변경 시 textarea 포커스 (기타 선택 등) */
  focusTick?: number;
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
  onConnectorsChange,
  focusTick = 0
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
  const [showChipLeft, setShowChipLeft] = useState(false);
  const [showChipRight, setShowChipRight] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chipScrollRef = useRef<HTMLDivElement>(null);

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
  const taskCount = taskSkills.filter((s) => taskOn[s.id]).length;
  const scopeOnCount = SCOPE_ITEMS.filter(
    (item) => !item.disabled && scopeOnEffective[item.key]
  ).length;
  const enabledChipCount =
    scopeOnCount + perspectiveCount + roleCount + taskCount;
  const analysisBranchCount = perspectiveCount + roleCount;
  const prevEnabledChipCount = useRef(0);

  const updateChipScrollState = useCallback(() => {
    const el = chipScrollRef.current;
    if (!el) {
      setShowChipLeft(false);
      setShowChipRight(false);
      return;
    }
    const { scrollLeft, clientWidth, scrollWidth } = el;
    setShowChipLeft(scrollLeft > 4);
    setShowChipRight(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  const scrollChipsToStart = useCallback(() => {
    const el = chipScrollRef.current;
    if (el) el.scrollLeft = 0;
    requestAnimationFrame(updateChipScrollState);
  }, [updateChipScrollState]);

  const scrollChipsBy = useCallback(
    (delta: number) => {
      const el = chipScrollRef.current;
      if (!el) return;
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const next = Math.max(0, Math.min(maxScroll, el.scrollLeft + delta));
      el.scrollTo({ left: next, behavior: "smooth" });
      // smooth 스크롤 중·종료 후 화살표 표시 갱신
      requestAnimationFrame(updateChipScrollState);
      window.setTimeout(updateChipScrollState, 220);
    },
    [updateChipScrollState]
  );

  useEffect(() => {
    if (enabledChipCount > prevEnabledChipCount.current) {
      scrollChipsToStart();
    } else {
      updateChipScrollState();
    }
    prevEnabledChipCount.current = enabledChipCount;
  }, [enabledChipCount, scrollChipsToStart, updateChipScrollState]);

  useEffect(() => {
    if (!focusTick) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
  }, [focusTick]);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches;
    const minH = isMobile ? 44 : 36;
    const max = isMobile ? 13.5 * 1.65 * 5 : 12 * 1.5 * 5;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(minH, el.scrollHeight), max)}px`;
  }

  useEffect(() => {
    resizeTextarea();
  }, []);

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
    "chip-sm shrink-0 whitespace-nowrap rounded-[11px] border border-solid px-2 py-0.5 text-[10px] leading-[1.6] max-md:h-[30px] max-md:px-3 max-md:py-1.5 max-md:text-[12px] max-md:leading-none";

  const chipNodes = useMemo(() => {
    const nodes: ReactNode[] = [];
    const onScopes = SCOPE_ITEMS.filter((item) =>
      item.disabled ? false : scopeOnEffective[item.key]
    );
    const offScopes = SCOPE_ITEMS.filter((item) =>
      item.disabled ? true : !scopeOnEffective[item.key]
    );
    const onPerspectives = perspectiveSkills.filter((s) => perspectiveOn[s.id]);
    const offPerspectives = perspectiveSkills.filter((s) => !perspectiveOn[s.id]);
    const onRoles = roleSkills.filter((s) => roleOn[s.id]);
    const offRoles = roleSkills.filter((s) => !roleOn[s.id]);
    const onTasks = taskSkills.filter((s) => taskOn[s.id]);
    const offTasks = taskSkills.filter((s) => !taskOn[s.id]);

    for (const item of onScopes) {
      nodes.push(
        <button
          key={`scope-on-${item.key}`}
          type="button"
          className={`${baseToggle} ${toggleClass("scope")}`}
          onClick={() => {
            setScopeKey(item.key, false);
          }}
        >
          {item.label}
        </button>
      );
    }

    for (const s of onPerspectives) {
      nodes.push(
        <button
          key={`p-on-${s.id}`}
          type="button"
          className={`${baseToggle} ${toggleClass("perspective")}`}
          onClick={() => {
            setPerspectiveOn((prev) => ({ ...prev, [s.id]: false }));
          }}
        >
          {s.title}
        </button>
      );
    }
    for (const s of onRoles) {
      nodes.push(
        <button
          key={`r-on-${s.id}`}
          type="button"
          className={`${baseToggle} ${toggleClass("role")}`}
          onClick={() => {
            setRoleOn((prev) => ({ ...prev, [s.id]: false }));
          }}
        >
          {s.title}
        </button>
      );
    }
    for (const s of onTasks) {
      nodes.push(
        <button
          key={`t-on-${s.id}`}
          type="button"
          className={`${baseToggle} ${toggleClass("task")}`}
          onClick={() => {
            setTaskOn((prev) => ({ ...prev, [s.id]: false }));
          }}
        >
          {s.title}
        </button>
      );
    }

    const hasOn =
      onScopes.length + onPerspectives.length + onRoles.length + onTasks.length > 0;
    const hasOff =
      offScopes.length +
        offPerspectives.length +
        offRoles.length +
        offTasks.length >
      0;
    if (hasOn && hasOff) {
      nodes.push(
        <span
          key="chip-divider"
          className="mx-[3px] h-[13px] w-px shrink-0 bg-[#D3D1C7]"
          aria-hidden
        />
      );
    }

    for (const s of offPerspectives) {
      nodes.push(
        <button
          key={`p-off-${s.id}`}
          type="button"
          className={`${baseToggle} ${toggleClass("off")}`}
          onClick={() => {
            setPerspectiveOn((prev) => ({ ...prev, [s.id]: true }));
          }}
        >
          {s.title}
        </button>
      );
    }
    for (const s of offRoles) {
      nodes.push(
        <button
          key={`r-off-${s.id}`}
          type="button"
          className={`${baseToggle} ${toggleClass("off")}`}
          onClick={() => {
            setRoleOn((prev) => ({ ...prev, [s.id]: true }));
          }}
        >
          {s.title}
        </button>
      );
    }
    for (const s of offTasks) {
      nodes.push(
        <button
          key={`t-off-${s.id}`}
          type="button"
          className={`${baseToggle} ${toggleClass("off")}`}
          onClick={() => {
            setTaskOn((prev) => ({ ...prev, [s.id]: true }));
          }}
        >
          {s.title}
        </button>
      );
    }
    for (const item of offScopes) {
      if (item.disabled) {
        nodes.push(
          <button
            key={`scope-off-${item.key}`}
            type="button"
            disabled
            className={`${baseToggle} ${toggleClass("disabled")}`}
          >
            {item.label}
          </button>
        );
        continue;
      }
      nodes.push(
        <button
          key={`scope-off-${item.key}`}
          type="button"
          className={`${baseToggle} ${toggleClass("off")}`}
          onClick={() => {
            setScopeKey(item.key, true);
          }}
        >
          {item.label}
        </button>
      );
    }

    return nodes;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chip order follows toggle state snapshots
  }, [
    perspectiveSkills,
    roleSkills,
    taskSkills,
    perspectiveOn,
    roleOn,
    taskOn,
    scopeOnEffective.notion,
    scopeOnEffective.nas,
    scopeOnEffective.web,
    scopeOn.youtube,
    scrollChipsToStart
  ]);

  const hasChips = chipNodes.length > 0;

  useEffect(() => {
    const el = chipScrollRef.current;
    if (!el) return;
    updateChipScrollState();
    const ro = new ResizeObserver(() => updateChipScrollState());
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateChipScrollState, chipNodes.length, enabledChipCount]);

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

      {/* 1단 토글 줄 — 화살표는 스크롤 영역 밖(형제)에 두어 칩 클릭과 겹치지 않게 함 */}
      {hasChips ? (
        <div className="relative flex items-stretch pt-1.5">
          <button
            type="button"
            aria-label="칩 왼쪽으로"
            tabIndex={showChipLeft ? 0 : -1}
            aria-hidden={!showChipLeft}
            disabled={!showChipLeft}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              scrollChipsBy(-120);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="relative z-10 flex w-8 shrink-0 cursor-pointer items-center justify-center disabled:pointer-events-none disabled:opacity-0"
            style={{
              background:
                "linear-gradient(to left, rgba(255,255,255,0), #fff 70%)",
              pointerEvents: showChipLeft ? "auto" : "none"
            }}
          >
            <ChevronLeft className="h-3.5 w-3.5 text-[#6B6A64]" strokeWidth={2} aria-hidden />
          </button>
          <div
            ref={chipScrollRef}
            className="hscroll luna-input-chips min-w-0 flex-1 items-center"
            onScroll={updateChipScrollState}
          >
            {chipNodes}
          </div>
          <button
            type="button"
            aria-label="칩 오른쪽으로"
            tabIndex={showChipRight ? 0 : -1}
            aria-hidden={!showChipRight}
            disabled={!showChipRight}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              scrollChipsBy(120);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="relative z-10 flex w-8 shrink-0 cursor-pointer items-center justify-center disabled:pointer-events-none disabled:opacity-0"
            style={{
              background:
                "linear-gradient(to right, rgba(255,255,255,0), #fff 70%)",
              pointerEvents: showChipRight ? "auto" : "none"
            }}
          >
            <ChevronRight className="h-3.5 w-3.5 text-[#6B6A64]" strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}

      {/* 2단 입력 줄 */}
      <div className="flex items-center gap-[7px] px-2.5 pb-[9px] pt-[7px] max-md:gap-2 max-md:px-3 max-md:pb-2.5 max-md:pt-2">
        <button
          type="button"
          aria-label="파일 첨부"
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
          className="chip-sm flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-solid border-[#E4E2DA] text-[#6B6A64] disabled:opacity-40 max-md:h-11 max-md:w-9 max-md:rounded-[11px]"
        >
          <Paperclip className="h-[13px] w-[13px] max-md:h-4 max-md:w-4" strokeWidth={1.75} aria-hidden />
        </button>

        <div className="flex min-h-0 min-w-0 flex-1 items-center max-md:rounded-[22px] max-md:border max-md:border-[#E4E2DA] max-md:bg-[#F7F7F5]">
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
            className="max-h-[90px] min-h-[44px] w-full min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-[15px] py-3 text-[13.5px] leading-snug text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-50 md:min-h-[36px] md:px-0 md:py-0 md:text-[12px] md:leading-normal"
          />
        </div>

        <button
          type="submit"
          disabled={disabled || uploading || (!value.trim() && attachments.length === 0)}
          aria-label="전송"
          className="chip-sm flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#534AB7] text-white disabled:opacity-40 max-md:h-11 max-md:w-11 max-md:rounded-full"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current max-md:h-4 max-md:w-4" aria-hidden>
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
