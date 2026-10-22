"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createTag,
  getTags,
  setWorkTags,
  type WebsiteTagItem
} from "@/lib/website/api";
import type { ApiResult } from "@/lib/website/types";

const TAG_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Props = {
  workId: string;
  selectedIds: string[];
  onReload: () => Promise<void>;
  saveTags?: (id: string, tagIds: string[]) => Promise<ApiResult<{ items: unknown[] }>>;
};

function tagName(tag: WebsiteTagItem) {
  return tag.label?.ko?.trim() || tag.label?.en?.trim() || tag.id;
}

/** 엔터: 국문·영문 칸 중 하나라도 같으면(대소문자 무시) 그 태그를 붙인다. */
function findReusableTag(tags: WebsiteTagItem[], typed: string) {
  const text = typed.trim();
  if (!text) return undefined;

  const needle = text.toLowerCase();
  return tags.find((tag) => {
    const ko = tag.label?.ko?.trim() ?? "";
    const en = tag.label?.en?.trim() ?? "";
    return ko.toLowerCase() === needle || en.toLowerCase() === needle;
  });
}

function uniqueTagId(tags: WebsiteTagItem[], typed: string) {
  const taken = new Set(tags.map((tag) => tag.id));
  const ascii = typed
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const base = ascii && TAG_ID_RE.test(ascii) ? ascii : `tag-${Date.now().toString(36)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function searchHaystack(tag: WebsiteTagItem) {
  return `${tag.id} ${tagName(tag)}`.toLowerCase();
}

export function TagPicker({ workId, selectedIds, onReload, saveTags = setWorkTags }: Props) {
  const [all, setAll] = useState<WebsiteTagItem[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSuggest, setOpenSuggest] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getTags().then((res) => {
      if (res.ok) setAll(res.data.items ?? []);
    });
  }, []);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setOpenSuggest(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = useMemo(() => {
    const byId = new Map(all.map((tag) => [tag.id, tag]));
    return selectedIds.map((id) => byId.get(id) ?? { id, label: { ko: id } });
  }, [all, selectedIds]);

  const needle = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!needle) return all.filter((tag) => !selectedIds.includes(tag.id)).slice(0, 8);
    return all
      .filter((tag) => {
        if (selectedIds.includes(tag.id)) return false;
        return searchHaystack(tag).includes(needle);
      })
      .slice(0, 8);
  }, [all, needle, selectedIds]);

  async function replace(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await saveTags(workId, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  function resetInput() {
    setQ("");
    setOpenSuggest(false);
  }

  async function add(id: string) {
    if (selectedIds.includes(id)) {
      resetInput();
      return;
    }
    resetInput();
    await replace([...selectedIds, id]);
  }

  async function remove(id: string) {
    await replace(selectedIds.filter((item) => item !== id));
  }

  async function createLiteral(text: string, tags: WebsiteTagItem[]) {
    setBusy(true);
    setError(null);
    try {
      let id = uniqueTagId(tags, text);
      let created = await createTag(id, { ko: text, en: text });
      if (!created.ok) {
        id = uniqueTagId([...tags, { id, label: { ko: text, en: text } }], text);
        created = await createTag(id, { ko: text, en: text });
      }
      if (!created.ok) {
        setError(created.error);
        return;
      }
      setAll((prev) => [...prev, created.data]);
      resetInput();
      await replace([...selectedIds, created.data.id]);
    } finally {
      setBusy(false);
    }
  }

  function pickExisting(tag: WebsiteTagItem) {
    void add(tag.id);
  }

  async function handleEnter() {
    if (busy) return;

    const text = q.trim();
    if (!text) return;

    setBusy(true);
    setError(null);
    try {
      const res = await getTags();
      const tags = res.ok ? (res.data.items ?? []) : all;
      if (res.ok) setAll(tags);

      const existing = findReusableTag(tags, text);
      if (existing) {
        await add(existing.id);
        return;
      }

      await createLiteral(text, tags);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={boxRef}>
      <div className="wa chips">
        {selected.map((tag) => (
          <span key={tag.id} className="chip">
            {tagName(tag)}
            <button
              type="button"
              className="x"
              aria-label={`${tagName(tag)} 삭제`}
              disabled={busy}
              onClick={() => void remove(tag.id)}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div className="relative mt-2">
        <input
          className="i"
          value={q}
          disabled={busy}
          placeholder="태그를 치고 엔터"
          onChange={(event) => {
            setQ(event.target.value);
            setError(null);
            setOpenSuggest(true);
          }}
          onFocus={() => setOpenSuggest(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleEnter();
            }
            if (event.key === "Escape") {
              resetInput();
            }
          }}
        />
        {openSuggest && needle && filtered.length > 0 ? (
          <ul className="absolute left-0 z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {filtered.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  disabled={busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickExisting(tag)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  <span>{tagName(tag)}</span>
                  <span className="text-slate-400">{tag.id}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
