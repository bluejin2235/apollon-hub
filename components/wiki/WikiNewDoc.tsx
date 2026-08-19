"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { W } from "@/components/wiki/wiki-theme";
import { wikiDocPath, type WikiDoc, type WikiMenu } from "@/lib/wiki/types";

type NavPayload = { menus?: WikiMenu[] };
type CreatePayload = { item?: WikiDoc };

export function WikiNewDoc() {
  const router = useRouter();
  const search = useSearchParams();
  const preset = search.get("menu") ?? "";
  const [menus, setMenus] = useState<WikiMenu[]>([]);
  const [menuSlug, setMenuSlug] = useState(preset);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [sectionTitle, setSectionTitle] = useState("본문");
  const [sectionBody, setSectionBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void wikiFetch<NavPayload>("/api/wiki/nav")
      .then((n) => {
        const creatable = (n.menus ?? []).filter(
          (m) => m.is_active && m.editable_by !== "admin"
        );
        setMenus(creatable);
        setMenuSlug((cur) =>
          cur && creatable.some((m) => m.slug === cur)
            ? cur
            : creatable[0]?.slug ?? ""
        );
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const json = await wikiFetch<CreatePayload>("/api/wiki/docs", {
        method: "POST",
        body: JSON.stringify({
          menu_slug: menuSlug,
          title,
          summary,
          section_title: sectionTitle,
          section_body: sectionBody
        })
      });
      if (json.item) router.push(wikiDocPath(json.item.slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "만들지 못했습니다.");
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
        새 문서
      </div>
      <h1 className="text-[19px] font-extrabold">새 문서</h1>
      <p className="mb-4 mt-1 text-[11px]" style={{ color: W.faint }}>
        누구나 고칠 수 있는 메뉴에만 만들 수 있습니다. 규정으로 옮기는 것은 슈퍼관리자가 합니다.
      </p>
      {error ? (
        <p className="mb-3 text-[12px]" style={{ color: W.del }}>
          {error}
        </p>
      ) : null}
      <label className="mb-3 block text-[12px]" style={{ color: W.sub }}>
        메뉴
        <select
          value={menuSlug}
          onChange={(e) => setMenuSlug(e.target.value)}
          className="mt-1 w-full max-w-md rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: W.line }}
        >
          {menus.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="mb-3 block text-[12px]" style={{ color: W.sub }}>
        제목
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full max-w-md rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: W.line }}
          autoFocus
        />
      </label>
      <label className="mb-3 block text-[12px]" style={{ color: W.sub }}>
        한 줄 설명
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="mt-1 w-full max-w-md rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: W.line }}
        />
      </label>
      <label className="mb-3 block text-[12px]" style={{ color: W.sub }}>
        첫 절 제목
        <input
          value={sectionTitle}
          onChange={(e) => setSectionTitle(e.target.value)}
          className="mt-1 w-full max-w-md rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: W.line }}
        />
      </label>
      <label className="mb-4 block text-[12px]" style={{ color: W.sub }}>
        첫 절 내용
        <textarea
          value={sectionBody}
          onChange={(e) => setSectionBody(e.target.value)}
          className="mt-1 min-h-[120px] w-full max-w-md resize-none overflow-hidden rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: W.line }}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !title.trim() || !menuSlug}
          onClick={() => void save()}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: W.luna }}
        >
          만들기
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg px-3 py-1.5 text-sm"
          style={{ color: W.sub }}
        >
          취소
        </button>
      </div>
    </div>
  );
}
