"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { formatWikiWhen, wikiEditorLabel, W } from "@/components/wiki/wiki-theme";
import {
  WIKI_CATEGORY_META,
  WIKI_KIND_OPTIONS,
  wikiDocPath,
  wikiKindLabel,
  type WikiCategory,
  type WikiDocListItem
} from "@/lib/wiki/types";

type ListPayload = {
  items?: WikiDocListItem[];
  can_edit?: boolean;
  is_admin?: boolean;
  wiki_ready?: boolean;
  error?: string;
};

export function WikiDocList({ category }: { category: WikiCategory }) {
  const meta = WIKI_CATEGORY_META[category];
  const [items, setItems] = useState<WikiDocListItem[]>([]);
  const [query, setQuery] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [wikiReady, setWikiReady] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await wikiFetch<ListPayload>(
        `/api/wiki/docs?category=${category}`
      );
      setItems(json.items ?? []);
      setCanEdit(json.can_edit === true);
      setWikiReady(json.wiki_ready !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${row.title} ${row.summary}`.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
      <div className="mb-2 text-[11px]" style={{ color: W.faint }}>
        <Link href="/wiki/terms" style={{ color: W.luna }}>
          Wikipedia
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        {meta.label}
      </div>
      <h1 className="text-[19px] font-extrabold tracking-[-0.3px]">{meta.label}</h1>
      <p className="mb-3 mt-1 text-[11px]" style={{ color: W.faint }}>
        {meta.blurb}
      </p>

      {!wikiReady ? (
        <p
          className="mb-3 rounded-[10px] px-[13px] py-2.5 text-[11.5px]"
          style={{ background: W.lockBg, color: W.lock }}
        >
          위키 마이그레이션 SQL을 실행하면 절 단위 편집·이력이 켜집니다. 지금은
          기존 라이브러리 본문을 읽기만 합니다.
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
          placeholder={`${meta.label} 이름으로 찾기`}
          className="flex-1 rounded-[9px] border px-[11px] py-[7px] text-[12px] outline-none"
          style={{ borderColor: W.line, color: W.ink }}
        />
        {canEdit ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="whitespace-nowrap rounded-[9px] px-[13px] py-[7px] text-[12px] font-bold text-white"
            style={{ background: W.luna }}
          >
            + 새 {meta.label}
          </button>
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
          {filtered.map((row) => (
            <Link
              key={row.slug}
              href={wikiDocPath(category, row.slug)}
              className="flex items-center gap-[11px] border-b px-[14px] py-3 last:border-b-0"
              style={{ borderColor: W.line2 }}
            >
              <span className="min-w-[126px] text-[13px] font-semibold">
                {row.title}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[11.5px]"
                style={{ color: W.sub }}
              >
                {row.summary || "—"}
              </span>
              <span
                className="rounded-[5px] px-1.5 py-0.5 text-[9px]"
                style={{ background: W.chip, color: W.faint }}
              >
                {wikiKindLabel(category, row.kind)}
              </span>
              <span className="text-[10px]" style={{ color: W.faint }}>
                {wikiEditorLabel(row.updated_by, row.updated_by_name)}
              </span>
              <span
                className="w-10 text-right text-[10px]"
                style={{ color: W.faint }}
              >
                {formatWikiWhen(row.updated_at)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {creating ? (
        <NewDocModal
          category={category}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function NewDocModal({
  category,
  onClose,
  onCreated
}: {
  category: WikiCategory;
  onClose: () => void;
  onCreated: () => void;
}) {
  const kinds = WIKI_KIND_OPTIONS[category];
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState(kinds[0]!.value);
  const [summary, setSummary] = useState("");
  const [sectionTitle, setSectionTitle] = useState("본문");
  const [sectionBody, setSectionBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await wikiFetch("/api/wiki/docs", {
        method: "POST",
        body: JSON.stringify({
          category,
          title,
          kind,
          summary,
          section_title: sectionTitle,
          section_body: sectionBody
        })
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
        <h2 className="text-sm font-semibold">새 {WIKI_CATEGORY_META[category].label}</h2>
        {error ? (
          <p className="mt-2 text-[12px]" style={{ color: W.del }}>
            {error}
          </p>
        ) : null}
        <label className="mt-3 block text-[12px]" style={{ color: W.sub }}>
          제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: W.line }}
            autoFocus
          />
        </label>
        <label className="mt-2 block text-[12px]" style={{ color: W.sub }}>
          종류
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: W.line }}
          >
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 block text-[12px]" style={{ color: W.sub }}>
          한 줄 설명
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: W.line }}
          />
        </label>
        <label className="mt-2 block text-[12px]" style={{ color: W.sub }}>
          첫 절 제목
          <input
            value={sectionTitle}
            onChange={(e) => setSectionTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: W.line }}
          />
        </label>
        <label className="mt-2 block text-[12px]" style={{ color: W.sub }}>
          첫 절 내용
          <textarea
            value={sectionBody}
            onChange={(e) => setSectionBody(e.target.value)}
            className="mt-1 min-h-[80px] w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: W.line }}
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm"
            style={{ color: W.sub }}
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={() => void save()}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: W.luna }}
          >
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}
