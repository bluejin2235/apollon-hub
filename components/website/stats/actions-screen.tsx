"use client";

/**
 * 조치 기록 화면 — 날짜 · 한 일 · 분류 · 메모를 적고 고치고 지운다.
 * 적은 사람은 Hub 프록시가 로그인 사용자 이름으로 넣는다. 이 화면은 보내지 않는다.
 */

import { useState, type FormEvent } from "react";

import { useStatsActions } from "@/components/website/stats/stats-actions";
import { isoText } from "@/components/website/stats/stats-data";
import {
  ACTION_CATEGORY_LABEL,
  actionCategoryLabel
} from "@/components/website/stats/stats-labels";
import { SectionHead } from "@/components/website/stats/stats-slot";
import {
  createStatsAction,
  deleteStatsAction,
  updateStatsAction,
  type StatsActionWrite
} from "@/lib/website/api";
import {
  STATS_ACTION_CATEGORIES,
  type StatsAction,
  type StatsActionCategory
} from "@/lib/website/stats";

type Draft = {
  action_date: string;
  title: string;
  category: StatsActionCategory | "";
  note: string;
};

const TITLE_MAX = 80;

function emptyDraft(today: string): Draft {
  return { action_date: today, title: "", category: "", note: "" };
}

function draftOf(item: StatsAction): Draft {
  return {
    action_date: item.action_date,
    title: item.title,
    category: item.category ?? "",
    note: item.note ?? ""
  };
}

function writeOf(draft: Draft): StatsActionWrite {
  return {
    action_date: draft.action_date,
    title: draft.title.trim(),
    category: draft.category || null,
    note: draft.note.trim() || null
  };
}

/** 홈페이지가 돌려준 오류를 사람이 읽을 말로 */
function failText(error: string, status: number): string {
  if (status === 401) return "로그인이 풀렸습니다. 다시 로그인해 주세요.";
  if (status === 403) return "조치 기록을 고칠 권한이 없습니다.";
  if (error === "invalid_action_date") return "날짜를 다시 골라 주세요.";
  if (error === "invalid_title") return "한 일을 한 줄 적어 주세요.";
  if (error === "invalid_category") return "분류를 다시 골라 주세요.";
  if (error === "stats_action_not_found") return "이미 지워진 기록입니다. 목록을 다시 불러옵니다.";
  if (status === 404) return "홈페이지에 조치 기록 기능이 아직 없습니다.";
  return "저장하지 못했습니다. 잠시 뒤 다시 해 주세요.";
}

