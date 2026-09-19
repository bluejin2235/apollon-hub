/**
 * rewrite 가 대화에 없는 옛 주제를 버리는지 + 2명 승격이 도는지
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-rewrite-drop-and-promote2.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { rewriteUserMemo, saveUserMemoText } from "@/lib/luna/user-memory";
import { promoteSharedMemoPatterns } from "@/lib/luna/perspective-promote";

const MARKER = "P9FIX_UNIQUE_TOPIC_XYZ_SHOULD_DROP";
const PATTERN_MARK = "P9FIX동선=관람흐름검증패턴";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false } }
  );

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name")
    .in("name", ["남은빈", "성호준"]);
  const a = profiles?.find((p) => p.name === "남은빈");
  const b = profiles?.find((p) => p.name === "성호준");
  if (!a || !b) throw new Error("profiles missing");

  // ── drop test: memo 에만 있는 마커가 rewrite 후 사라지는지
  const { data: beforeRow } = await admin
    .from("luna_user_memories")
    .select("memo")
    .eq("user_id", a.id)
    .maybeSingle();
  const snapshot = String(beforeRow?.memo ?? "");
  await saveUserMemoText(
    admin,
    a.id as string,
    `${snapshot}\n\n자주 찾는 것\n- ${MARKER} (대화에 없음)`
  );
  const rw = await rewriteUserMemo(admin, a.id as string, { force: true });
  const { data: afterRow } = await admin
    .from("luna_user_memories")
    .select("memo")
    .eq("user_id", a.id)
    .maybeSingle();
  const afterMemo = String(afterRow?.memo ?? "");
  const dropOk = !afterMemo.includes(MARKER);

  // ── promote 2: 두 memo 에 같은 새 패턴을 넣고 승격
  const line =
    "「동선」을 관람 흐름(진입–체류–전환)으로 읽는다. " + PATTERN_MARK;
  await saveUserMemoText(
    admin,
    a.id as string,
    `답할 때\n- ${line}\n\n${afterMemo}`
  );
  await saveUserMemoText(
    admin,
    b.id as string,
    `답할 때\n- ${line}\n\n자주 찾는 것\n- 전주관광타워 동선`
  );

  // 이전 applied 와 안 겹치게 pattern 문자열을 유니크하게
  const promote = await promoteSharedMemoPatterns(admin);
  const { data: changes } = await admin
    .from("luna_perspective_changes")
    .select("id, pattern, evidence_count, status, created_at")
    .ilike("pattern", "%P9FIX%")
    .order("created_at", { ascending: false })
    .limit(5);

  // 정리: 테스트로 심은 승격이 있으면 revert + 메모 스냅샷 복원 시도
  for (const c of changes ?? []) {
    if (c.status === "applied") {
      const { revertPerspectiveChange } = await import(
        "@/lib/luna/perspective-promote"
      );
      await revertPerspectiveChange(admin, c.id as string);
    }
  }
  if (snapshot) {
    await saveUserMemoText(admin, a.id as string, snapshot);
  }

  const out = {
    rewrite: rw,
    dropOk,
    markerStillPresent: afterMemo.includes(MARKER),
    afterPreview: afterMemo.slice(0, 300),
    promote,
    p9fixChanges: changes
  };
  writeFileSync(
    resolve("tmp/persona-9x15/rewrite-drop-promote2.json"),
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
