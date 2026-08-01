export type NotionSource = {
  title: string;
  url: string;
};

type NotionSearchResult = {
  object?: string;
  url?: string;
  properties?: Record<string, unknown>;
};

function plainFromRichText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (part && typeof part === "object" && "plain_text" in part) {
        return String((part as { plain_text?: string }).plain_text ?? "");
      }
      return "";
    })
    .join("")
    .trim();
}

export function extractNotionPageTitle(result: NotionSearchResult): string {
  const props = result.properties;
  if (!props || typeof props !== "object") return "Untitled";

  for (const value of Object.values(props)) {
    if (!value || typeof value !== "object") continue;
    const prop = value as { type?: string; title?: unknown; name?: unknown };
    if (prop.type === "title") {
      const text = plainFromRichText(prop.title);
      if (text) return text;
    }
  }

  // fallback: first title-like field
  for (const value of Object.values(props)) {
    if (!value || typeof value !== "object") continue;
    const prop = value as { title?: unknown };
    if ("title" in prop) {
      const text = plainFromRichText(prop.title);
      if (text) return text;
    }
  }

  return "Untitled";
}

export async function searchNotionPages(query: string): Promise<NotionSource[]> {
  const token = process.env.NOTION_TOKEN;
  if (!token || !query.trim()) {
    console.log("[luna/notion] skipped", { hasToken: !!token, query });
    return [];
  }

  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: query.trim(),
      page_size: 5
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.log("[luna/notion] status", res.status, "results", undefined);
    console.error("[luna/notion] search", res.status, text.slice(0, 300));
    return [];
  }

  const data = (await res.json()) as { results?: NotionSearchResult[] };
  console.log("[luna/notion] status", res.status, "results", data.results?.length);
  const results = data.results ?? [];

  return results
    .filter((r) => r.object === "page" || Boolean(r.url))
    .map((r) => ({
      title: extractNotionPageTitle(r),
      url: typeof r.url === "string" ? r.url : ""
    }))
    .filter((s) => Boolean(s.url))
    .slice(0, 5);
}