function ActionForm({
  today,
  editing,
  onDone,
  onCancel
}: {
  today: string;
  editing: StatsAction | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftOf(editing) : emptyDraft(today)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const body = writeOf(draft);
    if (!body.title) {
      setMessage("한 일을 한 줄 적어 주세요.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = editing
      ? await updateStatsAction(editing.id, body)
      : await createStatsAction(body);
    setBusy(false);
    if (!result.ok) {
      setMessage(failText(result.error, result.status));
      if (result.error === "stats_action_not_found") onDone();
      return;
    }
    if (!editing) setDraft(emptyDraft(today));
    onDone();
  }

  return (
    <form className="ws-act-form" onSubmit={submit}>
      <label className="ws-field">
        <span>날짜</span>
        <input
          type="date"
          required
          value={draft.action_date}
          onChange={(event) => patch({ action_date: event.target.value })}
        />
      </label>
      <label className="ws-field ws-field-wide">
        <span>한 일</span>
        <input
          type="text"
          required
          maxLength={TITLE_MAX}
          placeholder="예: 워크 글 구조화 데이터 개선"
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>
      <label className="ws-field">
        <span>분류</span>
        <select
          value={draft.category}
          onChange={(event) => patch({ category: event.target.value as Draft["category"] })}
        >
          <option value="">고르지 않음</option>
          {STATS_ACTION_CATEGORIES.map((id) => (
            <option key={id} value={id}>
              {ACTION_CATEGORY_LABEL[id]}
            </option>
          ))}
        </select>
      </label>
      <label className="ws-field ws-field-full">
        <span>메모</span>
        <textarea
          rows={2}
          placeholder="왜 했는지, 무엇을 볼지 (안 적어도 됩니다)"
          value={draft.note}
          onChange={(event) => patch({ note: event.target.value })}
        />
      </label>
      <div className="ws-act-foot">
        <span className="ws-t2">적은 사람은 로그인한 이름으로 저장됩니다.</span>
        {message ? <span className="ws-act-fail">{message}</span> : null}
        {editing ? (
          <button type="button" className="ws-retry" onClick={onCancel} disabled={busy}>
            취소
          </button>
        ) : null}
        <button type="submit" className="ws-act-save" disabled={busy}>
          {busy ? "저장하는 중…" : editing ? "고친 내용 저장" : "적기"}
        </button>
      </div>
    </form>
  );
}

function ActionTable({
  items,
  editingId,
  onEdit,
  onDeleted
}: {
  items: StatsAction[];
  editingId: string | null;
  onEdit: (item: StatsAction) => void;
  onDeleted: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function remove(item: StatsAction) {
    if (!window.confirm(`「${item.title}」 기록을 지울까요?`)) return;
    setBusyId(item.id);
    setMessage(null);
    const result = await deleteStatsAction(item.id);
    setBusyId(null);
    if (!result.ok && result.error !== "stats_action_not_found") {
      setMessage(failText(result.error, result.status));
      return;
    }
    onDeleted(item.id);
  }

  return (
    <>
      {message ? <p className="ws-act-fail">{message}</p> : null}
      <div className="ws-table-wrap">
        <table className="ws-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>한 일</th>
              <th>분류</th>
              <th>적은 사람</th>
              <th aria-label="고치기·지우기" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={item.id === editingId ? "on" : undefined}>
                <td className="ws-act-date">{isoText(item.action_date)}</td>
                <td>
                  {item.title}
                  {item.note ? <div className="ws-t2">{item.note}</div> : null}
                </td>
                <td>
                  {item.category ? (
                    <span className="ws-tag">{actionCategoryLabel(item.category)}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{item.created_by ?? "—"}</td>
                <td className="ws-act-btns">
                  <button
                    type="button"
                    className="ws-chip"
                    onClick={() => onEdit(item)}
                    disabled={busyId === item.id}
                  >
                    고치기
                  </button>
                  <button
                    type="button"
                    className="ws-chip"
                    onClick={() => void remove(item)}
                    disabled={busyId === item.id}
                  >
                    {busyId === item.id ? "지우는 중…" : "지우기"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ActionsScreen({ today }: { today: string }) {
  const actions = useStatsActions();
  const [editing, setEditing] = useState<StatsAction | null>(null);

  return (
    <>
      <div className="ws-sec">
        <div className="ws-card">
          <div className="ws-ct">{editing ? `고치는 중 · ${isoText(editing.action_date)}` : "새로 적기"}</div>
          <ActionForm
            key={editing?.id ?? "new"}
            today={today}
            editing={editing}
            onDone={() => {
              setEditing(null);
              actions.reload();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      </div>

      <div className="ws-sec">
        <SectionHead
          title="적어 둔 조치"
          stamp={actions.status === "ready" ? `${actions.items.length}건 · 날짜 늦은 순` : undefined}
        />
        <p className="ws-note">같은 날이나 가까운 날의 기록은 그래프에서 세로선 하나로 묶고, 선에 마우스를 올리면 목록이 뜹니다.</p>
        <div className="ws-card">
          {actions.status === "loading" ? <p className="ws-kpi-sub">불러오는 중입니다</p> : null}
          {actions.status === "error" ? (
            <div className="ws-luna-fail">
              <p className="ws-kpi-sub">목록을 불러오지 못했습니다.</p>
              <button type="button" className="ws-retry" onClick={actions.reload}>
                다시 불러오기
              </button>
            </div>
          ) : null}
          {actions.status === "ready" && actions.items.length === 0 ? (
            <p className="ws-kpi-sub">아직 적은 조치가 없습니다.</p>
          ) : null}
          {actions.status === "ready" && actions.items.length > 0 ? (
            <ActionTable
              items={actions.items}
              editingId={editing?.id ?? null}
              onEdit={setEditing}
              onDeleted={(id) => {
                if (editing?.id === id) setEditing(null);
                actions.reload();
              }}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
