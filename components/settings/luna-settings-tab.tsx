"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { LunaEngineTab } from "@/components/settings/luna-engine-tab";
import { LunaEvalTab } from "@/components/settings/luna-eval-tab";
import { LunaKnowledgeTab } from "@/components/settings/luna-knowledge-tab";
import { LunaNasTab } from "@/components/settings/luna-nas-tab";
import { LunaTraceTab } from "@/components/settings/luna-trace-tab";
import type {
  LunaPromptGroupRow,
  LunaPromptKind,
  LunaPromptRow,
  LunaPromptVersionRow
} from "@/lib/luna/prompts";
import { formatPromptNumber } from "@/lib/luna/prompts";
import { supabase } from "@/lib/supabase/client";

type LunaSubTab =
  | "prompts"
  | "eval"
  | "engine"
  | "knowledge"
  | "nas"
  | "trace";

type ProfileOption = { id: string; name: string };

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
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

export function LunaSettingsTab() {
  const [subTab, setSubTab] = useState<LunaSubTab>("prompts");

  return (
    <div>
      <nav className="mb-4 inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
        {(
          [
            { key: "prompts", label: "프롬프트" },
            { key: "eval", label: "회귀 테스트" },
            { key: "engine", label: "엔진" },
            { key: "knowledge", label: "지식" },
            { key: "nas", label: "Work서버" },
            { key: "trace", label: "관측" }
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSubTab(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-[12px] transition ${
              subTab === tab.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {subTab === "prompts" ? (
        <LunaPromptsPanel />
      ) : subTab === "eval" ? (
        <LunaEvalTab />
      ) : subTab === "engine" ? (
        <LunaEngineTab />
      ) : subTab === "knowledge" ? (
        <LunaKnowledgeTab />
      ) : subTab === "nas" ? (
        <LunaNasTab />
      ) : (
        <LunaTraceTab />
      )}
    </div>
  );
}
