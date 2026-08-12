"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LunaSettingsHome from "@/components/luna/LunaSettingsHome";
import { LunaKnowledgeTab } from "@/components/settings/luna-knowledge-tab";
import { LunaKnowledgeConflict } from "@/components/luna/knowledge/LunaKnowledgeConflict";
import { LunaKnowledgeGlossary } from "@/components/luna/knowledge/LunaKnowledgeGlossary";
import { LunaKnowledgeNotion } from "@/components/luna/knowledge/LunaKnowledgeNotion";
import { LunaKnowledgeWorkserver } from "@/components/luna/knowledge/LunaKnowledgeWorkserver";
import { LunaTalkHistory } from "@/components/luna/talk/LunaTalkHistory";
import { LunaTalkMetrics } from "@/components/luna/talk/LunaTalkMetrics";
import { LunaBrainEval } from "@/components/luna/brain/LunaBrainEval";
import { LunaBrainModel } from "@/components/luna/brain/LunaBrainModel";
import { LunaBrainPrompts } from "@/components/luna/brain/LunaBrainPrompts";
import { LunaBrainReport } from "@/components/luna/brain/LunaBrainReport";
import { LunaBrainUpgrade } from "@/components/luna/brain/LunaBrainUpgrade";
import { LunaSettingsNav } from "@/components/settings/luna-settings-nav";
import { LunaCandidatesHistory } from "@/components/luna/candidates/LunaCandidatesHistory";
import { LunaCandidatesMine } from "@/components/luna/candidates/LunaCandidatesMine";
import { LunaCandidatesPending } from "@/components/luna/candidates/LunaCandidatesPending";
import { LunaSelfstudyHistory } from "@/components/luna/selfstudy/LunaSelfstudyHistory";
import { LunaSelfstudySettings } from "@/components/luna/selfstudy/LunaSelfstudySettings";
import { LunaSelfstudyStuck } from "@/components/luna/selfstudy/LunaSelfstudyStuck";
import {
  buildLunaSettingsUrl,
  canonicalLunaSettingsUrl,
  defaultSubForMenu,
  legacyFilterToSub,
  resolveLunaRoute,
  subLabel,
  type LunaMenuSlug,
  type LunaSubSlug
} from "@/lib/luna/settings-nav";
import {
  formatPromptNumber,
  isHumanOnlyPromptLevel,
  type LunaPromptGroupRow,
  type LunaPromptKind,
  type LunaPromptRow,
  type LunaPromptVersionRow
} from "@/lib/luna/prompts";
import { supabase } from "@/lib/supabase/client";

type ProfileOption = { id: string; name: string };

function LunaPlaceholder({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
      <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-[13px] text-slate-500">준비 중</p>
    </div>
  );
}

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function HumanOnlyLock() {
  return (
    <span
      title="사람만 수정"
      aria-label="사람만 수정"
      className="inline-flex shrink-0 text-slate-500"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </span>
  );
}

function kindBadge(kind: LunaPromptKind): { label: string; className: string } {
  if (kind === "identity") {
    return { label: "정체성", className: "bg-[#F1EFE8] text-[#5F5E5A]" };
  }
  if (kind === "perspective") {
    return { label: "관점", className: "bg-[#FAEEDA] text-[#412402]" };
  }
  if (kind === "role") {
    return { label: "역할", className: "bg-[#E6F1FB] text-[#0C447C]" };
  }
  if (kind === "task") {
    return { label: "작업", className: "bg-[#EEEDFE] text-[#26215C]" };
  }
  return { label: "판단", className: "bg-[#E1F5EE] text-[#04342C]" };
}

function formatVersionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function EditorLabel({
  name,
  isLuna
}: {
  name: string | null | undefined;
  isLuna: boolean;
}) {
  if (isLuna) {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-gray-500">
        <span className="inline-block h-[5px] w-[5px] rounded-full bg-[#534AB7]" aria-hidden />
        LUNA
      </span>
    );
  }
  return <span className="text-[10.5px] text-gray-500">{name || "-"}</span>;
}

type Draft = {
  title: string;
  description: string;
  purpose: string;
  content: string;
  owner_id: string;
  sort_order: number;
  change_summary: string;
  prediction: string;
};

function toDraft(p: LunaPromptRow): Draft {
  return {
    title: p.title ?? "",
    description: p.description ?? "",
    purpose: p.purpose ?? "",
    content: p.content ?? "",
    owner_id: p.owner_id ?? "",
    sort_order: p.sort_order ?? 0,
    change_summary: "",
    prediction: ""
  };
}

