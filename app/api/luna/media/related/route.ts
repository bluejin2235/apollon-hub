import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { buildImageModalChips } from "@/lib/luna/image-modal-chips";
import {
  mediaHitToCard,
  type MediaIndexHit
} from "@/lib/luna/media-index-search";
import { fetchRelatedMedia } from "@/lib/luna/media-related";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const path = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const { data: row, error: rowErr } = await admin
    .from("luna_media_index")
    .select("path, drive, file_name, project, ai_category, description, thumbnail_url, large_url")
    .eq("path", path)
    .maybeSingle();

  if (rowErr) {
    console.error("[luna/media/related] row", rowErr);
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const hits = await fetchRelatedMedia(admin, path, 8);
  const cards = hits.map((h: MediaIndexHit) => mediaHitToCard(h));
  const chips = await buildImageModalChips(
    admin,
    (row.description as string | null) ?? null,
    (row.project as string | null) ?? null
  );

  const card = mediaHitToCard({
    path: String(row.path),
    drive: String(row.drive ?? ""),
    file_name: String(row.file_name ?? ""),
    similarity: 0,
    project: (row.project as string | null) ?? null,
    ai_category: (row.ai_category as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    large_url: (row.large_url as string | null) ?? null
  });

  return NextResponse.json({ card, related: cards, chips });
}
