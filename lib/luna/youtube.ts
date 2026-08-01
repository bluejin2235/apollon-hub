import type { LunaCard } from "@/lib/luna/tavily";

type YoutubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    thumbnails?: {
      medium?: { url?: string };
      default?: { url?: string };
      high?: { url?: string };
    };
  };
};

/** YouTube Data API v3 search. 키 없으면 [] (에러 없이 스킵) */
export async function searchYoutube(query: string): Promise<LunaCard[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || !query.trim()) return [];

  try {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: "5",
      q: query.trim(),
      key: apiKey
    });
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params.toString()}`
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("[luna/youtube] search", res.status, text.slice(0, 300));
      return [];
    }

    const data = (await res.json()) as { items?: YoutubeSearchItem[] };
    const items = Array.isArray(data.items) ? data.items : [];

    const cards: LunaCard[] = [];
    for (const item of items) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;
      const thumb =
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.default?.url ||
        null;
      const description = (item.snippet?.description ?? "").trim();
      cards.push({
        type: "youtube",
        title: (item.snippet?.title ?? "").trim() || "YouTube",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: thumb,
        description: description.slice(0, 100)
      });
    }
    return cards;
  } catch (err) {
    console.error("[luna/youtube] search", err);
    return [];
  }
}
