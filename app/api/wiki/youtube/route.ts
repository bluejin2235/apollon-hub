import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser } from "@/lib/wiki/api";
import { parseYoutubeId, youtubeWatchUrl } from "@/lib/wiki/media";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  const raw = request.nextUrl.searchParams.get("url") ?? request.nextUrl.searchParams.get("id") ?? "";
  const id = parseYoutubeId(raw);
  if (!id) {
    return NextResponse.json({ error: "유튜브 링크가 아닙니다." }, { status: 400 });
  }
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(id))}&format=json`;
    const res = await fetch(oembed, { next: { revalidate: 86400 } });
    if (!res.ok) {
      return NextResponse.json({ id, title: "YouTube" });
    }
    const json = (await res.json()) as { title?: string };
    return NextResponse.json({
      id,
      title: typeof json.title === "string" ? json.title : "YouTube"
    });
  } catch (err) {
    console.error("[wiki/youtube]", err);
    return NextResponse.json({ id, title: "YouTube" });
  }
}
