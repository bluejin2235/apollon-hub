import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser, wikiMissingResponse, wikiWriteForbiddenForWebsiteTester } from "@/lib/wiki/api";
import { loadWikiMenu } from "@/lib/wiki/menus";
import { notifyWikiRuleChange } from "@/lib/wiki/notify";
import {
  canDeleteWiki,
  canEditWikiMenu,
  canToggleWikiVisibility,
  canViewWikiDoc
} from "@/lib/wiki/permissions";
import { parseRelated, parseSections } from "@/lib/wiki/sections";
import {
  deleteWikiDoc,
  loadWikiDoc,
  revertWikiDoc,
  saveWikiDoc
} from "@/lib/wiki/store";
import { wikiCanonicalSlug, wikiDocPath } from "@/lib/wiki/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  const { slug } = await ctx.params;
  try {
    const { doc, wikiReady, tableReady } = await loadWikiDoc(gate.admin, slug);
    if (!tableReady) {
      return NextResponse.json(
        { error: "luna_library 테이블이 없습니다." },
        { status: 503 }
      );
    }
    if (!doc || !canViewWikiDoc(doc, gate.isAdmin)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const menu = await loadWikiMenu(gate.admin, doc.menu_slug);
    return NextResponse.json({
      item: doc,
      menu,
      canonical_slug: wikiCanonicalSlug(doc.slug),
      wiki_ready: wikiReady,
      is_admin: gate.isAdmin,
      can_edit: canEditWikiMenu(menu, gate.isAdmin) && !gate.isWebsiteTester,
      can_delete: canDeleteWiki(gate.isAdmin),
      can_toggle_visibility: canToggleWikiVisibility(gate.isAdmin),
      can_move: true
    });
  } catch (err) {
    console.error("[wiki/docs] GET one", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  const writeBlocked = wikiWriteForbiddenForWebsiteTester(gate);
  if (writeBlocked) return writeBlocked;
  const { slug } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const loaded = await loadWikiDoc(gate.admin, slug);
    if (!loaded.doc) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const doc = loaded.doc;
    if (!canViewWikiDoc(doc, gate.isAdmin)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!loaded.wikiReady) return wikiMissingResponse();

    const menu = await loadWikiMenu(gate.admin, doc.menu_slug);
    const togglingVisibility = typeof body.visible_to_staff === "boolean";
    if (togglingVisibility && !canToggleWikiVisibility(gate.isAdmin)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const nextMenuSlug =
      typeof body.menu_slug === "string" ? body.menu_slug.trim() : "";
    const moving = Boolean(nextMenuSlug) && nextMenuSlug !== doc.menu_slug;

    const editingContent =
      body.title !== undefined ||
      body.kind !== undefined ||
      body.summary !== undefined ||
      body.related !== undefined ||
      body.sections !== undefined ||
      body.is_active !== undefined ||
      typeof body.revert_to === "number";

    if ((editingContent || moving) && !canEditWikiMenu(menu, gate.isAdmin)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (moving) {
      const dest = await loadWikiMenu(gate.admin, nextMenuSlug);
      if (!dest) {
        return NextResponse.json({ error: "메뉴가 없습니다." }, { status: 400 });
      }
      if (dest.editable_by === "admin" && !gate.isAdmin) {
        return NextResponse.json(
          { error: "관리자 메뉴로 옮기는 것은 슈퍼관리자만 할 수 있습니다." },
          { status: 403 }
        );
      }
    }

    const revertTo =
      typeof body.revert_to === "number" ? body.revert_to : null;
    const destMenu = moving
      ? await loadWikiMenu(gate.admin, nextMenuSlug)
      : menu;
    const moveNote = moving
      ? `메뉴를 「${destMenu?.name ?? nextMenuSlug}」으로 옮김`
      : undefined;

    const saved =
      revertTo != null
        ? await revertWikiDoc(gate.admin, doc.slug, revertTo, gate.user.id)
        : await saveWikiDoc(
            gate.admin,
            doc.slug,
            {
              title: typeof body.title === "string" ? body.title : undefined,
              kind: typeof body.kind === "string" ? body.kind.trim() : undefined,
              summary:
                typeof body.summary === "string" ? body.summary : undefined,
              related: body.related !== undefined ? parseRelated(body.related) : undefined,
              sections:
                body.sections !== undefined ? parseSections(body.sections) : undefined,
              menu_slug: moving ? nextMenuSlug : undefined,
              is_active:
                typeof body.is_active === "boolean" ? body.is_active : undefined,
              visible_to_staff: togglingVisibility
                ? body.visible_to_staff === true
                : undefined,
              change_note:
                (typeof body.change_note === "string" ? body.change_note : undefined) ||
                moveNote
            },
            gate.user.id
          );

    if (saved.menu_slug === "rules") {
      await notifyWikiRuleChange(gate.admin, {
        slug: saved.slug,
        title: saved.title,
        editorName: saved.updated_by_name ?? "누군가"
      });
    }

    const savedMenu = await loadWikiMenu(gate.admin, saved.menu_slug);
    return NextResponse.json({
      item: saved,
      menu: savedMenu,
      can_edit: true,
      can_delete: canDeleteWiki(gate.isAdmin),
      notice: moving
        ? `옮겼습니다. 주소(${wikiDocPath(saved.slug)})는 바뀌지 않습니다.`
        : "저장하면 루나가 바로 이 내용을 씁니다"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "save failed";
    if (message.includes("마이그레이션")) return wikiMissingResponse();
    console.error("[wiki/docs] PATCH", err);
    const status = message === "not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  if (!canDeleteWiki(gate.isAdmin)) {
    return NextResponse.json({ error: "슈퍼관리자만 삭제할 수 있습니다." }, { status: 403 });
  }
  const { slug } = await ctx.params;
  try {
    const loaded = await loadWikiDoc(gate.admin, slug);
    if (!loaded.doc) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    await deleteWikiDoc(gate.admin, loaded.doc.slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[wiki/docs] DELETE", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 }
    );
  }
}
