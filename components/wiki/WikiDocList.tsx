"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { WikiStaffHiddenMark } from "@/components/wiki/WikiStaffHiddenMark";
import { formatWikiWhen, wikiEditorLabel, W } from "@/components/wiki/wiki-theme";
import {
  wikiDocPath,
  type WikiDocListItem,
  type WikiMenu
} from "@/lib/wiki/types";

type ListPayload = {
  items?: WikiDocListItem[];
  menu?: WikiMenu | null;
  can_create?: boolean;
  wiki_ready?: boolean;
  error?: string;
};

export function WikiDocList({ menuSlug }: { menuSlug: string }) {
  const [items, setItems] = useState<WikiDocListItem[]>([]);
  const [menu, setMenu] = useState<WikiMenu | null>(null);
  const [query, setQuery] = useState("");
  const [canCreate, setCanCreate] = useState(false);
  const [wikiReady, setWikiReady] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await wikiFetch<ListPayload>(
        `/api/wiki/docs?menu=${encodeURIComponent(menuSlug)}`
      );
      setItems(json.items ?? []);
      setMenu(json.menu ?? null);
      setCanCreate(json.can_create === true);
      setWikiReady(json.wiki_ready !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [menuSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${row.title} ${row.summary}`.toLowerCase().includes(q);
  });

  const label = menu?.name ?? menuSlug;
  const anyone = menu?.editable_by !== "admin";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
      <div className="mb-2 text-[11px]" style={{ color: W.faint }}>
        <Link href="/wiki/terms" style={{ color: W.luna }}>
          Wikipedia
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        {label}
      </div>
      <h1 className="text-[19px] font-extrabold tracking-[-0.3px]">{label}</h1>
      <p className="mb-3 mt-1 text-[11px]" style={{ color: W.faint }}>
        {menu?.description ?? ""}
        {menu ? ` · ${anyone ? "누구나 고칠 수 있어요" : "관리자만"}` : ""}
      </p>

      {!wikiReady ? (
        <p
          className="mb-3 rounded-[10px] px-[13px] py-2.5 text-[11.5px]"
          style={{ background: W.lockBg, color: W.lock }}
        >
          위키 마이그레이션 SQL을 실행하면 절 단위 편집·이력이 켜집니다.
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 text-[12px]" style={{ color: W.del }}>
          {error}
        </p>
      ) : null}

      <div className="mb-3 flex gap-[7px]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름으로 찾기"
          className="flex-1 rounded-[9px] border px-[11px] py-[7px] text-[12px] outline-none"
          style={{ borderColor: W.line, color: W.ink }}
        />
        {canCreate ? (
          <Link
            href={`/wiki/new?menu=${encodeURIComponent(menuSlug)}`}
            className="whitespace-nowrap rounded-[9px] px-[13px] py-[7px] text-[12px] font-bold text-white"
            style={{ background: W.luna }}
          >
            ＋ 새 문서
          </Link>
        ) : null}
      </div>

      {loading ? (
        <p className="text-[12px]" style={{ color: W.faint }}>
          불러오는 중…
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-[12px]" style={{ color: W.faint }}>
          문서가 없습니다.
        </p>
      ) : (
        <div
          className="overflow-hidden rounded-[11px] border"
          style={{ borderColor: W.line }}
        >
          {filtered.map((row) => {
            const isPrivate = row.visible_to_staff === false;
            return (
              <Link
                key={row.slug}
                href={wikiDocPath(row.slug)}
                className="flex items-center gap-[11px] border-b px-[14px] py-3 last:border-b-0"
                style={{
                  borderColor: W.line2,
                  background: isPrivate ? W.lockBg : undefined,
                  opacity: isPrivate ? 0.92 : 1
                }}
              >
                <span className="min-w-[150px] text-[13px] font-semibold">
                  {row.title}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[11px]"
                  style={{ color: W.sub }}
                >
                  {row.summary || "—"}
                </span>
                {isPrivate ? <WikiStaffHiddenMark /> : null}
                <span className="text-[10px]" style={{ color: W.faint }}>
                  {wikiEditorLabel(row.updated_by, row.updated_by_name)}
                </span>
                <span
                  className="w-[38px] text-right text-[10px]"
                  style={{ color: W.faint }}
                >
                  {formatWikiWhen(row.updated_at)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
