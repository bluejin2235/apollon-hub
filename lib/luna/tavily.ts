export type LunaCard = {
  type: "web" | "youtube" | "notion" | "nas";
  title: string;
  url: string | null;
  thumbnail: string | null;
  description: string;
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  image?: string;
  score?: number;
};

type TavilyResponse = {
  results?: TavilyResult[];
  images?: string[];
};

const SCORE_MIN = 0.4;
const FALLBACK_KEEP = 2;

export async function searchTavily(
  query: string,
  domainHint?: string
): Promise<LunaCard[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || !query.trim()) {
    console.log("[luna/tavily] skipped", { hasKey: !!apiKey, query });
    return [];
  }

  const tavilyQuery = `${query} ${domainHint ?? ""}`.trim();

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: tavilyQuery,
        max_results: 5,
        include_images: true,
        search_depth: "advanced"
      })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[luna/tavily] search", res.status, text.slice(0, 300));
      return [];
    }

    const data = (await res.json()) as TavilyResponse;
    const images = Array.isArray(data.images) ? data.images : [];
    const results = Array.isArray(data.results) ? data.results : [];
    console.log("[luna/tavily] results", results.length);

    const withUrl = results.filter(
      (r) => typeof r.url === "string" && r.url.trim()
    );
    const hasScore = withUrl.some((r) => typeof r.score === "number");

    let selected = withUrl;
    if (!hasScore) {
      console.log("[luna/tavily] filtered", withUrl.length, "→", withUrl.length, "(no score)");
    } else {
      const scored = [...withUrl].sort(
        (a, b) => (b.score ?? 0) - (a.score ?? 0)
      );
      const above = scored.filter((r) => (r.score ?? 0) >= SCORE_MIN);
      selected =
        above.length > 0 ? above : scored.slice(0, FALLBACK_KEEP);
      console.log("[luna/tavily] filtered", withUrl.length, "→", selected.length);
    }

    return selected.map((r, i) => {
      const content = (r.content ?? r.raw_content ?? "").trim();
      const origIndex = withUrl.indexOf(r);
      const image =
        (typeof r.image === "string" && r.image) ||
        (typeof images[origIndex >= 0 ? origIndex : i] === "string"
          ? images[origIndex >= 0 ? origIndex : i]
          : null);
      return {
        type: "web" as const,
        title: (r.title ?? "").trim() || r.url!.trim(),
        url: r.url!.trim(),
        thumbnail: image,
        description: content.slice(0, 100)
      };
    });
  } catch (err) {
    console.error("[luna/tavily] search", err);
    return [];
  }
}
