"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Folder,
  FolderTree,
  GraduationCap,
  Lightbulb,
  MessageSquare,
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

type LunaSidebarProps = {
  conversations: LunaConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  className?: string;
};

const navItemClass =
  "flex w-full items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[13px] text-slate-800 transition hover:bg-slate-50";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaSidebar({
  conversations,
  selectedId,
  onSelect,
  onNewChat,
  selectedProjectId,
  onSelectProject,
  className = ""
}: LunaSidebarProps) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [projects, setProjects] = useState<LunaProject[]>([]);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [skillsCount, setSkillsCount] = useState(0);
  const [learningsCount, setLearningsCount] = useState(0);

  useEffect(() => {
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;

      const [projectsRes, promptsRes] = await Promise.all([
        fetch("/api/luna/projects", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/luna/prompts?active=true&level=L2", {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (projectsRes.ok) {
        const json = (await projectsRes.json()) as { projects?: LunaProject[] };
        setProjects(json.projects ?? []);
      }
      if (promptsRes.ok) {
        const json = (await promptsRes.json()) as { prompts?: unknown[] };
        setSkillsCount(json.prompts?.length ?? 0);
      }

      const { count } = await supabase
        .from("luna_learnings")
        .select("id", { count: "exact", head: true })
        .neq("category", "identity");
      setLearningsCount(count ?? 0);
    })();
  }, []);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const recentItems = showAllRecent
    ? filteredConversations
    : filteredConversations.slice(0, 10);

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
      setProjectsOpen(true);
      onSelectProject(json.project.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside
      className={`flex h-full w-full flex-col gap-0.5 rounded-xl border-[0.5px] border-slate-200 bg-white px-2 py-2.5 md:w-[250px] md:shrink-0 ${className}`}
    >
      <div className="flex items-center gap-2.5 px-2 pb-2.5 pt-1">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-[11px] font-semibold text-white">
          L
        </div>
        <span className="text-sm font-medium text-slate-900">LUNA</span>
      </div>

      {searchOpen ? (
        <div className="px-1 pb-1">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="대화 검색"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              className="text-[11px] text-slate-400 hover:text-slate-600"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery("");
              }}
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onNewChat}
        className={`${navItemClass} font-medium text-[#534AB7] hover:bg-[#EEEDFE]/50`}
      >
        <SquarePen className="h-4 w-[17px] shrink-0 text-[#534AB7]" strokeWidth={1.75} />
        새 대화
      </button>

      <button
        type="button"
        onClick={() => setSearchOpen((v) => !v)}
        className={navItemClass}
      >
        <Search className="h-4 w-[17px] shrink-0 text-slate-500" strokeWidth={1.75} />
        대화 검색
      </button>

      <div className="mx-1 my-2 h-px bg-slate-200" />

      <button
        type="button"
        onClick={() => setProjectsOpen((v) => !v)}
        className={navItemClass}
      >
        <FolderTree className="h-4 w-[17px] shrink-0 text-slate-500" strokeWidth={1.75} />
        <span className="flex-1">프로젝트</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${
            projectsOpen ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {projectsOpen ? (
        <div className="flex flex-col gap-0.5">
          {projects.map((p) => {
            const active = selectedProjectId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectProject(active ? null : p.id)}
                className={`flex w-full items-center gap-2 rounded-lg py-1.5 pl-[26px] pr-[9px] text-left text-[12.5px] transition ${
                  active
                    ? "bg-[#EEEDFE] font-medium text-[#3C3489]"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{p.name}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg py-1.5 pl-[26px] pr-[9px] text-left text-[12.5px] text-slate-600 transition hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            프로젝트 만들기
          </button>
        </div>
      ) : null}

      <div className="mx-1 my-2 h-px bg-slate-200" />

      <button
        type="button"
        onClick={() => router.push("/luna/learn")}
        className={navItemClass}
      >
        <GraduationCap className="h-4 w-[17px] shrink-0 text-slate-500" strokeWidth={1.75} />
        <span className="flex-1">학습</span>
        <span className="text-[11px] text-slate-400">{learningsCount}</span>
      </button>

      <button
        type="button"
        onClick={() => router.push("/settings")}
        className={navItemClass}
      >
        <Lightbulb className="h-4 w-[17px] shrink-0 text-slate-500" strokeWidth={1.75} />
        <span className="flex-1">스킬</span>
        <span className="text-[11px] text-slate-400">{skillsCount}</span>
      </button>

      <div className="px-[9px] pb-1 pt-3 text-[11px] font-medium text-slate-400">
        최근 항목
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {recentItems.length === 0 ? (
          <p className="px-[9px] py-4 text-center text-[12px] text-slate-400">대화가 없습니다</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {recentItems.map((c) => {
              const selected = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    title={c.title}
                    className={`flex w-full items-center gap-2 rounded-lg px-[9px] py-1.5 text-left text-[12.5px] transition ${
                      selected
                        ? "bg-[#EEEDFE] font-medium text-[#3C3489]"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <MessageSquare
                      className="h-3.5 w-3.5 shrink-0 opacity-70"
                      strokeWidth={1.75}
                    />
                    <span className="truncate">{c.title || "새 대화"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!showAllRecent && filteredConversations.length > 10 ? (
          <button
            type="button"
            onClick={() => setShowAllRecent(true)}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-[9px] py-1.5 text-left text-[12.5px] text-slate-400 transition hover:bg-slate-50"
          >
            <MoreHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            전체 보기
          </button>
        ) : null}
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
