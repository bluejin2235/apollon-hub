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
};

type TavilyResponse = {
  results?: TavilyResult[];
  images?: string[];
};

export async function searchTavily(query: string): Promise<LunaCard[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || !query.trim()) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: query.trim(),
        max_results: 5,
        include_images: true
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

    return results
      .filter((r) => typeof r.url === "string" && r.url.trim())
      .map((r, i) => {
        const content = (r.content ?? r.raw_content ?? "").trim();
        const image =
          (typeof r.image === "string" && r.image) ||
          (typeof images[i] === "string" ? images[i] : null);
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
