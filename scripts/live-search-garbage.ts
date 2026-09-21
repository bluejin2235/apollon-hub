/**
 * 실서버에서 다섯 질문의 쓰레기 건수를 센다.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/live-search-garbage.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { parseAskedWhat } from "../lib/luna/ask-what";
import { haystackMatchesAsked, isNotFoundAnswerText } from "../lib/luna/search-filter";
import { isGarbage3dPath } from "../lib/luna/media-index-rules";

const HUB = (
  process.env.LUNA_UI_BASE_URL ?? "https://hub.apollonworks.com"
).replace(/\/$/, "");

const QUESTIONS = [
  "해운대스퀘어 KV 이미지 보여줘",
  "더후 글로벌 론칭 레퍼런스 찾아줘",
  "인스파이어 시즌4 어벤저스 레퍼런스 있어?",
  "삼성디스플레이 시어터룸 스토리보드 보여줘",
  "아크메르동탄 모델하우스 레퍼런스"
];

type Card = {
  type?: string;
  title?: string;
  description?: string;
  raw_path?: string;
  project?: string;
};

function cardHay(c: Card): string {
  return [c.title, c.description, c.raw_path, c.project].filter(Boolean).join("\n");
}

function countGarbage(q: string, cards: Card[], notion: Array<{ title?: string; nas_path?: string }>, wiki: Array<{ title?: string }>, answer: string) {
  const asked = parseAskedWhat(q);
  const offCards = cards.filter((c) => {
    const hay = cardHay(c);
    if (isGarbage3dPath(hay)) return true;
    if (asked.projectPhrases.length === 0) return false;
    return !haystackMatchesAsked(hay, asked);
  });
  const offNotion = notion.filter((n) => {
    const hay = [n.title, n.nas_path].filter(Boolean).join("\n");
    if (!hay) return true;
    return asked.projectPhrases.length > 0 && !haystackMatchesAsked(hay, asked);
  });
  const offWiki = wiki.filter((w) => {
    const hay = w.title || "";
    return asked.projectPhrases.length > 0 && !haystackMatchesAsked(hay, asked);
  });
  const notFound = isNotFoundAnswerText(answer);
  const shown = cards.length + notion.length + wiki.length;
  if (notFound && shown > 0) {
    return {
      garbage: shown,
      offCards: offCards.length,
      offNotion: offNotion.length,
      offWiki: offWiki.length,
      shown,
      notFound
    };
  }
  return {
    garbage: offCards.length + offNotion.length + offWiki.length,
    offCards: offCards.length,
    offNotion: offNotion.length,
    offWiki: offWiki.length,
    shown,
    notFound
  };
}

async function askOne(
  access: string,
  admin: ReturnType<typeof createClient>,
  q: string
) {
  const convRes = await fetch(`${HUB}/api/luna/conversations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title: `garbage ${q.slice(0, 24)}` })
  });
  if (!convRes.ok) throw new Error(`conv ${convRes.status}`);
  const conv = (await convRes.json()) as {
    id?: string;
    conversation?: { id?: string };
  };
  const conversationId = conv.id || conv.conversation?.id;
  if (!conversationId) throw new Error("no conv");

  let text = "";
  let meta: Record<string, unknown> | null = null;
  const chatRes = await fetch(`${HUB}/api/luna/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ conversation_id: conversationId, message: q })
  });
  if (!chatRes.ok || !chatRes.body) {
    throw new Error(`chat ${chatRes.status} ${await chatRes.text()}`);
  }
  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("{")) {
        try {
          const ev = JSON.parse(trimmed) as Record<string, unknown>;
          if (ev.type === "meta" || ev.type === "search_snapshot" || ev.type === "clarify") {
            meta = { ...(meta ?? {}), ...ev };
          }
        } catch {
          text += `${line}\n`;
        }
      } else {
        text += `${line}\n`;
      }
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  const { data: rows } = await admin
    .from("luna_messages")
    .select("content, metadata")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = rows?.[0] as
    | { content?: string; metadata?: Record<string, unknown> }
    | undefined;
  const md = row?.metadata ?? meta ?? {};
  const cards = (Array.isArray(md.cards) ? md.cards : []) as Card[];
  const notion = (Array.isArray(md.notion_sources) ? md.notion_sources : []) as Array<{
    title?: string;
    nas_path?: string;
  }>;
  const wiki = (Array.isArray(md.wiki_sources) ? md.wiki_sources : []) as Array<{
    title?: string;
  }>;
  const answer = String(row?.content || text).trim();
  const clarify =
    md.clarify && typeof md.clarify === "object"
      ? (md.clarify as { question?: string; options?: string[] })
      : meta?.type === "clarify"
        ? { question: String(meta.question ?? ""), options: meta.options as string[] }
        : null;
  const garbage = countGarbage(q, cards, notion, wiki, answer);
  return {
    question: q,
    clarify,
    answer: answer.slice(0, 500),
    confidence: md.confidence_score ?? null,
    intent: md.intent_score ?? null,
    self_note: md.self_note ?? null,
    search_scope: md.search_scope ?? null,
    counts: {
      cards: cards.length,
      notion: notion.length,
      wiki: wiki.length,
      image: cards.filter((c) => c.type === "image").length,
      nas: cards.filter((c) => c.type === "nas").length
    },
    garbage
  };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const service =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const admin = createClient(supabaseUrl, service, {
    auth: { persistSession: false }
  });
  const email = "sequeen0207@apollonworks.com";
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "generateLink");
  }
  const anonClient = createClient(supabaseUrl, anon, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: sess, error: sErr } = await anonClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email"
  });
  if (sErr || !sess.session) throw new Error(sErr?.message ?? "session");
  const access = sess.session.access_token;

  const results = [];
  for (const q of QUESTIONS) {
    process.stdout.write(`\n>>> ${q}\n`);
    const row = await askOne(access, admin, q);
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  mkdirSync("tmp", { recursive: true });
  writeFileSync(
    "tmp/live-search-garbage.json",
    JSON.stringify({ hub: HUB, at: new Date().toISOString(), results }, null, 2),
    "utf8"
  );
  console.log("\n=== GARBAGE ===");
  for (const r of results) {
    console.log(
      `| ${r.garbage.garbage}건 | 표시 ${r.garbage.shown} | ${r.question} | ${r.clarify ? "되묻기" : r.garbage.notFound ? "못찾음" : "답"} |`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
