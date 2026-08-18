import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser, wikiMissingResponse } from "@/lib/wiki/api";
import {
  canEditWikiCategory,
  canToggleWikiVisibility,
  filterVisibleWikiDocs
} from "@/lib/wiki/permissions";
import { emptySection } from "@/lib/wiki/sections";
import { createWikiDoc, listItems, loadWikiDocs } from "@/lib/wiki/store";
import {
  isWikiCategory,
  makeWikiSlug,
  normalizeWikiKind,
  WIKI_SLUG_RE,
  type WikiCategory
} from "@/lib/wiki/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  const categoryRaw = request.nextUrl.searchParams.get("category") ?? "";
  const category = isWikiCategory(categoryRaw) ? categoryRaw : undefined;
  const includeInactive =
    request.nextUrl.searchParams.get("include_inactive") === "1" &&
    gate.isAdmin;
  try {
    const { items, wikiReady, tableReady } = await loadWikiDocs(gate.admin, {
      category,
      activeOnly: !includeInactive
    });
    if (!tableReady) {
      return NextResponse.json(
        { error: "luna_library 테이블이 없습니다.", items: [], table_ready: false },
        { status: 503 }
      );
    }
    const visible = filterVisibleWikiDocs(items, gate.isAdmin);
    return NextResponse.json({
      items: listItems(visible),
      wiki_ready: wikiReady,
      table_ready: true,
      is_admin: gate.isAdmin,
      can_edit: category ? canEditWikiCategory(category, gate.isAdmin) : true,
      can_toggle_visibility: canToggleWikiVisibility(gate.isAdmin)
    });
  } catch (err) {
    console.error("[wiki/docs] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const categoryRaw = typeof body.category === "string" ? body.category : "";
  if (!isWikiCategory(categoryRaw)) {
    return NextResponse.json({ error: "category 가 올바르지 않습니다." }, { status: 400 });
  }
  const category: WikiCategory = categoryRaw;
  if (!canEditWikiCategory(category, gate.isAdmin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "제목이 필요합니다." }, { status: 400 });
  }
  const kindRaw = typeof body.kind === "string" ? body.kind.trim() : "";
  const kind = normalizeWikiKind(category, kindRaw);
  let slug =
    typeof body.slug === "string" && body.slug.trim()
      ? body.slug.trim().toLowerCase()
      : makeWikiSlug(title);
  if (!WIKI_SLUG_RE.test(slug)) slug = makeWikiSlug(title);
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const firstTitle =
    typeof body.section_title === "string" && body.section_title.trim()
      ? body.section_title.trim()
      : "본문";
  const firstBody = typeof body.section_body === "string" ? body.section_body : "";

  try {
    const doc = await createWikiDoc(gate.admin, {
      slug,
      title,
      category,
      kind,
      summary,
      sections: [{ ...emptySection(firstTitle), body: firstBody }],
      userId: gate.user.id
    });
    return NextResponse.json({ item: doc });
  } catch (err) {
    const message = err instanceof Error ? err.message : "save failed";
    if (message.includes("duplicate") || message.includes("unique")) {
      return NextResponse.json({ error: "같은 slug 가 이미 있습니다." }, { status: 409 });
    }
    if (message.includes("마이그레이션") || message.includes("schema cache")) {
      return wikiMissingResponse();
    }
    console.error("[wiki/docs] POST", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
