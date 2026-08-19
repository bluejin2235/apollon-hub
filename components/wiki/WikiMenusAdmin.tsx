"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { W } from "@/components/wiki/wiki-theme";
import type { WikiMenu } from "@/lib/wiki/types";

type Payload = { items?: WikiMenu[]; error?: string };

export function WikiMenusAdmin() {
  const [items, setItems] = useState<WikiMenu[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPerm, setNewPerm] = useState<"all" | "admin">("all");

  const load = useCallback(async () => {
    try {
      const json = await wikiFetch<Payload>("/api/wiki/menus");
      setItems(json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rename(m: WikiMenu) {
    const name = window.prompt("이름", m.name)?.trim();
    if (!name || name === m.name) return;
    setBusy(true);
    try {
      await wikiFetch("/api/wiki/menus", {
        method: "PATCH",
        body: JSON.stringify({ slug: m.slug, name })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHidden(m: WikiMenu) {
    setBusy(true);
    try {
      await wikiFetch("/api/wiki/menus", {
        method: "PATCH",
        body: JSON.stringify({ slug: m.slug, is_active: !m.is_active })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await wikiFetch("/api/wiki/menus", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), editable_by: newPerm })
      });
      setCreating(false);
      setNewName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...items];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    const tmp = next[index]!;
    next[index] = next[j]!;
    next[j] = tmp;
    setItems(next);
    setBusy(true);
    try {
      await wikiFetch("/api/wiki/menus", {
        method: "PATCH",
        body: JSON.stringify({ order: next.map((m) => m.slug) })
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "순서 저장 실패");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
      <div className="mb-2 text-[11px]" style={{ color: W.faint }}>
        <Link href="/wiki/terms" style={{ color: W.luna }}>
          Wikipedia
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        메뉴 관리
      </div>
      <h1 className="text-[17px] font-extrabold">메뉴 관리</h1>
      <p className="mb-3 mt-1 text-[11px]" style={{ color: W.faint }}>
        위·아래로 순서를 바꿉니다 · 슈퍼관리자만 · 문서가 있는 메뉴는 숨기기만 됩니다
      </p>
      {error ? (
        <p className="mb-2 text-[12px]" style={{ color: W.del }}>
          {error}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-[11px] border" style={{ borderColor: W.line }}>
        <div
          className="flex items-center gap-2.5 border-b px-[13px] py-2.5 text-[12.5px]"
          style={{ borderColor: W.line2 }}
        >
          <span className="font-semibold" style={{ minWidth: 110 }}>
            용어사전
          </span>
          <span className="text-[10.5px]" style={{ color: W.faint, width: 36 }}>
            —
          </span>
          <span
            className="rounded-[9px] px-2 py-0.5 text-[10px]"
            style={{ background: W.chip, color: W.sub }}
          >
            누구나
          </span>
          <span className="flex-1" />
          <span className="text-[10.5px]" style={{ color: W.faint }}>
            고정
          </span>
        </div>
        {items.map((m, i) => (
          <div
            key={m.slug}
            className="flex items-center gap-2.5 border-b px-[13px] py-2.5 text-[12.5px] last:border-b-0"
            style={{ borderColor: W.line2, opacity: m.is_active ? 1 : 0.55 }}
          >
            <span className="flex gap-0.5 text-[10px]" style={{ color: W.faint }}>
              <button type="button" disabled={busy || i === 0} onClick={() => void move(i, -1)}>
                ↑
              </button>
              <button
                type="button"
                disabled={busy || i === items.length - 1}
                onClick={() => void move(i, 1)}
              >
                ↓
              </button>
            </span>
            <span className="font-semibold" style={{ minWidth: 110 }}>
              {m.name}
            </span>
            <span className="text-[10.5px]" style={{ color: W.faint, width: 36 }}>
              {m.doc_count ?? 0}
            </span>
            <span
              className="rounded-[9px] px-2 py-0.5 text-[10px]"
              style={
                m.editable_by === "admin"
                  ? { background: W.lockBg, color: W.lock }
                  : { background: W.chip, color: W.sub }
              }
            >
              {m.editable_by === "admin" ? "관리자만" : "누구나"}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              disabled={busy}
              onClick={() => void rename(m)}
              className="rounded-lg border px-2 py-1 text-[10.5px] font-semibold"
              style={{ borderColor: W.line }}
            >
              이름 바꾸기
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleHidden(m)}
              className="rounded-lg border px-2 py-1 text-[10.5px] font-semibold"
              style={{ borderColor: W.line }}
            >
              {m.is_active ? "숨기기" : "보이기"}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3">
        {creating ? (
          <div className="flex max-w-lg flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="메뉴 이름"
              className="rounded-lg border px-3 py-1.5 text-[12px] outline-none"
              style={{ borderColor: W.line }}
            />
            <select
              value={newPerm}
              onChange={(e) => setNewPerm(e.target.value as "all" | "admin")}
              className="rounded-lg border px-2 py-1.5 text-[12px]"
              style={{ borderColor: W.line }}
            >
              <option value="all">누구나</option>
              <option value="admin">관리자만</option>
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className="rounded-[9px] px-3 py-[7px] text-[11.5px] font-semibold text-white"
              style={{ background: W.luna }}
            >
              만들기
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-[9px] px-3 py-[7px] text-[11.5px] font-semibold text-white"
            style={{ background: W.luna }}
          >
            ＋ 새 메뉴
          </button>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-[1.7]" style={{ color: W.faint }}>
        메뉴를 추가해도 코드를 고치지 않습니다.
        <br />
        「관리자만」으로 정한 메뉴는 슈퍼관리자만 문서를 고칠 수 있습니다.
      </p>
    </div>
  );
}
