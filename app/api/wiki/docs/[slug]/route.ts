import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser, wikiMissingResponse } from "@/lib/wiki/api";
import { notifyWikiRuleChange } from "@/lib/wiki/notify";
import {
  canDeleteWiki,
  canEditWikiCategory
} from "@/lib/wiki/permissions";
import { parseRelated, parseSections } from "@/lib/wiki/sections";
import {
  deleteWikiDoc,
  loadWikiDoc,
  revertWikiDoc,
  saveWikiDoc
} from "@/lib/wiki/store";

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
    if (!doc) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({
      item: doc,
      wiki_ready: wikiReady,
      is_admin: gate.isAdmin,
      can_edit: canEditWikiCategory(doc.category, gate.isAdmin),
      can_delete: canDeleteWiki(gate.isAdmin)
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
    if (!canEditWikiCategory(doc.category, gate.isAdmin)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!loaded.wikiReady) return wikiMissingResponse();

    const revertTo =
      typeof body.revert_to === "number" ? body.revert_to : null;
    const saved =
      revertTo != null
        ? await revertWikiDoc(gate.admin, slug, revertTo, gate.user.id)
        : await saveWikiDoc(
            gate.admin,
            slug,
            {
              title: typeof body.title === "string" ? body.title : undefined,
              kind: typeof body.kind === "string" ? body.kind : undefined,
              summary:
                typeof body.summary === "string" ? body.summary : undefined,
              related: body.related !== undefined ? parseRelated(body.related) : undefined,
              sections:
                body.sections !== undefined ? parseSections(body.sections) : undefined,
              is_active:
                typeof body.is_active === "boolean" ? body.is_active : undefined,
              change_note:
                typeof body.change_note === "string" ? body.change_note : undefined
            },
            gate.user.id
          );

    if (saved.category === "rules") {
      await notifyWikiRuleChange(gate.admin, {
        slug: saved.slug,
        title: saved.title,
        editorName: saved.updated_by_name ?? "누군가"
      });
    }

    return NextResponse.json({
      item: saved,
      can_edit: true,
      can_delete: canDeleteWiki(gate.isAdmin),
      notice: "저장하면 루나가 바로 이 내용을 씁니다"
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
    await deleteWikiDoc(gate.admin, slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[wiki/docs] DELETE", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 }
    );
  }
}
