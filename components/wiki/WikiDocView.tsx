"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WikiDocSections } from "@/components/wiki/WikiDocSections";
import { wikiFetch, WikiApiError } from "@/components/wiki/wiki-fetch";
import { useWikiRoutes } from "@/components/wiki/wiki-routes-context";
import { WikiStaffHiddenMark } from "@/components/wiki/WikiStaffHiddenMark";
import { formatWikiStamp, W } from "@/components/wiki/wiki-theme";
import { WIKI_RULES_LOCK_MESSAGE } from "@/lib/wiki/permissions";
import {
  wikiMakePrompt,
  type WikiDoc,
  type WikiMenu,
  type WikiRelated
} from "@/lib/wiki/types";

type DocPayload = {
  item?: WikiDoc;
  menu?: WikiMenu | null;
  canonical_slug?: string;
  can_edit?: boolean;
  can_delete?: boolean;
  is_admin?: boolean;
  wiki_ready?: boolean;
  notice?: string;
};

type NavPayload = { menus?: WikiMenu[]; is_admin?: boolean };

export function WikiDocView({ slug }: { slug: string }) {
  const routes = useWikiRoutes();
  const router = useRouter();
  const [doc, setDoc] = useState<WikiDoc | null>(null);
  const [menu, setMenu] = useState<WikiMenu | null>(null);
  const [menus, setMenus] = useState<WikiMenu[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMissing(false);
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`
      );
      if (!json.item) {
        setDoc(null);
        setMissing(true);
        return;
      }
      if (json.canonical_slug && json.canonical_slug !== slug) {
        router.replace(routes.docPath(json.canonical_slug));
        return;
      }
      setDoc(json.item);
      setMenu(json.menu ?? null);
      setCanEdit(json.can_edit === true);
      setCanDelete(json.can_delete === true);
      setIsAdmin(json.is_admin === true);
      setMoveTo(json.item.menu_slug);
    } catch (err) {
      setDoc(null);
      if (err instanceof WikiApiError && err.status === 404) {
        setMissing(true);
        setError("");
      } else {
        setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }, [slug, router, routes]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void wikiFetch<NavPayload>("/api/wiki/nav")
      .then((n) => setMenus(n.menus ?? []))
      .catch(() => undefined);
  }, []);

  async function move() {
    if (!doc || !moveTo || moveTo === doc.menu_slug) {
      setMoving(false);
      return;
    }
    setBusy(true);
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(doc.slug)}`,
        { method: "PATCH", body: JSON.stringify({ menu_slug: moveTo }) }
      );
      if (json.item) setDoc(json.item);
      if (json.menu) setMenu(json.menu);
      setNotice(json.notice || "옮겼습니다. 주소는 바뀌지 않습니다.");
      setMoving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "옮기지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!doc) return;
    setBusy(true);
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(doc.slug)}`,
        { method: "PATCH", body: JSON.stringify({ is_active: false, change_note: "비활성" }) }
      );
      if (json.item) setDoc(json.item);
      setNotice("비활성으로 두었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!canDelete || !doc) return;
    if (!window.confirm("이 문서를 삭제할까요?")) return;
    setBusy(true);
    try {
      await wikiFetch(`/api/wiki/docs/${encodeURIComponent(doc.slug)}`, {
        method: "DELETE"
      });
      router.push(routes.listPath(doc.menu_slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다.");
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
  if (missing) {
    return (
      <div className="px-[22px] py-10">
        <p className="text-[12px] font-bold" style={{ color: W.faint }}>
          404
        </p>
        <h1 className="mt-1 text-[22px] font-extrabold">문서를 찾을 수 없습니다</h1>
        <Link href={routes.rootHref} className="mt-4 inline-block text-[13px] font-semibold" style={{ color: W.luna }}>
          {routes.rootLabel}로
        </Link>
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

  const locked = !canEdit;
  const listHref = routes.listPath(doc.menu_slug);
  const moveChoices = routes.hideMoveMenu
    ? []
    : menus.filter((m) => m.is_active || isAdmin);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
      <div className="mb-2 text-[11px]" style={{ color: W.faint }}>
        <Link href={routes.rootHref} style={{ color: W.luna }}>
          {routes.rootLabel}
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
        {doc.title}
      </div>

      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">
        {doc.title}
        {doc.visible_to_staff === false ? (
          <span className="ml-1.5 align-[6px] inline-flex">
            <WikiStaffHiddenMark />
          </span>
        ) : null}
        {menu?.editable_by === "admin" ? (
          <span
            className="ml-1.5 align-[6px] rounded-[9px] px-2 py-[3px] text-[10px] font-bold"
            style={{ background: W.lockBg, color: W.lock }}
          >
            🔒 관리자만
          </span>
        ) : null}
      </h1>
      <p className="mb-3 mt-1 text-[11px]" style={{ color: W.faint }}>
        {formatWikiStamp(doc.updated_at, doc.updated_by_name, doc.updated_by)} · {doc.version}판
        {typeof doc.use_count === "number" ? ` · 루나가 ${doc.use_count}번 사용` : ""}
      </p>

      <div className="mb-[17px] flex items-end gap-0.5 border-b" style={{ borderColor: W.line }}>
        <TabLink on href={routes.docPath(doc.slug)}>
          읽기
        </TabLink>
        {canEdit ? (
          <TabLink href={routes.docEditPath(doc.slug)}>고치기</TabLink>
        ) : null}
        <TabLink href={routes.docHistoryPath(doc.slug)}>변경 이력</TabLink>
        {canEdit && !routes.hideMoveMenu ? (
          <div className="ml-auto pb-[5px]">
            <button
              type="button"
              className="rounded-lg border px-[9px] py-1 text-[10.5px] font-semibold"
              style={{ borderColor: W.line }}
              onClick={() => setMoving((v) => !v)}
            >
              다른 메뉴로 옮기기
            </button>
          </div>
        ) : null}
      </div>

      {locked && menu?.editable_by === "admin" ? (
        <div
          className="mb-[15px] rounded-[10px] border px-[13px] py-2.5 text-[11.5px]"
          style={{ background: W.lockBg, borderColor: "#EADFC0", color: W.lock }}
        >
          {WIKI_RULES_LOCK_MESSAGE}
        </div>
      ) : null}
      {error ? (
        <p className="mb-3 text-[12px]" style={{ color: W.del }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 text-[12px]" style={{ color: W.lunaInk }}>
          {notice}
        </p>
      ) : null}

      {moving ? (
        <div className="mb-4 rounded-[11px] border px-4 py-3.5" style={{ borderColor: W.line }}>
          <p className="text-[13px] font-bold">어느 메뉴로 옮길까요?</p>
          <p className="text-[11px]" style={{ color: W.faint }}>
            지금은 「{menu?.name}」에 있습니다
          </p>
          <div className="my-2 flex flex-wrap gap-1.5">
            {moveChoices.map((m) => (
              <button
                key={m.slug}
                type="button"
                onClick={() => setMoveTo(m.slug)}
                className="rounded-[9px] border px-3 py-1.5 text-[11.5px]"
                style={
                  moveTo === m.slug
                    ? { background: W.luna, color: "#fff", borderColor: W.luna, fontWeight: 600 }
                    : { borderColor: W.line }
                }
              >
                {m.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void move()}
              className="rounded-[9px] px-3 py-[7px] text-[11.5px] font-semibold text-white"
              style={{ background: W.luna }}
            >
              옮기기
            </button>
            <button
              type="button"
              onClick={() => setMoving(false)}
              className="rounded-[9px] border px-3 py-[7px] text-[11.5px] font-semibold"
              style={{ borderColor: W.line }}
            >
              취소
            </button>
            <span className="ml-auto text-[10.5px]" style={{ color: W.faint }}>
              주소({routes.docPath(doc.slug)})는 바뀌지 않습니다
            </span>
          </div>
        </div>
      ) : null}

      <WikiDocSections
        sections={doc.sections}
        canEdit={canEdit}
        editHref={(sectionId) => routes.docEditPath(doc.slug, sectionId)}
      />

      <div className="mt-[22px] border-t pt-[13px]" style={{ borderColor: W.line }}>
        {doc.related.length > 0 ? (
          <p className="mb-1.5 text-[11.5px]" style={{ color: W.sub }}>
            <b className="font-semibold" style={{ color: W.ink }}>
              관련
            </b>{" "}
            {doc.related.map((r) => (
              <RelatedLink key={`${r.kind}-${r.title}`} item={r} />
            ))}
          </p>
        ) : null}
        {!routes.hideLunaPrompt && menu?.editable_by !== "admin" ? (
          <Link
            href={`/luna?q=${encodeURIComponent(wikiMakePrompt(doc.title))}`}
            prefetch={false}
            className="mt-2 inline-block rounded-[9px] border px-[9px] py-1 text-[10.5px] font-semibold"
            style={{ borderColor: W.line, color: "#33363c" }}
          >
            루나에게 이걸로 만들어달라기
          </Link>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {canEdit ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void deactivate()}
              className="rounded-[9px] border px-3 py-1.5 text-[11px] font-semibold"
              style={{ borderColor: W.line, color: W.sub }}
            >
              비활성
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="rounded-[9px] px-3 py-1.5 text-[11px] font-semibold"
              style={{ background: W.delBg, color: W.del }}
            >
              삭제
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TabLink({
  href,
  on,
  disabled,
  children
}: {
  href: string;
  on?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        className="px-[14px] py-2 text-[12.5px] opacity-35"
        style={{ color: W.sub }}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="px-[14px] py-2 text-[12.5px]"
      style={{
        color: on ? W.ink : W.sub,
        fontWeight: on ? 700 : 400,
        borderBottom: on ? `2px solid ${W.luna}` : "2px solid transparent"
      }}
    >
      {children}
    </Link>
  );
}

function RelatedLink({ item }: { item: WikiRelated }) {
  const routes = useWikiRoutes();
  const href =
    item.kind === "term"
      ? routes.rootHref
      : item.slug
        ? routes.docPath(item.slug)
        : routes.rootHref;
  return (
    <Link href={href} className="mr-[9px]" style={{ color: W.luna }}>
      {item.title}
    </Link>
  );
}
