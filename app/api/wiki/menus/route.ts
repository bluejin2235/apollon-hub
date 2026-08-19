import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser } from "@/lib/wiki/api";
import {
  countDocsByMenu,
  loadWikiMenus,
  reorderWikiMenus,
  saveWikiMenu
} from "@/lib/wiki/menus";
import { WIKI_RESERVED_SLUGS, WIKI_SLUG_RE, type WikiMenuEditableBy } from "@/lib/wiki/types";

export const runtime = "nodejs";

function makeMenuSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (WIKI_SLUG_RE.test(ascii) && !WIKI_RESERVED_SLUGS.has(ascii)) return ascii;
  return `m${Date.now().toString(36)}`;
}

export async function GET(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  if (!gate.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const [menus, counts] = await Promise.all([
      loadWikiMenus(gate.admin, { includeHidden: true }),
      countDocsByMenu(gate.admin, { isSuperAdmin: true })
    ]);
    return NextResponse.json({
      items: menus.map((m) => ({ ...m, doc_count: counts.get(m.slug) ?? 0 }))
    });
  } catch (err) {
    console.error("[wiki/menus] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  if (!gate.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "이름이 필요합니다." }, { status: 400 });
  }
  const editable_by: WikiMenuEditableBy =
    body.editable_by === "admin" ? "admin" : "all";
  let slug =
    typeof body.slug === "string" && body.slug.trim()
      ? body.slug.trim().toLowerCase()
      : makeMenuSlug(name);
  if (!WIKI_SLUG_RE.test(slug) || WIKI_RESERVED_SLUGS.has(slug)) {
    slug = makeMenuSlug(name);
  }
  try {
    const existing = await loadWikiMenus(gate.admin, { includeHidden: true });
    const maxOrder = existing.reduce((n, m) => Math.max(n, m.sort_order), 0);
    const menu = await saveWikiMenu(gate.admin, {
      slug,
      name,
      description: typeof body.description === "string" ? body.description.trim() : "",
      editable_by,
      sort_order: maxOrder + 10,
      is_active: true
    });
    return NextResponse.json({ item: menu });
  } catch (err) {
    console.error("[wiki/menus] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  if (!gate.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (Array.isArray(body.order)) {
    const slugs = body.order.filter((s): s is string => typeof s === "string");
    try {
      await reorderWikiMenus(gate.admin, slugs);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[wiki/menus] reorder", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "save failed" },
        { status: 500 }
      );
    }
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    return NextResponse.json({ error: "slug 가 필요합니다." }, { status: 400 });
  }
  try {
    const current = (await loadWikiMenus(gate.admin, { includeHidden: true })).find(
      (m) => m.slug === slug
    );
    if (!current) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // 숨기기는 문서가 있어도 가능. 삭제는 별도 DELETE 에서 문서 수 검사.
    const menu = await saveWikiMenu(gate.admin, {
      slug,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name,
      description:
        typeof body.description === "string" ? body.description : current.description,
      editable_by:
        body.editable_by === "admin" || body.editable_by === "all"
          ? body.editable_by
          : current.editable_by,
      sort_order: current.sort_order,
      is_active:
        typeof body.is_active === "boolean" ? body.is_active : current.is_active
    });
    return NextResponse.json({ item: menu });
  } catch (err) {
    console.error("[wiki/menus] PATCH", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save failed" },
      { status: 500 }
    );
  }
}
