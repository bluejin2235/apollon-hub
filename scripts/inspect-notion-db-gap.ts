/**
 * 사업개발 DB 행이 검색·query 에 나오는지 확인
 *   npx tsx scripts/inspect-notion-db-gap.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

const TOKEN = process.env.NOTION_TOKEN?.trim() || process.env.NOTION_API_KEY?.trim();
if (!TOKEN) throw new Error("NOTION_TOKEN missing");

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json"
};

async function notion(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) }
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 400);
  }
  return { status: res.status, json };
}

function titleOf(item: { properties?: Record<string, unknown>; title?: unknown; object?: string }) {
  if (item.object === "database" && Array.isArray(item.title)) {
    return item.title
      .map((p) => (p && typeof p === "object" && "plain_text" in p ? String((p as { plain_text?: string }).plain_text ?? "") : ""))
      .join("");
  }
  const props = item.properties ?? {};
  for (const value of Object.values(props)) {
    if (!value || typeof value !== "object") continue;
    const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (prop.type === "title" && Array.isArray(prop.title)) {
      return prop.title.map((p) => p.plain_text ?? "").join("");
    }
  }
  return "";
}

async function search(query: string) {
  const res = await notion("/search", {
    method: "POST",
    body: JSON.stringify({ query, page_size: 20 })
  });
  const data = res.json as { results?: Array<Record<string, unknown>> };
  const results = data.results ?? [];
  console.log(`\nSEARCH "${query}" status=${res.status} n=${results.length}`);
  for (const item of results.slice(0, 12)) {
    console.log(
      `  ${item.object} ${item.id} archived=${item.archived} parent=${JSON.stringify(item.parent)} title=${titleOf(item as never)}`
    );
  }
  return results;
}

async function main() {
  await search("인스파이어 시즌4 제안");
  await search("사업개발 DB");
  await search("아폴론 Working");
  await search("제안서 DB");

  const pageId = "3b4c795f-b818-8071-9121-ecae6c447c70";
  const page = await notion(`/pages/${pageId}`);
  console.log(`\nGET page ${pageId} status=${page.status}`);
  const body = page.json as {
    parent?: unknown;
    properties?: Record<string, unknown>;
    archived?: boolean;
  };
  if (page.status === 200) {
    console.log("parent", JSON.stringify(body.parent));
    console.log("archived", body.archived);
    const props = body.properties ?? {};
    console.log("property keys", Object.keys(props).join(" | "));
    for (const [name, value] of Object.entries(props)) {
      if (!value || typeof value !== "object") continue;
      const v = value as { type?: string };
      if (v.type === "relation" || v.type === "title") {
        console.log(`  ${name} type=${v.type}`, JSON.stringify(value).slice(0, 280));
      }
    }
  } else {
    console.log(JSON.stringify(page.json).slice(0, 400));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