function verifyBadge(result: string | null | undefined): {
  label: string;
  className: string;
} | null {
  if (result === "confirmed") {
    return { label: "확인됨", className: "bg-emerald-100 text-emerald-800" };
  }
  if (result === "refuted") {
    return { label: "효과 없음", className: "bg-red-100 text-red-800" };
  }
  if (result === "inconclusive") {
    return { label: "판단 불가", className: "bg-amber-100 text-amber-900" };
  }
  return { label: "미검증", className: "bg-slate-100 text-slate-600" };
}

function LunaPromptsPanel() {
  const [prompts, setPrompts] = useState<LunaPromptRow[]>([]);
  const [promptGroups, setPromptGroups] = useState<LunaPromptGroupRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const [promptRes, profileRes] = await Promise.all([
      fetch("/api/luna/prompts", { headers: { Authorization: `Bearer ${token}` } }),
      supabase.from("profiles").select("id, name").order("name", { ascending: true })
    ]);

    if (promptRes.ok) {
      const json = (await promptRes.json()) as {
        prompts?: LunaPromptRow[];
        groups?: LunaPromptGroupRow[];
      };
      setPrompts(json.prompts ?? []);
      setPromptGroups(json.groups ?? []);
    } else {
      setMessage(`불러오기 실패: ${await promptRes.text()}`);
    }

    if (!profileRes.error && profileRes.data) {
      setProfiles(
        profileRes.data.map((p) => ({
          id: p.id as string,
          name: (p.name as string) || ""
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredPrompts = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) => {
      const num = formatPromptNumber(p).toLowerCase();
      const title = (p.title ?? "").toLowerCase();
      return num.includes(q) || title.includes(q);
    });
  }, [prompts, filterQuery]);

  const groupedSections = useMemo(() => {
    return promptGroups
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        group: g,
        items: filteredPrompts.filter((p) => p.group_name === g.group_key)
      }))
      .filter((section) => section.items.length > 0);
  }, [promptGroups, filteredPrompts]);

  function openRow(p: LunaPromptRow) {
    if (openId === p.id) {
      setOpenId(null);
      setDraft(null);
      return;
    }
    setOpenId(p.id);
    setDraft(toDraft(p));
  }

  async function toggleActive(p: LunaPromptRow) {
    if (p.kind === "identity") return;
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("/api/luna/prompts", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: p.id, is_active: !p.is_active })
    });
    if (!res.ok) {
      setMessage(`활성 변경 실패: ${await res.text()}`);
      return;
    }
    setPrompts((prev) =>
      prev.map((row) => (row.id === p.id ? { ...row, is_active: !p.is_active } : row))
    );
  }

  async function saveRow(p: LunaPromptRow) {
    if (!draft || !draft.change_summary.trim() || !draft.prediction.trim()) return;
    setSaving(true);
    setMessage("");
    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      return;
    }
    const res = await fetch("/api/luna/prompts", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: p.id,
        title: draft.title,
        description: draft.description,
        purpose: draft.purpose,
        content: draft.content,
        owner_id: draft.owner_id || null,
        sort_order: draft.sort_order,
        change_summary: draft.change_summary.trim(),
        prediction: draft.prediction.trim()
      })
    });
    setSaving(false);
    if (!res.ok) {
      setMessage(`저장 실패: ${await res.text()}`);
      return;
    }
    setMessage("저장했습니다.");
    setOpenId(null);
    setDraft(null);
    await load();
  }

  async function revertTo(p: LunaPromptRow, version: number) {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch("/api/luna/prompts/revert", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: p.id, version })
    });
    if (!res.ok) {
      setMessage(`되돌리기 실패: ${await res.text()}`);
      return;
    }
    setMessage(`v${version}으로 되돌렸습니다.`);
    setOpenId(null);
    setDraft(null);
    await load();
  }

  async function addPrompt(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setMessage("");
    const token = await getAccessToken();
    if (!token) {
      setAdding(false);
      return;
    }
    const res = await fetch("/api/luna/prompts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ level: "L2", kind: "task", title: "새 프롬프트" })
    });
    setAdding(false);
    if (!res.ok) {
      setMessage(`추가 실패: ${await res.text()}`);
      return;
    }
    const json = (await res.json()) as { id?: string };
    await load();
    if (json.id) {
      setOpenId(json.id);
      setDraft({
        title: "새 프롬프트",
        description: "",
        purpose: "",
        content: "",
        owner_id: "",
        sort_order: 0,
        change_summary: "",
        prediction: ""
      });
    }
  }

  function renderRow(p: LunaPromptRow) {
    const badge = kindBadge(p.kind);
    const open = openId === p.id;
    const versions = (p.versions ?? []) as LunaPromptVersionRow[];
    const latestVersion = versions[0] ?? null;
    const latestRefuted =
      Boolean(latestVersion?.prediction) &&
      latestVersion?.verify_result === "refuted";
    const promptNo = formatPromptNumber(p);
    const humanOnly = isHumanOnlyPromptLevel(p.level);

    return (
      <div key={p.id} className="mb-1">
        <button
          type="button"
          onClick={() => openRow(p)}
          className="flex w-full items-center gap-2 rounded-lg border border-solid border-slate-200 px-2.5 py-[9px] text-left"
        >
          <span
            className="shrink-0 font-mono"
            style={{
              fontSize: 10,
              color: "#6B6A64",
              marginRight: 7
            }}
          >
            {promptNo}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-[13px] font-medium text-slate-900">
            {p.title}
            {humanOnly ? <HumanOnlyLock /> : null}
            {latestRefuted ? (
              <span
                className="inline-block h-[5px] w-[5px] shrink-0 rounded-full bg-red-500"
                title="최근 수정이 효과 없음으로 판정됨"
              />
            ) : null}
          </span>
          <span
            className={`shrink-0 rounded px-[7px] py-0.5 text-[9.5px] ${badge.className}`}
          >
            {badge.label}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-gray-500">
            {p.description || ""}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-gray-500">
            v{p.version}
          </span>
          <span className="shrink-0">
            <EditorLabel name={p.last_editor_name} isLuna={Boolean(p.changed_by_luna)} />
          </span>
          {p.kind !== "identity" ? (
            <span
              role="switch"
              aria-checked={p.is_active}
              onClick={(e) => {
                e.stopPropagation();
                void toggleActive(p);
              }}
              className={`shrink-0 cursor-pointer rounded-full border border-solid px-2 py-px text-[9px] ${
                p.is_active
                  ? "border-[#0F6E56] bg-[#E1F5EE] text-[#04342C]"
                  : "border-[#D3D1C7] bg-transparent text-gray-500"
              }`}
            >
              {p.is_active ? "ON" : "OFF"}
            </span>
          ) : null}
          <span className="shrink-0 text-xs text-slate-500">{open ? "⌃" : "⌄"}</span>
        </button>

        {open && draft ? (
          <div className="flex flex-col rounded-b-lg border border-t-0 border-solid border-[#534AB7] sm:flex-row">
            <div className="min-w-0 flex-1 p-3">
              <div
                className="mb-2 font-mono"
                style={{ fontSize: 12, color: "#534AB7" }}
              >
                {promptNo}
              </div>
              <label className="mb-2 block">
                <span className="mb-1 block text-[11px] text-gray-500">제목</span>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                />
              </label>
              <label className="mb-2 block">
                <span className="mb-1 block text-[11px] text-gray-500">설명</span>
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                />
              </label>
              <label className="mb-2 block">
                <span className="mb-1 block text-[11px] text-gray-500">목적</span>
                <textarea
                  rows={2}
                  value={draft.purpose}
                  onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                />
              </label>
              <label className="mb-2 block">
                <span className="mb-1 block text-[11px] text-gray-500">프롬프트</span>
                <textarea
                  rows={12}
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-[12px] leading-relaxed"
                />
              </label>
              <div className="mb-2 flex flex-wrap gap-3">
                <label className="block min-w-0 flex-1 sm:min-w-[180px]">
                  <span className="mb-1 block text-[11px] text-gray-500">담당자</span>
                  <select
                    value={draft.owner_id}
                    onChange={(e) => setDraft({ ...draft, owner_id: e.target.value })}
                    className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                  >
                    <option value="">(없음)</option>
                    {profiles.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name || pr.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-gray-500">정렬 순서</span>
                  <input
                    type="number"
                    value={draft.sort_order}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sort_order: Number(e.target.value) || 0
                      })
                    }
                    className="w-[110px] rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                  />
                </label>
              </div>
              {p.kind === "system" && p.prompt_key ? (
                <div className="mb-3">
                  <span className="mb-1 block text-[11px] text-gray-500">prompt_key</span>
                  <div className="rounded border border-dashed border-slate-300 px-2 py-1.5 font-mono text-[12px] text-slate-600">
                    {p.prompt_key}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                <input
                  value={draft.change_summary}
                  onChange={(e) => setDraft({ ...draft, change_summary: e.target.value })}
                  placeholder="무엇을 왜 바꿨는지 한 줄로"
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                />
                <div className="flex items-center gap-2">
                  <input
                    value={draft.prediction}
                    onChange={(e) => setDraft({ ...draft, prediction: e.target.value })}
                    placeholder="이 수정으로 무엇이 좋아질지 한 줄로"
                    className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                  />
                  <button
                    type="button"
                    disabled={
                      saving ||
                      !draft.change_summary.trim() ||
                      !draft.prediction.trim()
                    }
                    onClick={() => void saveRow(p)}
                    className="shrink-0 rounded bg-[#534AB7] px-3 py-1.5 text-[13px] text-white disabled:opacity-40"
                  >
                    저장
                  </button>
                </div>
              </div>
            </div>

            <div className="w-full border-t border-slate-200 bg-slate-50 p-2.5 sm:w-[230px] sm:shrink-0 sm:border-l sm:border-t-0">
              <div className="mb-2 text-[11px] font-medium text-slate-600">버전 이력</div>
              {versions.length === 0 ? (
                <p className="text-[10.5px] text-gray-500">이력이 없습니다.</p>
              ) : (
                versions.map((v) => {
                  const hasPrediction = Boolean(v.prediction?.trim());
                  const badge = hasPrediction
                    ? verifyBadge(v.verify_result)
                    : null;
                  return (
                  <div
                    key={v.id}
                    className="border-b border-slate-200 py-2 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-700">
                      {v.changed_by_luna ? (
                        <span
                          className="inline-block h-[5px] w-[5px] rounded-full bg-[#534AB7]"
                          aria-hidden
                        />
                      ) : null}
                      <span className="font-mono">v{v.version}</span>
                      <span>{v.changed_by_luna ? "LUNA" : v.editor_name || "-"}</span>
                      <span className="text-gray-500">{formatVersionDate(v.created_at)}</span>
                      {badge ? (
                        <span
                          className={`rounded-[3px] px-[6px] py-px text-[9px] font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-gray-500">
                      {v.change_summary || ""}
                    </p>
                    {hasPrediction ? (
                      <p className="mt-0.5 text-[10.5px] italic text-slate-600">
                        → {v.prediction}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void revertTo(p, v.version)}
                      className="mt-0.5 text-[10px] text-[#534AB7]"
                    >
                      이 버전으로 되돌리기
                    </button>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-slate-400">불러오는 중…</div>;
  }

  return (
    <div className="space-y-1">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">
          프롬프트{" "}
          <span className="font-normal text-slate-400">{prompts.length}</span>
        </h2>
        <button
          type="button"
          disabled={adding}
          onClick={(e) => void addPrompt(e)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          ＋ 추가
        </button>
      </div>

      {message ? <p className="mb-2 text-[12px] text-slate-600">{message}</p> : null}

      <input
        value={filterQuery}
        onChange={(e) => setFilterQuery(e.target.value)}
        placeholder="번호 또는 이름으로 찾기"
        className="mb-3 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] placeholder:text-slate-400"
      />

      {groupedSections.map(({ group, items }) => {
        const descOpen = openGroupKey === group.group_key;
        return (
          <div key={group.group_key}>
            <button
              type="button"
              onClick={() =>
                setOpenGroupKey(descOpen ? null : group.group_key)
              }
              className="flex w-full items-start gap-3 border-b border-slate-200 pb-1.5 text-left"
              style={{ marginTop: 18, marginBottom: 6 }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-0">
                  <span className="text-[14px] font-semibold text-slate-900">
                    {group.label}
                  </span>
                  {group.tagline ? (
                    <span className="text-[12px] text-gray-500">
                      {" — "}
                      {group.tagline}
                    </span>
                  ) : null}
                </div>
                {group.when_runs ? (
                  <div className="mt-0.5 font-mono text-[10.5px] text-gray-400">
                    실행 · {group.when_runs}
                  </div>
                ) : null}
                {descOpen && group.description ? (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-600">
                    {group.description}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 pt-0.5 text-[11px] text-gray-400">
                {items.length}
              </span>
            </button>
            <div className="space-y-1">{items.map(renderRow)}</div>
          </div>
        );
      })}
    </div>
  );
}

function LunaTalkPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<
    { key: string; label: string; connected: boolean; note?: string }[]
  >([
    { key: "notion", label: "노션", connected: false },
    { key: "nas", label: "Work서버", connected: false },
    { key: "web", label: "웹", connected: false },
    { key: "youtube", label: "YouTube", connected: false, note: "준비 중" }
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getAccessToken();
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const [engineRes, nasRes] = await Promise.all([
          fetch("/api/luna/engine", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/luna/nas", { headers: { Authorization: `Bearer ${token}` } })
        ]);
        const engineJson = engineRes.ok
          ? ((await engineRes.json()) as {
              connections?: { notion?: boolean; tavily?: boolean };
            })
          : {};
        const nasJson = nasRes.ok
          ? ((await nasRes.json()) as { settings?: unknown; total_count?: number })
          : {};
        if (cancelled) return;
        setRows([
          {
            key: "notion",
            label: "노션",
            connected: engineJson.connections?.notion === true
          },
          {
            key: "nas",
            label: "Work서버",
            connected: Boolean(nasJson.settings) || (nasJson.total_count ?? 0) > 0
          },
          {
            key: "web",
            label: "웹",
            connected: engineJson.connections?.tavily === true
          },
          {
            key: "youtube",
            label: "YouTube",
            connected: false,
            note: "준비 중"
          }
        ]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-[13px] font-semibold text-slate-900">말투</h3>
        <p className="mt-1 text-[12px] text-slate-600">
          말투는 두뇌 L1-01에서 관리합니다.
        </p>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-[13px] font-semibold text-slate-900">커넥터</h3>
        {loading ? (
          <p className="text-[12px] text-slate-500">불러오는 중…</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 py-2.5 text-[13px]"
              >
                <span className="text-slate-900">{row.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    row.connected
                      ? "bg-[#E1F5EE] text-[#04342C]"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {row.note ?? (row.connected ? "연결됨" : "미연결")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type NotifyEventsState = {
  consolidation: boolean;
  study: boolean;
  reflect: boolean;
  conflict: boolean;
  prompt_change: boolean;
  exam: boolean;
};

type ConsolidationStatusState = {
  settings: {
    volume_threshold: number;
    backstop_days: number;
    notify_events: NotifyEventsState;
  };
  last_run: {
    finished_at: string | null;
    started_at: string;
    status: string;
    trigger: string;
    merged_candidates: number | null;
    stale_candidates: number | null;
    conflict_candidates: number | null;
  } | null;
  new_active_since_last: number;
  days_since_last: number | null;
  days_until_backstop: number | null;
  would_run: boolean;
  next_trigger: string | null;
};

function formatStudyDate(iso: string | null | undefined): string {
  if (!iso) return "없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "없음";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

type UpgradeHistoryItem = {
  id: string;
  target_id: string;
  version: number;
  change_summary: string | null;
  prediction: string | null;
  verify_result: string | null;
  verify_note: string | null;
  created_at: string;
  prompt_title: string | null;
  prompt_key: string | null;
  current_version: number | null;
};

function LunaBrainImproveSection() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reportBody, setReportBody] = useState<string | null>(null);
  const [reportAt, setReportAt] = useState<string | null>(null);
  const [history, setHistory] = useState<UpgradeHistoryItem[]>([]);
  const [revertSuggestion, setRevertSuggestion] = useState<{
    prompt_id: string;
    title: string;
    version: number;
    previous_version: number;
    reason: string;
  } | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const [upgradeRes, reportRes] = await Promise.all([
        fetch("/api/luna/self-upgrade", {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch("/api/luna/self-report", {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      if (upgradeRes.ok) {
        const u = (await upgradeRes.json()) as {
          history?: UpgradeHistoryItem[];
          revert_suggestion?: {
            prompt_id: string;
            title: string;
            version: number;
            previous_version: number;
            reason: string;
          } | null;
        };
        setHistory(Array.isArray(u.history) ? u.history : []);
        setRevertSuggestion(u.revert_suggestion ?? null);
      }
      if (reportRes.ok) {
        const r = (await reportRes.json()) as {
          last_report?: {
            body?: string;
            finished_at?: string;
          } | null;
        };
        setReportBody(r.last_report?.body ?? null);
        setReportAt(r.last_report?.finished_at ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runUpgrade() {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/self-upgrade", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setMessage(`실행 실패: ${json.error || "unknown"}`);
        return;
      }
      setMessage(json.message || "실행 완료");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revertUpgrade(item: UpgradeHistoryItem) {
    const token = await getAccessToken();
    if (!token || busy) return;
    const toVersion = Math.max(1, item.version - 1);
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/prompts/revert", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: item.target_id, version: toVersion })
      });
      if (!res.ok) {
        setMessage(`되돌리기 실패: ${await res.text()}`);
        return;
      }
      setMessage(`「${item.prompt_title ?? item.prompt_key}」 v${toVersion}으로 되돌림`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revertSuggestionNow() {
    if (!revertSuggestion) return;
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/prompts/revert", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: revertSuggestion.prompt_id,
          version: revertSuggestion.previous_version
        })
      });
      if (!res.ok) {
        setMessage(`되돌리기 실패: ${await res.text()}`);
        return;
      }
      setMessage(
        `「${revertSuggestion.title}」 v${revertSuggestion.previous_version}으로 되돌림`
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            최근 주간 성장 보고
          </h3>
          {reportAt ? (
            <span className="text-[11px] text-slate-500">
              {formatStudyDate(reportAt)}
            </span>
          ) : null}
        </div>
        {loading ? (
          <p className="mt-2 text-[12px] text-slate-500">불러오는 중…</p>
        ) : reportBody ? (
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">
            {reportBody.length > 600
              ? `${reportBody.slice(0, 600)}…`
              : reportBody}
          </p>
        ) : (
          <p className="mt-2 text-[12px] text-slate-500">
            아직 주간 보고가 없습니다. (월요일 08:00 KST 자동)
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">
            루나의 개선 이력
          </h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runUpgrade()}
            className="ml-auto rounded-lg border border-[#534AB7] px-2.5 py-1 text-[11px] font-medium text-[#534AB7] hover:bg-[#EEEDFE] disabled:opacity-50"
          >
            {busy ? "실행 중…" : "지금 자기개선 실행"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          확정 지식·반복 정정(3회+)만 근거. L2·L3·L4 한 건씩. 일요일 04:00 KST.
        </p>

        {revertSuggestion ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold">
              되돌리기 제안
            </span>
            <span className="min-w-0 flex-1">
              「{revertSuggestion.title}」 v{revertSuggestion.version} 회귀
              하락 — {revertSuggestion.reason.slice(0, 80)}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void revertSuggestionNow()}
              className="shrink-0 rounded bg-[#534AB7] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
            >
              되돌리기
            </button>
          </div>
        ) : null}

        {message ? (
          <p className="mt-2 text-[11px] text-slate-600">{message}</p>
        ) : null}

        {loading ? (
          <p className="mt-3 text-[12px] text-slate-500">불러오는 중…</p>
        ) : history.length === 0 ? (
          <p className="mt-3 text-[12px] text-slate-500">
            루나가 스스로 바꾼 이력이 아직 없습니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {history.map((item) => {
              const dropped = item.verify_result === "refuted";
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-1 py-2.5 text-[12px] text-slate-700 sm:flex-row sm:items-start sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-slate-900">
                        {item.prompt_title || item.prompt_key || "프롬프트"}
                      </span>
                      <span className="font-mono text-[10.5px] text-slate-500">
                        v{item.version}
                      </span>
                      {dropped ? (
                        <span className="rounded bg-red-100 px-1.5 py-px text-[10px] font-medium text-red-800">
                          회귀 하락
                        </span>
                      ) : item.verify_result === "confirmed" ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-px text-[10px] font-medium text-emerald-800">
                          회귀 통과
                        </span>
                      ) : null}
                      <span className="text-[10.5px] text-slate-400">
                        {formatStudyDate(item.created_at)}
                      </span>
                    </div>
                    {item.change_summary ? (
                      <p className="mt-0.5 text-slate-600">
                        이유: {item.change_summary}
                      </p>
                    ) : null}
                    {item.prediction ? (
                      <p className="text-slate-500">예측: {item.prediction}</p>
                    ) : null}
                    {item.verify_note ? (
                      <p className="text-[11px] text-slate-500">
                        회귀: {item.verify_note}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={busy || item.version <= 1}
                    onClick={() => void revertUpgrade(item)}
                    className="shrink-0 self-start rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    되돌리기
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function LunaStudyPanel() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [studyBusy, setStudyBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [studyMessage, setStudyMessage] = useState("");
  const [status, setStatus] = useState<ConsolidationStatusState | null>(null);
  const [selfstudy, setSelfstudy] = useState<{
    last_run: {
      finished_at: string;
      submitted: number;
      skipped: boolean;
      message: string;
    } | null;
    today_count: number;
  } | null>(null);
  const [volumeDraft, setVolumeDraft] = useState(30);
  const [backstopDraft, setBackstopDraft] = useState(14);
  const [notifyDraft, setNotifyDraft] = useState<NotifyEventsState>({
    consolidation: true,
    study: true,
    reflect: true,
    conflict: true,
    prompt_change: true,
    exam: true
  });

  const load = useCallback(async () => {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? null;
    if (!token) {
      setLoading(false);
      return;
    }

    const {
      data: { user }
    } = await supabase.auth.getUser();
    let admin = false;
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      admin = profile?.role === "슈퍼관리자";
      setIsAdmin(admin);
    }

    const consolidateRes = await fetch("/api/luna/consolidate", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!consolidateRes.ok) {
      setMessage(`정리 상태 불러오기 실패`);
    } else {
      const json = (await consolidateRes.json()) as ConsolidationStatusState;
      setStatus(json);
      setVolumeDraft(json.settings.volume_threshold);
      setBackstopDraft(json.settings.backstop_days);
      setNotifyDraft(json.settings.notify_events);
    }

    if (admin) {
      const studyRes = await fetch("/api/luna/selfstudy", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (studyRes.ok) {
        const s = (await studyRes.json()) as {
          last_run: {
            finished_at: string;
            submitted: number;
            skipped: boolean;
            message: string;
          } | null;
          today_count: number;
        };
        setSelfstudy(s);
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? null;
    if (!token || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/consolidate", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          volume_threshold: volumeDraft,
          backstop_days: backstopDraft,
          notify_events: notifyDraft
        })
      });
      if (!res.ok) {
        setMessage(`저장 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as ConsolidationStatusState;
      setStatus(json);
      setMessage("설정 저장됨");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? null;
    if (!token || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/consolidate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ force: true })
      });
      const json = (await res.json()) as {
        skipped?: boolean;
        error?: string;
        merged_candidates?: number;
        stale_candidates?: number;
        conflict_candidates?: number;
      };
      if (!res.ok) {
        setMessage(`실행 실패: ${json.error || "unknown"}`);
        return;
      }
      if (json.skipped) {
        setMessage("조건 미충족으로 건너뜀");
      } else if (json.error) {
        setMessage(`정리 실패: ${json.error}`);
      } else {
        setMessage(
          `정리 완료 — 중복 ${json.merged_candidates ?? 0} · 미사용 ${json.stale_candidates ?? 0} · 충돌 ${json.conflict_candidates ?? 0}`
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function runSelfstudyNow() {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? null;
    if (!token || studyBusy) return;
    setStudyBusy(true);
    setStudyMessage("");
    try {
      const res = await fetch("/api/luna/selfstudy", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ force: true })
      });
      const json = (await res.json()) as {
        submitted?: number;
        skipped?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setStudyMessage(`자습 실패: ${json.error || "unknown"}`);
        return;
      }
      setStudyMessage(
        json.message ||
          (json.submitted
            ? `자습 문답 ${json.submitted}건 제출`
            : "오늘은 자습할 것이 없음")
      );
      await load();
    } finally {
      setStudyBusy(false);
    }
  }

  const lastRunAt =
    status?.last_run?.finished_at ?? status?.last_run?.started_at ?? null;
  const selfstudyLastAt = selfstudy?.last_run?.finished_at ?? null;
  const selfstudySubmitted = selfstudy?.last_run?.submitted ?? 0;
  const notifyLabels: Array<{ key: keyof NotifyEventsState; label: string }> = [
    { key: "consolidation", label: "정리" },
    { key: "study", label: "자습" },
    { key: "reflect", label: "리플렉션" },
    { key: "conflict", label: "충돌" },
    { key: "prompt_change", label: "프롬프트" },
    { key: "exam", label: "시험" }
  ];

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">자습</h3>
          <span className="text-[11px] text-slate-500">그날 막힌 것만</span>
        </div>
        <p className="mt-2 text-[12px] text-slate-600">
          오늘 대화에서 막힌 순간을 골라 스스로 정리한 뒤 후보함에 제출합니다.
        </p>
        {loading ? (
          <p className="mt-3 text-[12px] text-slate-500">불러오는 중…</p>
        ) : (
          <div className="mt-3 space-y-2 text-[12px] text-slate-700">
            <p>
              마지막 실행{" "}
              <span className="font-medium text-slate-900">
                {formatStudyDate(selfstudyLastAt)}
              </span>
            </p>
            <p>
              제출 문답{" "}
              <span className="font-medium text-slate-900">
                {selfstudySubmitted}건
              </span>
              {typeof selfstudy?.today_count === "number" ? (
                <span className="text-slate-500">
                  {" "}
                  · 오늘 {selfstudy.today_count}건
                </span>
              ) : null}
            </p>
            {selfstudy?.last_run?.message ? (
              <p className="text-[11px] text-slate-500">
                {selfstudy.last_run.message}
              </p>
            ) : null}
            {isAdmin ? (
              <button
                type="button"
                disabled={studyBusy}
                onClick={() => void runSelfstudyNow()}
                className="mt-1 w-full rounded-lg bg-[#534AB7] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
              >
                {studyBusy ? "자습 중…" : "지금 자습 실행"}
              </button>
            ) : null}
            {studyMessage ? (
              <p className="text-[11px] text-slate-600">{studyMessage}</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">복습</h3>
          <span className="text-[11px] text-slate-500">리플렉션</span>
        </div>
        <p className="mt-2 text-[12px] text-slate-600">
          대화·실패·피드백을 되짚어 정리합니다.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 md:col-span-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">정리</h3>
          <span className="text-[11px] text-slate-500">망각·통합</span>
        </div>
        <p className="mt-2 text-[12px] text-slate-600">
          오래된 기억을 정리하고 통합합니다. 후보는 교정 화면에서 승인합니다.
        </p>

        {loading ? (
          <p className="mt-3 text-[12px] text-slate-500">불러오는 중…</p>
        ) : (
          <div className="mt-3 space-y-3 text-[12px] text-slate-700">
            <p>
              마지막 실행일{" "}
              <span className="font-medium text-slate-900">
                {formatStudyDate(lastRunAt)}
              </span>
              {status?.last_run?.status ? (
                <span className="text-slate-500"> · {status.last_run.status}</span>
              ) : null}
            </p>
            <p>
              다음 조건 · 신규{" "}
              <span className="font-medium">
                {status?.new_active_since_last ?? 0}/{status?.settings.volume_threshold ?? volumeDraft}
              </span>
              {" · "}
              백스톱{" "}
              <span className="font-medium">
                {status?.days_until_backstop === 0
                  ? "도래"
                  : `D-${status?.days_until_backstop ?? "-"}`}
              </span>
            </p>

            {isAdmin ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[11px] text-slate-500">
                    신규 임계값
                    <input
                      type="number"
                      min={5}
                      max={500}
                      value={volumeDraft}
                      onChange={(e) => setVolumeDraft(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] text-slate-900"
                    />
                  </label>
                  <label className="block text-[11px] text-slate-500">
                    백스톱(일)
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={backstopDraft}
                      onChange={(e) => setBackstopDraft(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] text-slate-900"
                    />
                  </label>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] text-slate-500">알림 이벤트</p>
                  <div className="flex flex-wrap gap-2">
                    {notifyLabels.map(({ key, label }) => (
                      <label
                        key={key}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
                      >
                        <input
                          type="checkbox"
                          checked={notifyDraft[key]}
                          onChange={(e) =>
                            setNotifyDraft((prev) => ({
                              ...prev,
                              [key]: e.target.checked
                            }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveSettings()}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    설정 저장
                  </button>
                </div>
              </>
            ) : null}

            {message ? (
              <p className="text-[11px] text-slate-500">{message}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function LunaSettingsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawLuna = searchParams.get("luna");
  const rawSub = searchParams.get("sub");
  const filter = searchParams.get("filter");
  const route = resolveLunaRoute(rawLuna, rawSub);
  const filterSub = legacyFilterToSub(route.menu, filter);
  const menu = route.menu;
  const sub = filterSub ?? route.sub;

  useEffect(() => {
    const canonical = canonicalLunaSettingsUrl(searchParams);
    if (canonical) {
      router.replace(canonical, { scroll: false });
    }
  }, [router, searchParams]);

  const navigate = useCallback(
    (nextMenu: LunaMenuSlug, nextSub?: LunaSubSlug | null) => {
      router.replace(buildLunaSettingsUrl(nextMenu, nextSub), { scroll: false });
    },
    [router]
  );

  const pageTitle =
    menu === "dashboard" ? "대시보드" : subLabel(menu, sub);

  function renderContent() {
    if (menu === "dashboard") {
      return <LunaSettingsHome />;
    }

    if (menu === "knowledge") {
      if (sub === "confirmed") return <LunaKnowledgeTab />;
      if (sub === "glossary") return <LunaKnowledgeGlossary />;
      if (sub === "conflict") return <LunaKnowledgeConflict />;
      if (sub === "workserver") return <LunaKnowledgeWorkserver />;
      if (sub === "notion") return <LunaKnowledgeNotion />;
    }

    if (menu === "talk") {
      if (sub === "history") return <LunaTalkHistory />;
      if (sub === "metrics") return <LunaTalkMetrics />;
    }

    if (menu === "candidates") {
      if (sub === "pending") return <LunaCandidatesPending />;
      if (sub === "mine") return <LunaCandidatesMine />;
      if (sub === "history") return <LunaCandidatesHistory />;
    }

    if (menu === "selfstudy") {
      if (sub === "history") return <LunaSelfstudyHistory />;
      if (sub === "stuck") return <LunaSelfstudyStuck />;
      if (sub === "settings") return <LunaSelfstudySettings />;
    }

    if (menu === "brain") {
      if (sub === "prompts") return <LunaBrainPrompts />;
      if (sub === "upgrade") return <LunaBrainUpgrade />;
      if (sub === "model") return <LunaBrainModel />;
      if (sub === "eval") return <LunaBrainEval />;
      if (sub === "report") return <LunaBrainReport />;
    }

    return <LunaPlaceholder title={pageTitle} />;
  }

  return (
    <div className="space-y-5">
      <LunaSettingsNav
        menu={menu}
        sub={sub}
        onMenuChange={(nextMenu) => navigate(nextMenu, defaultSubForMenu(nextMenu))}
        onSubChange={(nextSub) => navigate(menu, nextSub)}
      />

      {menu !== "dashboard" ? (
        <h2 className="text-[14px] font-semibold text-slate-900">{pageTitle}</h2>
      ) : null}

      {renderContent()}
    </div>
  );
}
