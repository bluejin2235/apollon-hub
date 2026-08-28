import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser } from "@/lib/wiki/api";
import { truncateGuideSectionBody } from "@/lib/wiki/guide-section-preview";
import { canViewWikiDoc } from "@/lib/wiki/permissions";
import { loadWikiDoc } from "@/lib/wiki/store";

export const runtime = "nodejs";

const serverCache = new Map<
  string,
  { at: number; payload: Record<string, unknown> }
>();
const SERVER_CACHE_MS = 60_000;

export async function GET(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;

  const slug = request.nextUrl.searchParams.get("slug")?.trim();
  const sectionId = request.nextUrl.searchParams.get("id")?.trim();
  if (!slug || !sectionId) {
    return NextResponse.json(
      { error: "slug and id are required" },
      { status: 400 }
    );
  }

  const cacheKey = `${slug}:${sectionId}`;
  const cached = serverCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SERVER_CACHE_MS) {
    return NextResponse.json(cached.payload, {
      headers: { "Cache-Control": "private, max-age=60" }
    });
  }

  try {
    const { doc, tableReady } = await loadWikiDoc(gate.admin, slug);
    if (!tableReady) {
      return NextResponse.json(
        { error: "luna_library 테이블이 없습니다." },
        { status: 503 }
      );
    }
    if (!doc || !canViewWikiDoc(doc, gate.isAdmin)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const section = doc.sections.find((item) => item.id === sectionId);
    if (!section) {
      return NextResponse.json({ error: "section not found" }, { status: 404 });
    }

    const preview = truncateGuideSectionBody(section.body);
    const payload = {
      title: section.title,
      body: preview.body,
      docSlug: slug,
      sectionId: section.id,
      truncated: preview.truncated
    };

    serverCache.set(cacheKey, { at: Date.now(), payload });

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60" }
    });
  } catch (err) {
    console.error("[wiki/section] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 }
    );
  }
}
