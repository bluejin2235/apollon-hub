/**
 * P9TEST 개인화 점검 데이터 일괄 삭제 + memo/beta 복원
 *
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/cleanup-persona-9x15.ts
 * P9_RUN_ID=...  (없으면 등록된 모든 런)
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  PERSONA_TEST_BETA_NOTE_PREFIX,
  PERSONA_TEST_PREFIX,
  PERSONA_TEST_SETTINGS_KEY,
  isPersonaTestTitle
} from "@/lib/luna/persona-test-marker";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const onlyRun = process.env.P9_RUN_ID?.trim() || null;

  const { data: setting } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", PERSONA_TEST_SETTINGS_KEY)
    .maybeSingle();

  const runs = Array.isArray((setting?.value as { runs?: unknown })?.runs)
    ? ((setting!.value as { runs: Array<Record<string, unknown>> }).runs)
    : [];

  const target = onlyRun
    ? runs.filter((r) => r.runId === onlyRun)
    : runs;

  // also find conversations by title marker
  const { data: markedConvs } = await admin
    .from("luna_conversations")
    .select("id, title, user_id")
    .like("title", `${PERSONA_TEST_PREFIX}%`)
    .limit(500);

  const convIds = new Set<string>();
  for (const r of target) {
    for (const id of (r.conversationIds as string[] | undefined) ?? []) {
      convIds.add(id);
    }
  }
  for (const c of markedConvs ?? []) {
    if (onlyRun) {
      if (String(c.title).includes(onlyRun)) convIds.add(c.id as string);
    } else if (isPersonaTestTitle(c.title)) {
      convIds.add(c.id as string);
    }
  }

  const convList = [...convIds];
  console.log(JSON.stringify({ phase: "cleanup_start", runs: target.length, convs: convList.length }));

  let msgIds: string[] = [];
  if (convList.length > 0) {
    const { data: msgs } = await admin
      .from("luna_messages")
      .select("id")
      .in("conversation_id", convList);
    msgIds = (msgs ?? []).map((m) => m.id as string);
  }

  // answer_found
  if (msgIds.length > 0) {
    const { error } = await admin
      .from("luna_answer_found")
      .delete()
      .in("message_id", msgIds);
    console.log("answer_found", error?.message ?? `deleted for ${msgIds.length} msgs`);
  }

  // signals referencing messages
  if (msgIds.length > 0) {
    const { error } = await admin
      .from("luna_signals")
      .delete()
      .in("subject_id", msgIds);
    console.log("signals", error?.message ?? "ok");
  }

  if (convList.length > 0) {
    const { error } = await admin
      .from("luna_failures")
      .delete()
      .in("conversation_id", convList);
    console.log("failures", error?.message ?? "ok");
  }

  // open questions — conversation_id 없음. 런 시작 이후 생긴 open 을 지운다
  const startedAts = [
    ...new Set(
      target
        .map((r) => (typeof r.startedAt === "string" ? r.startedAt : null))
        .filter((x): x is string => Boolean(x))
    )
  ];
  for (const started of startedAts) {
    const { error } = await admin
      .from("luna_open_questions")
      .delete()
      .eq("status", "open")
      .gte("created_at", started);
    console.log("open_questions", error?.message ?? `since ${started}`);
  }

  // perspective changes created during run window (optional — only if marked in context)
  // skip auto-delete of perspective; test shouldn't promote with <3

  // messages + conversations
  if (convList.length > 0) {
    const { error: mErr } = await admin
      .from("luna_messages")
      .delete()
      .in("conversation_id", convList);
    console.log("messages", mErr?.message ?? "ok");
    const { error: cErr } = await admin
      .from("luna_conversations")
      .delete()
      .in("id", convList);
    console.log("conversations", cErr?.message ?? "ok");
  }

  // restore memos + remove granted beta
  for (const r of target) {
    const snaps = (r.memoSnapshots ?? {}) as Record<
      string,
      {
        memo: string;
        answer_length: string;
        source_count: number;
        updated_at: string;
      } | null
    >;
    for (const [userId, snap] of Object.entries(snaps)) {
      if (snap == null) {
        await admin.from("luna_user_memories").delete().eq("user_id", userId);
      } else {
        await admin.from("luna_user_memories").upsert(
          {
            user_id: userId,
            memo: snap.memo,
            answer_length: snap.answer_length,
            source_count: snap.source_count,
            updated_at: snap.updated_at || new Date().toISOString()
          },
          { onConflict: "user_id" }
        );
      }
    }
    for (const pid of (r.betaGranted as string[] | undefined) ?? []) {
      await admin
        .from("luna_beta_access")
        .delete()
        .eq("profile_id", pid)
        .like("note", `${PERSONA_TEST_BETA_NOTE_PREFIX}%`);
    }
  }

  // also purge any leftover beta with P9TEST note
  await admin
    .from("luna_beta_access")
    .delete()
    .like("note", `${PERSONA_TEST_BETA_NOTE_PREFIX}%`);

  // trim settings registry
  const remaining = onlyRun
    ? runs.filter((r) => r.runId !== onlyRun)
    : [];
  await admin.from("luna_settings").upsert(
    {
      key: PERSONA_TEST_SETTINGS_KEY,
      value: { runs: remaining },
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );

  console.log(JSON.stringify({ phase: "cleanup_done", remainingRuns: remaining.length }));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
