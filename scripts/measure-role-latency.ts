/**
 * 슈퍼관리자 vs 멤버 — 같은 질문 3회, 단계별 타이밍·토큰
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/measure-role-latency.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type Session } from "@supabase/supabase-js";

const HUB = (
  process.env.LUNA_UI_BASE_URL ?? "https://hub.apollonworks.com"
).replace(/\/$/, "");

const QUESTIONS = [
  { key: "term", text: "볼팍견적이 뭐야?" },
  { key: "case", text: "우리가 한 미디어파사드 사례 보여줘" }
] as const;

const ACCOUNTS = [
  { label: "슈퍼관리자", name: "이택진" },
  { label: "멤버", name: "남은빈" }
] as const;

type TimingRow = {
  account: string;
  name: string;
  qKey: string;
  round: number;
  total_ms: number | null;
  first_token_ms: number | null;
  embed_ms: number | null;
  search_ms: number | null;
  link_ms: number | null;
  rerank_ms: number | null;
  llm_ms: number | null;
  prep_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cache_creation: number | null;
  cache_read: number | null;
  wall_ms: number;
  http_status: number;
  error?: string;
  perspective_titles?: string[];
  memo_chars?: number;
};

async function sessionForEmail(
  admin: ReturnType<typeof createClient>,
  email: string
): Promise<Session> {
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? "generateLink");
  }
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email"
  });
  if (error || !data.session) throw new Error(error?.message ?? "no session");
  return data.session;
}

async function askOnce(
  accessToken: string,
  text: string,
  conversationId: string | null
): Promise<{
  wall_ms: number;
  http_status: number;
  conversation_id: string | null;
  assistant_id: string | null;
  error?: string;
}> {
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    message: text,
    conversation_id: conversationId,
    engine: "auto"
  };
  const res = await fetch(`${HUB}/api/luna/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });
  const wall_ms = Date.now() - t0;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      wall_ms,
      http_status: res.status,
      conversation_id: conversationId,
      assistant_id: null,
      error: errText.slice(0, 300)
    };
  }
  // stream text — drain
  const reader = res.body?.getReader();
  if (reader) {
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    void buf;
  }
  return {
    wall_ms,
    http_status: res.status,
    conversation_id: conversationId,
    assistant_id: null
  };
}

async function main() {
  mkdirSync("tmp/persona-9x15", { recursive: true });
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const names = ACCOUNTS.map((a) => a.name);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name, email, department, role")
    .in("name", names);

  const byName = new Map(
    (profiles ?? []).map((p) => [p.name as string, p] as const)
  );

  const profileInfo: Record<string, unknown> = {};
  for (const a of ACCOUNTS) {
    const p = byName.get(a.name);
    if (!p) throw new Error(`no profile ${a.name}`);
    const { data: mem } = await admin
      .from("luna_user_memories")
      .select("memo")
      .eq("user_id", p.id)
      .maybeSingle();
    const memo = String(mem?.memo ?? "");
    profileInfo[a.name] = {
      id: p.id,
      email: p.email,
      department: p.department,
      role: p.role,
      memo_chars: memo.length
    };
  }

  const rows: TimingRow[] = [];
  const mark = `role-latency-${Date.now()}`;

  for (const acct of ACCOUNTS) {
    const p = byName.get(acct.name)!;
    const session = await sessionForEmail(admin, p.email as string);
    console.log(JSON.stringify({ phase: "login", name: acct.name }));

    for (const q of QUESTIONS) {
      // 질문마다 새 대화 — 히스토리 오염 방지
      const { data: conv, error: cErr } = await admin
        .from("luna_conversations")
        .insert({
          user_id: p.id,
          title: `[${mark}] ${q.key}`,
          engine: "auto"
        })
        .select("id")
        .single();
      if (cErr || !conv) throw new Error(cErr?.message ?? "conv");

      for (let round = 1; round <= 3; round += 1) {
        const before = new Date().toISOString();
        const asked = await askOnce(
          session.access_token,
          q.text,
          conv.id as string
        );

        // 메시지 metadata 조회 (스트리밍 직후)
        await new Promise((r) => setTimeout(r, 800));
        const { data: msgs } = await admin
          .from("luna_messages")
          .select("id, metadata, created_at")
          .eq("conversation_id", conv.id)
          .eq("role", "assistant")
          .gte("created_at", before)
          .order("created_at", { ascending: false })
          .limit(1);

        const meta =
          (msgs?.[0]?.metadata as Record<string, unknown> | null) ?? null;
        const timings =
          (meta?.timings as Record<string, unknown> | undefined) ?? {};
        const usage =
          (meta?.usage as Record<string, unknown> | undefined) ?? {};
        const used =
          (meta?.used_prompts as Array<{ title?: string; key?: string }> | undefined) ??
          [];
        const perspective_titles = used
          .filter((u) => String(u.key ?? "").startsWith("lens.") || String(u.title ?? "").includes("관점"))
          .map((u) => u.title ?? u.key ?? "");

        const row: TimingRow = {
          account: acct.label,
          name: acct.name,
          qKey: q.key,
          round,
          total_ms:
            typeof timings.total_ms === "number"
              ? timings.total_ms
              : typeof meta?.duration_ms === "number"
                ? (meta.duration_ms as number)
                : null,
          first_token_ms:
            typeof timings.first_token_ms === "number"
              ? timings.first_token_ms
              : null,
          embed_ms:
            typeof timings.embed_ms === "number" ? timings.embed_ms : null,
          search_ms:
            typeof timings.search_ms === "number" ? timings.search_ms : null,
          link_ms: typeof timings.link_ms === "number" ? timings.link_ms : null,
          rerank_ms:
            typeof timings.rerank_ms === "number" ? timings.rerank_ms : null,
          llm_ms: typeof timings.llm_ms === "number" ? timings.llm_ms : null,
          prep_ms:
            typeof timings.prep_ms === "number"
              ? timings.prep_ms
              : typeof timings.total_ms === "number" &&
                  typeof timings.llm_ms === "number"
                ? Math.max(0, timings.total_ms - timings.llm_ms)
                : null,
          prompt_tokens:
            typeof timings.prompt_tokens === "number"
              ? timings.prompt_tokens
              : typeof usage.input_tokens === "number"
                ? (usage.input_tokens as number)
                : null,
          completion_tokens:
            typeof timings.completion_tokens === "number"
              ? timings.completion_tokens
              : typeof usage.output_tokens === "number"
                ? (usage.output_tokens as number)
                : null,
          cache_creation:
            typeof usage.cache_creation_input_tokens === "number"
              ? (usage.cache_creation_input_tokens as number)
              : null,
          cache_read:
            typeof usage.cache_read_input_tokens === "number"
              ? (usage.cache_read_input_tokens as number)
              : null,
          wall_ms: asked.wall_ms,
          http_status: asked.http_status,
          error: asked.error,
          perspective_titles,
          memo_chars: (profileInfo[acct.name] as { memo_chars: number })
            .memo_chars
        };
        rows.push(row);
        console.log(JSON.stringify({ phase: "q", ...row }));
      }
    }
  }

  // cleanup test conversations
  await admin
    .from("luna_conversations")
    .delete()
    .like("title", `[${mark}]%`);

  const summary = {
    profileInfo,
    rows,
    byAccountQuestion: Object.fromEntries(
      ACCOUNTS.flatMap((a) =>
        QUESTIONS.map((q) => {
          const subset = rows.filter(
            (r) => r.name === a.name && r.qKey === q.key
          );
          const r1 = subset.find((r) => r.round === 1);
          const r3 = subset.find((r) => r.round === 3);
          return [
            `${a.label}:${q.key}`,
            {
              r1: r1
                ? {
                    total_s: r1.total_ms != null ? +(r1.total_ms / 1000).toFixed(1) : null,
                    ttft_s:
                      r1.first_token_ms != null
                        ? +(r1.first_token_ms / 1000).toFixed(1)
                        : null,
                    embed: r1.embed_ms,
                    search: r1.search_ms,
                    link: r1.link_ms,
                    rerank: r1.rerank_ms,
                    prep: r1.prep_ms,
                    llm: r1.llm_ms,
                    in: r1.prompt_tokens,
                    out: r1.completion_tokens,
                    cache_w: r1.cache_creation,
                    cache_r: r1.cache_read,
                    perspective: r1.perspective_titles
                  }
                : null,
              r3: r3
                ? {
                    total_s: r3.total_ms != null ? +(r3.total_ms / 1000).toFixed(1) : null,
                    ttft_s:
                      r3.first_token_ms != null
                        ? +(r3.first_token_ms / 1000).toFixed(1)
                        : null,
                    embed: r3.embed_ms,
                    search: r3.search_ms,
                    link: r3.link_ms,
                    rerank: r3.rerank_ms,
                    prep: r3.prep_ms,
                    llm: r3.llm_ms,
                    in: r3.prompt_tokens,
                    out: r3.completion_tokens,
                    cache_w: r3.cache_creation,
                    cache_r: r3.cache_read,
                    perspective: r3.perspective_titles
                  }
                : null
            }
          ];
        })
      )
    )
  };

  writeFileSync(
    "tmp/persona-9x15/role-latency.json",
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ phase: "done", summary: summary.byAccountQuestion }, null, 2));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
