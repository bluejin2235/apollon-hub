"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { WikiDiffView } from "@/components/wiki/WikiDiffView";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { useWikiRoutes } from "@/components/wiki/wiki-routes-context";
import { wikiEditorLabel, W } from "@/components/wiki/wiki-theme";
import { formatDiffCounts } from "@/lib/wiki/diff";
import { sectionsPlain } from "@/lib/wiki/sections";
import {
  type WikiDoc,
  type WikiHistoryEntry,
  type WikiMenu
} from "@/lib/wiki/types";

type DocPayload = {
  item?: WikiDoc;
  menu?: WikiMenu | null;
  can_edit?: boolean;
};

export function WikiDocHistory({ slug }: { slug: string }) {
  const routes = useWikiRoutes();
  const [doc, setDoc] = useState<WikiDoc | null>(null);
  const [menu, setMenu] = useState<WikiMenu | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickA, setPickA] = useState<number | null>(null);
  const [pickB, setPickB] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`
      );
      setDoc(json.item ?? null);
      setMenu(json.menu ?? null);
      setCanEdit(json.can_edit === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revertTo(version: number) {
    if (!doc) return;
    if (!window.confirm(`v${version}으로 되돌릴까요?`)) return;
    setBusy(true);
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(doc.slug)}`,
        { method: "PATCH", body: JSON.stringify({ revert_to: version }) }
      );
      if (json.item) setDoc(json.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "되돌리지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!doc) {
    return (
      <div className="px-[22px] py-6 text-[12px]" style={{ color: error ? W.del : W.faint }}>
        {error || "불러오는 중…"}
      </div>
    );
  }

  const history = doc.history;
  const left = history.find((h) => h.version === pickA);
  const right = history.find((h) => h.version === pickB);

  function toggle(version: number) {
    if (pickA === version) {
      setPickA(null);
      return;
    }
    if (pickB === version) {
      setPickB(null);
      return;
    }
    if (pickA == null) {
      setPickA(version);
      return;
    }
    if (pickB == null) {
      setPickB(version);
      return;
    }
    setPickA(pickB);
    setPickB(version);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
      <div className="mb-2 text-[11px]" style={{ color: W.faint }}>
        <Link href={routes.rootHref} style={{ color: W.luna }}>
          {routes.rootLabel}
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        <Link href={routes.listPath(doc.menu_slug)} style={{ color: W.luna }}>
          {menu?.name ?? doc.menu_slug}
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        <Link href={routes.docPath(doc.slug)} style={{ color: W.luna }}>
          {doc.title}
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        변경 이력
      </div>
      <div className="mb-[17px] flex gap-0.5 border-b" style={{ borderColor: W.line }}>
        <Link href={routes.docPath(doc.slug)} className="px-[14px] py-2 text-[12.5px]" style={{ color: W.sub }}>
          읽기
        </Link>
        <Link
          href={routes.docEditPath(doc.slug)}
          className="px-[14px] py-2 text-[12.5px]"
          style={{ color: W.sub }}
        >
          고치기
        </Link>
        <span
          className="px-[14px] py-2 text-[12.5px] font-bold"
          style={{ color: W.ink, borderBottom: `2px solid ${W.luna}` }}
        >
          변경 이력
        </span>
      </div>
      {error ? (
        <p className="mb-2 text-[12px]" style={{ color: W.del }}>
          {error}
        </p>
      ) : null}
      <p className="mb-3 text-[11px]" style={{ color: W.faint }}>
        왼쪽 동그라미로 두 판을 고르면 비교합니다. 되돌린 것도 새 판으로 남습니다.
      </p>
      <div className="mb-4 space-y-1">
        {history.map((h: WikiHistoryEntry) => {
          const on = h.version === pickA || h.version === pickB;
          return (
            <div
              key={h.version}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px]"
              style={{ background: on ? W.lunaSoft : "transparent" }}
            >
              <button
                type="button"
                aria-label={`v${h.version} 비교에 넣기`}
                onClick={() => toggle(h.version)}
                className="h-[14px] w-[14px] shrink-0 rounded-full border"
                style={{
                  borderColor: on ? W.luna : W.line,
                  background: on ? W.luna : W.panel
                }}
              />
              <span className="w-10 font-bold">v{h.version}</span>
              <span className="font-semibold">{wikiEditorLabel(h.by, h.by_name)}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: W.sub }}>
                {h.summary || "수정"}
              </span>
              <span style={{ color: W.faint }}>{formatDiffCounts(h.added, h.removed)}</span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revertTo(h.version)}
                  className="text-[11px]"
                  style={{ color: W.luna }}
                >
                  되돌리기
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {left && right ? (
        <WikiDiffView
          before={sectionsPlain(left.sections)}
          after={sectionsPlain(right.sections)}
        />
      ) : null}
    </div>
  );
}
