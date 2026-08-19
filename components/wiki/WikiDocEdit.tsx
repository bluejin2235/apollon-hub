"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WikiDiffView } from "@/components/wiki/WikiDiffView";
import { WikiFullEditor } from "@/components/wiki/WikiFullEditor";
import { WikiSectionEditor } from "@/components/wiki/WikiSectionEditor";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { W } from "@/components/wiki/wiki-theme";
import {
  wikiDocPath,
  wikiListPath,
  type WikiDoc,
  type WikiMenu
} from "@/lib/wiki/types";

type DocPayload = {
  item?: WikiDoc;
  menu?: WikiMenu | null;
  canonical_slug?: string;
  can_edit?: boolean;
  notice?: string;
};

export function WikiDocEdit({ slug }: { slug: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const sectionId = search.get("section");
  const [doc, setDoc] = useState<WikiDoc | null>(null);
  const [menu, setMenu] = useState<WikiMenu | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [showDiff, setShowDiff] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`
      );
      if (!json.item) {
        setDoc(null);
        return;
      }
      if (json.canonical_slug && json.canonical_slug !== slug) {
        router.replace(`${wikiDocPath(json.canonical_slug)}/edit`);
        return;
      }
      setDoc(json.item);
      setMenu(json.menu ?? null);
      setCanEdit(json.can_edit === true);
      const sec = json.item.sections.find((s) => s.id === sectionId);
      if (sec) {
        setDraftBody(sec.body);
        setDraftTitle(sec.title);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [slug, sectionId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const original = useMemo(
    () => doc?.sections.find((s) => s.id === sectionId) ?? null,
    [doc, sectionId]
  );

  async function saveSection() {
    if (!doc || !sectionId) return;
    setBusy(true);
    setError("");
    try {
      const sections = doc.sections.map((s) =>
        s.id === sectionId ? { ...s, title: draftTitle, body: draftBody } : s
      );
      await wikiFetch<DocPayload>(`/api/wiki/docs/${encodeURIComponent(doc.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ sections, change_note: changeNote })
      });
      router.push(wikiDocPath(doc.slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAll(next: {
    title: string;
    sections: WikiDoc["sections"];
    note: string;
  }) {
    if (!doc) return;
    setBusy(true);
    setError("");
    try {
      await wikiFetch<DocPayload>(`/api/wiki/docs/${encodeURIComponent(doc.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: next.title,
          sections: next.sections,
          change_note: next.note
        })
      });
      router.push(wikiDocPath(doc.slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="px-[22px] py-6 text-[12px]" style={{ color: W.faint }}>
        불러오는 중…
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="px-[22px] py-6 text-[12px]" style={{ color: W.del }}>
        {error || "없습니다."}
      </div>
    );
  }
  if (!canEdit) {
    return (
      <div className="px-[22px] py-6 text-[12px]" style={{ color: W.lock }}>
        이 문서는 고칠 수 없습니다.
      </div>
    );
  }

  const listHref = wikiListPath(doc.menu_slug);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
      <div className="mb-2 text-[11px]" style={{ color: W.faint }}>
        <Link href="/wiki/terms" style={{ color: W.luna }}>
          Wikipedia
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        <Link href={listHref} style={{ color: W.luna }}>
          {menu?.name ?? doc.menu_slug}
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        <Link href={wikiDocPath(doc.slug)} style={{ color: W.luna }}>
          {doc.title}
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        {sectionId ? "고치기" : "전체 고치기"}
      </div>

      {sectionId && original ? (
        <>
          <h1 className="text-[17px] font-extrabold">{doc.title}</h1>
          <p className="mb-3 mt-1 text-[11px]" style={{ color: W.faint }}>
            이 절만 고치는 중 · 다른 부분은 그대로 둡니다
          </p>
          {error ? (
            <p className="mb-2 text-[12px]" style={{ color: W.del }}>
              {error}
            </p>
          ) : null}
          {showDiff ? (
            <div className="mb-3">
              <WikiDiffView before={original.body} after={draftBody} />
            </div>
          ) : null}
          <WikiSectionEditor
            heading={original.title}
            headingValue={draftTitle}
            onHeadingChange={setDraftTitle}
            value={draftBody}
            onChange={setDraftBody}
            onCancel={() => router.push(wikiDocPath(doc.slug))}
            changeNote={changeNote}
            onChangeNote={setChangeNote}
            onSave={() => void saveSection()}
            onToggleDiff={() => setShowDiff((v) => !v)}
            showDiff={showDiff}
            busy={busy}
            slug={doc.slug}
          />
        </>
      ) : (
        <>
          <div className="mb-[17px] flex gap-0.5 border-b" style={{ borderColor: W.line }}>
            <Link
              href={wikiDocPath(doc.slug)}
              className="px-[14px] py-2 text-[12.5px]"
              style={{ color: W.sub }}
            >
              읽기
            </Link>
            <span
              className="px-[14px] py-2 text-[12.5px] font-bold"
              style={{ color: W.ink, borderBottom: `2px solid ${W.luna}` }}
            >
              고치기
            </span>
            <Link
              href={`${wikiDocPath(doc.slug)}/history`}
              className="px-[14px] py-2 text-[12.5px]"
              style={{ color: W.sub }}
            >
              변경 이력
            </Link>
          </div>
          {error ? (
            <p className="mb-2 text-[12px]" style={{ color: W.del }}>
              {error}
            </p>
          ) : null}
          <WikiFullEditor
            title={doc.title}
            sections={doc.sections}
            slug={doc.slug}
            busy={busy}
            onSave={(next) => void saveAll(next)}
            onCancel={() => router.push(wikiDocPath(doc.slug))}
          />
        </>
      )}
    </div>
  );
}
