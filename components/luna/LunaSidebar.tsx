"use client";

import {
  KeyboardEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Folder,
  MoreHorizontal,
  Plus,
  Search,
  SquarePen
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export type LunaConversation = {
  id: string;
  title: string;
  engine: string;
  project_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type LunaProject = {
  id: string;
  name: string;
  description: string | null;
  project_code: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 대화 목록·선택은 /luna 페이지가 넘겨준다.
 * /glossary 처럼 대화 상태가 없는 화면에서는 생략하면 스스로 불러오고,
 * 항목을 누르면 /luna 로 옮겨간다.
 */
type LunaSidebarProps = {
  conversations?: LunaConversation[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onNewChat?: () => void;
  selectedProjectId?: string | null;
  onSelectProject?: (id: string | null) => void;
  onRename?: (id: string, title: string) => void | Promise<void>;
  onDelete?: (id: string) => void | Promise<void>;
  className?: string;
};

const RECENT_LIMIT = 8;

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaSidebar({
  conversations: conversationsProp,
  selectedId = null,
  onSelect,
  onNewChat,
  selectedProjectId = null,
  onSelectProject,
  onRename,
  onDelete,
  className = ""
}: LunaSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const glossaryActive =
    pathname === "/glossary" || (pathname?.startsWith("/glossary/") ?? false);
  const managed = conversationsProp !== undefined;

  const [ownConversations, setOwnConversations] = useState<LunaConversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [projects, setProjects] = useState<LunaProject[]>([]);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [termCandidates, setTermCandidates] = useState(0);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const skipRenameCommitRef = useRef(false);

  const conversations = conversationsProp ?? ownConversations;

  useEffect(() => {
    if (!menuId) return;
    function onDocClick(e: Event) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenuId(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuId]);

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  useEffect(() => {
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };

      const [projectsRes, glossaryRes] = await Promise.all([
        fetch("/api/luna/projects", { headers }),
        fetch("/api/glossary", { headers })
      ]);

      if (projectsRes.ok) {
        const json = (await projectsRes.json()) as { projects?: LunaProject[] };
        setProjects(json.projects ?? []);
      }
      if (glossaryRes.ok) {
        const json = (await glossaryRes.json()) as { pending_candidates?: number };
        setTermCandidates(json.pending_candidates ?? 0);
      }

      if (!managed) {
        const res = await fetch("/api/luna/conversations", { headers });
        if (res.ok) {
          const json = (await res.json()) as { conversations?: LunaConversation[] };
          setOwnConversations(json.conversations ?? []);
        }
      }
    })();
  }, [managed]);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = selectedProjectId
      ? conversations.filter((c) => c.project_id === selectedProjectId)
      : conversations;
    if (!q) return base;
    return base.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [conversations, searchQuery, selectedProjectId]);

  const recentItems = showAllRecent
    ? filteredConversations
    : filteredConversations.slice(0, RECENT_LIMIT);

  const selectConversation = useCallback(
    (id: string) => {
      if (onSelect) onSelect(id);
      else router.push(`/luna?c=${id}`);
    },
    [onSelect, router]
  );

  const startNewChat = useCallback(() => {
    if (onNewChat) onNewChat();
    else router.push("/luna");
  }, [onNewChat, router]);

  const selectProject = useCallback(
    (id: string | null) => {
      if (onSelectProject) onSelectProject(id);
      else router.push(id ? `/luna?project=${id}` : "/luna");
    },
    [onSelectProject, router]
  );

  async function createProject() {
    const name = newProjectName.trim();
    if (!name || creating) return;
    const token = await getAccessToken();
    if (!token) return;
    setCreating(true);
    try {
      const res = await fetch("/api/luna/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
      });
      if (!res.ok) {
        console.error("[luna] create project", await res.text());
        return;
      }
      const json = (await res.json()) as { project: LunaProject };
      setProjects((prev) => [json.project, ...prev]);
      setNewProjectName("");
      setCreateOpen(false);
      selectProject(json.project.id);
    } finally {
      setCreating(false);
    }
  }

  function startRename(c: LunaConversation) {
    setMenuId(null);
    skipRenameCommitRef.current = false;
    setEditingId(c.id);
    setEditTitle(c.title || "새 대화");
  }

  async function commitRename() {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false;
      return;
    }
    if (!editingId) return;
    const id = editingId;
    const next = editTitle.trim();
    setEditingId(null);
    if (!next) return;
    const prev = conversations.find((c) => c.id === id)?.title;
    if (prev === next) return;
    await onRename?.(id, next);
  }

  function cancelRename() {
    skipRenameCommitRef.current = true;
    setEditingId(null);
    setEditTitle("");
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  function confirmDelete(c: LunaConversation) {
    setMenuId(null);
    if (!window.confirm("이 대화를 삭제할까요?")) return;
    void onDelete?.(c.id);
  }

  function openMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setMenuId((prev) => (prev === id ? null : id));
  }

  return (
    <aside
      className={`flex h-full w-full flex-col rounded-xl border-[0.5px] border-slate-200 bg-white px-2.5 py-3 md:w-[250px] md:shrink-0 ${className}`}
    >
      <div className="flex items-center gap-2 px-1.5 pb-3 pt-0.5">
        <button
          type="button"
          onClick={() => router.push("/luna")}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[13px] font-extrabold"
            style={{ background: "#534AB7", color: "#EEEDFE" }}
          >
            L
          </span>
          <b className="truncate text-[14.5px] font-bold text-slate-900">루나</b>
        </button>
        <button
          type="button"
          onClick={startNewChat}
          title="새 대화"
          aria-label="새 대화"
          className="shrink-0 rounded-md p-1 text-[#534AB7] transition hover:bg-[#EEEDFE]"
        >
          <SquarePen className="h-[17px] w-[17px]" strokeWidth={1.75} />
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-[9px] bg-[#f1f2f5] px-2.5 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="대화 검색"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-800 outline-none placeholder:text-slate-400"
        />
      </div>

      <div className="px-1.5 pb-1 text-[11px] text-slate-400">프로젝트</div>
      <div className="flex flex-col gap-0.5">
        {projects.map((p) => {
          const active = selectedProjectId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectProject(active ? null : p.id)}
              className={`flex w-full items-center gap-[9px] rounded-[9px] px-2 py-[7px] text-left text-[13px] transition ${
                active
                  ? "bg-[#EEEDFE] font-medium text-[#3C3489]"
                  : "text-slate-800 hover:bg-slate-50"
              }`}
            >
              <Folder className="h-4 w-4 shrink-0 opacity-75" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex w-full items-center gap-[9px] rounded-[9px] px-2 py-[7px] text-left text-[13px] text-slate-500 transition hover:bg-slate-50"
        >
          <Plus className="h-4 w-4 shrink-0 opacity-75" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">프로젝트 만들기</span>
        </button>
      </div>

      <div className="px-1.5 pb-1 pt-3 text-[11px] text-slate-400">최근 대화</div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {recentItems.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-slate-400">대화가 없습니다</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {recentItems.map((c) => {
              const selected = c.id === selectedId;
              const editing = editingId === c.id;
              const menuOpen = menuId === c.id;

              if (editing) {
                return (
                  <li key={c.id} className="px-0.5">
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={onEditKeyDown}
                      onBlur={() => void commitRename()}
                      className="w-full rounded-lg border border-[#534AB7] bg-white px-2 py-1.5 text-[12.5px] text-slate-800 outline-none"
                    />
                  </li>
                );
              }

              return (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => selectConversation(c.id)}
                    title={c.title}
                    className={`block w-full truncate rounded-lg px-2 py-1.5 pr-8 text-left text-[12.5px] transition ${
                      selected
                        ? "bg-[#EEEDFE] text-[#3C3489]"
                        : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {c.title || "새 대화"}
                  </button>
                  {onRename || onDelete ? (
                    <>
                      <button
                        type="button"
                        aria-label="대화 메뉴"
                        onClick={(e) => openMenu(e, c.id)}
                        className={`absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200/80 hover:text-slate-700 ${
                          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <MoreHorizontal size={14} strokeWidth={1.75} />
                      </button>
                      {menuOpen ? (
                        <div
                          ref={menuRef}
                          className="absolute right-1 top-full z-20 mt-0.5 min-w-[110px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-md"
                        >
                          {onRename ? (
                            <button
                              type="button"
                              onClick={() => startRename(c)}
                              className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50"
                            >
                              이름 변경
                            </button>
                          ) : null}
                          {onDelete ? (
                            <button
                              type="button"
                              onClick={() => confirmDelete(c)}
                              className="block w-full px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50"
                            >
                              삭제
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {!showAllRecent && filteredConversations.length > RECENT_LIMIT ? (
          <button
            type="button"
            onClick={() => setShowAllRecent(true)}
            className="mt-0.5 block w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] text-slate-400 transition hover:bg-slate-50"
          >
            더 보기
          </button>
        ) : null}
      </div>

      <div className="mt-4 border-t border-[#eef0f3] pt-2">
        <button
          type="button"
          onClick={() => router.push("/glossary")}
          className={`flex w-full items-center gap-[9px] rounded-[9px] px-2 py-[7px] text-left text-[13px] transition ${
            glossaryActive
              ? "bg-[#EEEDFE] font-bold text-[#3C3489]"
              : "text-slate-800 hover:bg-slate-50"
          }`}
        >
          <BookOpen className="h-4 w-4 shrink-0 opacity-75" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">용어사전</span>
          {termCandidates > 0 ? (
            <span
              className="shrink-0 rounded-[20px] px-[7px] py-px text-[10px] font-extrabold"
              style={{ background: "#FAECE7", color: "#993C1D" }}
            >
              {termCandidates}
            </span>
          ) : null}
        </button>
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-900">프로젝트 만들기</h2>
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createProject();
              }}
              placeholder="프로젝트 이름"
              autoFocus
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#534AB7]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  setNewProjectName("");
                }}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={creating || !newProjectName.trim()}
                onClick={() => void createProject()}
                className="rounded-lg bg-[#534AB7] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3C3489] disabled:opacity-40"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
