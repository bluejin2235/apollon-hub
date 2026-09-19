/**
 * 9명 × 15 = 135건 개인화 E2E
 *
 * 세션: Supabase Admin generateLink → verifyOtp (비밀번호 변경 없음)
 * 대상: https://hub.apollonworks.com/luna
 *
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/run-persona-9x15.ts
 * COST_USD_LIMIT=5 (기본) 넘으면 중단
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync
} from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { rewriteUserMemo } from "@/lib/luna/user-memory";
import { promoteSharedMemoPatterns } from "@/lib/luna/perspective-promote";
import {
  PERSONA_TEST_BETA_NOTE_PREFIX,
  PERSONA_TEST_SETTINGS_KEY,
  personaTestTitle
} from "@/lib/luna/persona-test-marker";
import {
  assertPersonaBank,
  PERSONA_9,
  type PersonaPerson,
  type QType
} from "./persona-9x15-questions";

const HUB_URL = (
  process.env.LUNA_UI_BASE_URL ?? "https://hub.apollonworks.com"
).replace(/\/$/, "");
const OUT_DIR = resolve(process.cwd(), "tmp", "persona-9x15");
const COST_USD_LIMIT = Number(process.env.COST_USD_LIMIT ?? "5");
/** 건당 보수 추정 — 실측 테이블이 없을 때 중단 기준 */
const EST_USD_PER_Q = Number(process.env.EST_USD_PER_Q ?? "0.035");
const RUN_ID =
  process.env.P9_RUN_ID?.trim() ||
  new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

type Reaction = "found" | "not_found" | "skip";
type ThumbsReason =
  | "wrong_source"
  | "not_wanted"
  | "length_off"
  | "too_slow"
  | "other";

type Planned = {
  person: PersonaPerson;
  index: number; // 0..14
  room: number; // 1..3
  text: string;
  type: QType;
  sharedKey?: string;
  reaction: Reaction;
  notFoundReason?: string;
  thumbs?: ThumbsReason | null;
};

type QResult = Planned & {
  ok: boolean;
  error?: string;
  wallSec?: number;
  uiSec?: number | null;
  hasTechLeak?: boolean;
  notFoundGuide?: {
    hasWhy: boolean;
    hasDetail: boolean;
    hasNext: boolean;
  };
  screenshot?: string;
  messageId?: string;
  conversationId?: string;
};

type RunState = {
  runId: string;
  startedAt: string;
  hubUrl: string;
  betaGranted: string[];
  memoSnapshots: Record<
    string,
    { memo: string; answer_length: string; source_count: number; updated_at: string } | null
  >;
  conversationIds: string[];
  messageIds: string[];
  results: QResult[];
  memosAfter: Record<string, string>;
  costEstUsd: number;
  stoppedForCost: boolean;
  promote: unknown;
  perspectiveAt2: unknown;
  errors: string[];
};

function projectRef(url: string): string {
  return new URL(url).hostname.split(".")[0]!;
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function createSession(
  admin: SupabaseClient,
  email: string
): Promise<Session> {
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(`generateLink: ${linkErr?.message ?? "no token"}`);
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email"
  });
  if (error || !data.session) {
    throw new Error(`verifyOtp: ${error?.message ?? "no session"}`);
  }
  return data.session;
}

async function injectSession(
  context: BrowserContext,
  page: Page,
  session: Session,
  supabaseUrl: string
) {
  const key = `sb-${projectRef(supabaseUrl)}-auth-token`;
  const packedSession = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user
  };
  const b64url = Buffer.from(JSON.stringify(packedSession))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const packed = `base64-${b64url}`;
  const CHUNK = 3180;
  const cookies =
    packed.length <= CHUNK
      ? [{ name: key, value: packed }]
      : Array.from({ length: Math.ceil(packed.length / CHUNK) }, (_, i) => ({
          name: `${key}.${i}`,
          value: packed.slice(i * CHUNK, (i + 1) * CHUNK)
        }));
  await context.clearCookies();
  await context.addCookies(
    cookies.map((c) => ({
      ...c,
      url: HUB_URL,
      sameSite: "Lax" as const
    }))
  );
  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.evaluate(
    ({ k, v }) => localStorage.setItem(k, JSON.stringify(v)),
    { k: key, v: packedSession }
  );
}

/** 사람당 15건: found 9 / not_found 4 / skip 2, thumbs ~1-2 */
function planReactions(seed: number): Array<{
  reaction: Reaction;
  notFoundReason?: string;
  thumbs?: ThumbsReason | null;
}> {
  const reasons = [
    "없는 것 같아요",
    "있는데 다른 게 나왔어요",
    "반만 맞아요"
  ];
  const thumbsReasons: ThumbsReason[] = [
    "wrong_source",
    "not_wanted",
    "length_off",
    "too_slow",
    "other"
  ];
  const slots: Array<{
    reaction: Reaction;
    notFoundReason?: string;
    thumbs?: ThumbsReason | null;
  }> = [
    ...Array.from({ length: 9 }, () => ({
      reaction: "found" as const,
      thumbs: null as ThumbsReason | null
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      reaction: "not_found" as const,
      notFoundReason: reasons[i % reasons.length],
      thumbs: null as ThumbsReason | null
    })),
    ...Array.from({ length: 2 }, () => ({
      reaction: "skip" as const,
      thumbs: null as ThumbsReason | null
    }))
  ];
  // deterministic shuffle
  let s = seed || 1;
  for (let i = slots.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const tmp = slots[i]!;
    slots[i] = slots[j]!;
    slots[j] = tmp;
  }
  // assign ~1.5 thumbs → 1 or 2 per person
  const nThumbs = seed % 2 === 0 ? 2 : 1;
  let assigned = 0;
  for (let i = 0; i < slots.length && assigned < nThumbs; i += 1) {
    if (slots[i]!.reaction === "skip") continue;
    slots[i]!.thumbs = thumbsReasons[(seed + i) % thumbsReasons.length]!;
    assigned += 1;
  }
  return slots;
}

function buildPlan(): Planned[] {
  const out: Planned[] = [];
  PERSONA_9.forEach((person, pi) => {
    const react = planReactions(100 + pi * 17);
    person.questions.forEach((q, qi) => {
      // miss 질문은 가능하면 not_found 슬롯과 맞추되, 이미 섞였으면 강제 덮지 않음
      let slot = react[qi]!;
      if (q.type === "miss" && slot.reaction === "found") {
        // swap with a not_found later if possible
        const swap = react.findIndex(
          (r, idx) => idx > qi && r.reaction === "not_found"
        );
        if (swap >= 0) {
          const tmp = react[qi]!;
          react[qi] = react[swap]!;
          react[swap] = tmp;
          slot = react[qi]!;
        } else {
          slot = {
            reaction: "not_found",
            notFoundReason: "없는 것 같아요",
            thumbs: slot.thumbs
          };
        }
      }
      out.push({
        person,
        index: qi,
        room: Math.floor(qi / 5) + 1,
        text: q.text,
        type: q.type,
        sharedKey: q.sharedKey,
        reaction: slot.reaction,
        notFoundReason: slot.notFoundReason,
        thumbs: slot.thumbs
      });
    });
  });
  return out;
}

async function ensureBeta(
  admin: SupabaseClient,
  profileId: string,
  runId: string,
  state: RunState
) {
  const { data } = await admin
    .from("luna_beta_access")
    .select("profile_id, note")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (data?.profile_id) return;
  const note = `${PERSONA_TEST_BETA_NOTE_PREFIX}${runId}`;
  await admin.from("luna_beta_access").upsert(
    { profile_id: profileId, note },
    { onConflict: "profile_id" }
  );
  state.betaGranted.push(profileId);
}

async function snapshotMemo(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from("luna_user_memories")
    .select("memo, answer_length, source_count, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    memo: String(data.memo ?? ""),
    answer_length: String(data.answer_length ?? "normal"),
    source_count: Number(data.source_count ?? 0),
    updated_at: String(data.updated_at ?? "")
  };
}

async function saveRunRegistry(admin: SupabaseClient, state: RunState) {
  const { data: existing } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", PERSONA_TEST_SETTINGS_KEY)
    .maybeSingle();
  const prev =
    existing?.value && typeof existing.value === "object"
      ? (existing.value as Record<string, unknown>)
      : {};
  const runs = Array.isArray(prev.runs) ? [...prev.runs] : [];
  runs.push({
    runId: state.runId,
    startedAt: state.startedAt,
    betaGranted: state.betaGranted,
    conversationIds: state.conversationIds,
    messageIds: state.messageIds,
    memoSnapshots: state.memoSnapshots
  });
  await admin.from("luna_settings").upsert(
    {
      key: PERSONA_TEST_SETTINGS_KEY,
      value: { runs },
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
}

function saveLocal(state: RunState) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, `run-${state.runId}.json`),
    JSON.stringify(state, null, 2),
    "utf8"
  );
}

async function markConversationTitle(
  admin: SupabaseClient,
  userId: string,
  runId: string,
  room: number,
  state: RunState
) {
  const { data } = await admin
    .from("luna_conversations")
    .select("id, title")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(3);
  const hit = (data ?? []).find(
    (c) =>
      !String(c.title ?? "").startsWith("[P9TEST:") ||
      String(c.title).includes(`${room}/3`)
  );
  const target = (data ?? [])[0];
  if (!target?.id) return;
  const title = personaTestTitle(runId, room);
  await admin
    .from("luna_conversations")
    .update({ title })
    .eq("id", target.id);
  if (!state.conversationIds.includes(target.id as string)) {
    state.conversationIds.push(target.id as string);
  }
  void hit;
}

async function openNewRoom(page: Page) {
  const btn = page.getByRole("button", { name: "새 대화" }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(800);
  }
}

async function askOne(
  page: Page,
  planned: Planned,
  shotDir: string
): Promise<QResult> {
  const base: QResult = { ...planned, ok: false };
  try {
    const input = page.locator("textarea").last();
    await input.waitFor({ state: "visible", timeout: 30_000 });
    // 이전 답이 끝나 textarea 가 살아 있을 때까지
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          "textarea"
        ) as HTMLTextAreaElement | null;
        return Boolean(el) && !el!.disabled;
      },
      { timeout: 180_000 }
    );

    const foundBefore = await page
      .getByRole("button", { name: "네, 찾았어요" })
      .count();
    const timersBefore = await page.evaluate(
      () => (document.body.innerText.match(/\d+(?:\.\d+)?초/g) ?? []).length
    );

    await input.fill(planned.text);
    const t0 = Date.now();
    const send = page.getByRole("button", { name: "전송" }).first();
    if (await send.isVisible().catch(() => false)) {
      await send.click();
    } else {
      await input.press("Enter");
    }

    // 완료 신호: 전송 직후 textarea disabled → 다시 enabled, 그리고
    // 「초」 타이머 개수 또는 「찾았어요」 버튼 개수가 늘어난 것.
    // askPrompt/notFound 문구는 이전 답에도 남아 있어 쓰지 않는다.
    const chatDone = page.waitForResponse(
      (res) =>
        res.url().includes("/api/luna/chat") &&
        res.request().method() === "POST" &&
        res.status() < 500,
      { timeout: 180_000 }
    ).catch(() => null);

    await page
      .waitForFunction(
        () => {
          const el = document.querySelector(
            "textarea"
          ) as HTMLTextAreaElement | null;
          return Boolean(el) && el!.disabled;
        },
        { timeout: 8_000 }
      )
      .catch(() => null);

    await Promise.all([
      chatDone,
      page.waitForFunction(
        ({ foundBefore, timersBefore }) => {
          const el = document.querySelector(
            "textarea"
          ) as HTMLTextAreaElement | null;
          if (!el || el.disabled) return false;
          const text = document.body.innerText;
          const timers = (text.match(/\d+(?:\.\d+)?초/g) ?? []).length;
          const foundBtns = Array.from(
            document.querySelectorAll("button")
          ).filter(
            (b) => (b.textContent ?? "").trim() === "네, 찾았어요"
          ).length;
          return timers > timersBefore || foundBtns > foundBefore;
        },
        { foundBefore, timersBefore },
        { timeout: 180_000 }
      )
    ]);
    // 메타(초) 한 줄이 그려질 여유
    await page.waitForTimeout(400);
    const wallSec = (Date.now() - t0) / 1000;

    // 마지막 타이머(가장 최근 답)
    const uiSec = await page.evaluate(() => {
      const all = [...document.body.innerText.matchAll(/(\d+(?:\.\d+)?)초/g)];
      if (all.length === 0) return null;
      return Number(all[all.length - 1]![1]);
    });

    const body = await page.locator("body").innerText();

    const techLeak = /청크|임베딩|출처 편중|리랭크|벡터\s|chunk|embedding/i.test(
      body
    );

    const notFoundGuide = {
      hasWhy:
        /못 찾았|자료를 못|찾던 걸 못/.test(body) ||
        body.includes("찾던 걸 못 찾았어요"),
      hasDetail:
        /Work서버|노션|위키|파일 본문|건/.test(body) ||
        body.includes("이렇게 찾"),
      hasNext:
        body.includes("이렇게 해보시겠어요") ||
        body.includes("폴더를 직접") ||
        body.includes("루나에게 알려주기") ||
        body.includes("다시 물어보기")
    };

    // 찾았어요 / 못 찾았어요 — 가장 아래(최신) 버튼
    if (planned.reaction === "found") {
      const yes = page.getByRole("button", { name: "네, 찾았어요" }).last();
      if (await yes.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await yes.click();
        await page.waitForTimeout(500);
      }
    } else if (planned.reaction === "not_found") {
      const no = page
        .getByRole("button", { name: "아니요, 못 찾았어요" })
        .last();
      if (await no.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await no.click();
        await page.waitForTimeout(400);
        const reason = planned.notFoundReason ?? "없는 것 같아요";
        const rbtn = page.getByRole("button", { name: reason }).last();
        if (await rbtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await rbtn.click();
          await page.waitForTimeout(400);
        }
      }
    }

    // 👎
    if (planned.thumbs) {
      const down = page.getByRole("button", { name: "싫어요" }).last();
      if (await down.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await down.click();
        await page.waitForTimeout(400);
        const labels: Record<ThumbsReason, RegExp> = {
          wrong_source: /찾아준 자료가 틀렸/,
          not_wanted: /원하던 게 아니/,
          length_off: /길이가|너무 길거나/,
          too_slow: /너무 느/,
          other: /그 밖|직접 말/
        };
        const re = labels[planned.thumbs];
        const b = page.getByRole("button", { name: re }).last();
        if (await b.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await b.click();
        } else {
          const any = page
            .locator("button")
            .filter({ hasText: /틀렸|아니|길이|느|그 밖|직접/ })
            .first();
          if (await any.isVisible().catch(() => false)) await any.click();
        }
        await page.waitForTimeout(400);
      }
    }

    const shot = resolve(
      shotDir,
      `${planned.person.name}-${String(planned.index + 1).padStart(2, "0")}.png`
    );
    if (
      planned.index === 0 ||
      planned.type === "miss" ||
      techLeak ||
      planned.index === 14
    ) {
      await page.screenshot({ path: shot, fullPage: true });
      base.screenshot = shot;
    }

    return {
      ...base,
      ok: true,
      wallSec: Number(wallSec.toFixed(1)),
      uiSec,
      hasTechLeak: techLeak,
      notFoundGuide
    };
  } catch (e) {
    const shot = resolve(
      shotDir,
      `ERR-${planned.person.name}-${planned.index + 1}.png`
    );
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return {
      ...base,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      screenshot: shot
    };
  }
}

async function openMyLunaMemo(page: Page, name: string, shotDir: string) {
  // 설정 › 나의 루나 — 대화의 「나의 루나 →」 또는 /settings
  const link = page.getByRole("button", { name: /나의 루나/ }).first();
  if (await link.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await link.click();
    await page.waitForTimeout(1500);
  } else {
    await page.goto(`${HUB_URL}/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    await page.waitForTimeout(1000);
    const tab = page.getByRole("button", { name: /나의 루나|루나/ }).first();
    if (await tab.isVisible().catch(() => false)) await tab.click();
    await page.waitForTimeout(1000);
  }
  const shot = resolve(shotDir, `memo-${name}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  return shot;
}

async function main() {
  assertPersonaBank();
  mkdirSync(OUT_DIR, { recursive: true });
  const shotDir = resolve(OUT_DIR, `shots-${RUN_ID}`);
  mkdirSync(shotDir, { recursive: true });

  const admin = adminClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const state: RunState = {
    runId: RUN_ID,
    startedAt: new Date().toISOString(),
    hubUrl: HUB_URL,
    betaGranted: [],
    memoSnapshots: {},
    conversationIds: [],
    messageIds: [],
    results: [],
    memosAfter: {},
    costEstUsd: 0,
    stoppedForCost: false,
    promote: null,
    perspectiveAt2: null,
    errors: []
  };

  // resolve profiles
  const names = PERSONA_9.map((p) => p.name);
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, name, email, department")
    .in("name", names);
  if (pErr) throw pErr;
  const byName = new Map(
    (profiles ?? []).map((p) => [p.name as string, p] as const)
  );
  for (const n of names) {
    if (!byName.get(n)?.email) throw new Error(`missing profile ${n}`);
  }

  // snapshot memos + grant beta
  for (const person of PERSONA_9) {
    const p = byName.get(person.name)!;
    state.memoSnapshots[p.id as string] = await snapshotMemo(
      admin,
      p.id as string
    );
    await ensureBeta(admin, p.id as string, RUN_ID, state);
  }
  await saveRunRegistry(admin, state);
  saveLocal(state);

  const plan = buildPlan();
  console.log(
    JSON.stringify({
      phase: "start",
      runId: RUN_ID,
      hub: HUB_URL,
      total: plan.length,
      betaGranted: state.betaGranted.length
    })
  );

  const browser: Browser = await chromium.launch({
    headless: true,
    channel: "chrome"
  });

  let lastPerson = "";
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let currentRoom = 0;

  try {
    for (let i = 0; i < plan.length; i += 1) {
      if (state.costEstUsd >= COST_USD_LIMIT) {
        state.stoppedForCost = true;
        state.errors.push(
          `cost est $${state.costEstUsd.toFixed(2)} >= limit $${COST_USD_LIMIT}`
        );
        console.log(
          JSON.stringify({
            phase: "stop_cost",
            costEstUsd: state.costEstUsd,
            done: state.results.length
          })
        );
        break;
      }

      const item = plan[i]!;
      const profile = byName.get(item.person.name)!;

      if (item.person.name !== lastPerson) {
        // finish previous memo rewrite
        if (lastPerson) {
          const prev = byName.get(lastPerson)!;
          const rw = await rewriteUserMemo(admin, prev.id as string, {
            force: true
          });
          const mem = await snapshotMemo(admin, prev.id as string);
          state.memosAfter[lastPerson] = mem?.memo ?? "";
          console.log(
            JSON.stringify({
              phase: "memo_rewrite",
              name: lastPerson,
              rw,
              memoChars: state.memosAfter[lastPerson].length
            })
          );
          if (page) {
            await openMyLunaMemo(page, lastPerson, shotDir).catch(() => null);
          }
        }

        if (context) await context.close();
        context = await browser.newContext({
          viewport: { width: 1280, height: 1000 }
        });
        page = await context.newPage();
        const session = await createSession(admin, profile.email as string);
        await injectSession(context, page, session, supabaseUrl);
        await page.goto(`${HUB_URL}/luna`, {
          waitUntil: "networkidle",
          timeout: 120_000
        });
        // gate check
        const body = await page.locator("body").innerText();
        if (
          body.includes("접근") &&
          body.includes("권한") &&
          !body.includes("textarea")
        ) {
          // still try
        }
        const ta = page.locator("textarea").last();
        if (!(await ta.isVisible({ timeout: 20_000 }).catch(() => false))) {
          const errShot = resolve(shotDir, `gate-${item.person.name}.png`);
          await page.screenshot({ path: errShot, fullPage: true });
          state.errors.push(`luna gate fail: ${item.person.name}`);
          // skip this person's 15
          for (let k = 0; k < 15; k += 1) {
            const skipItem = plan[i + k];
            if (!skipItem || skipItem.person.name !== item.person.name) break;
            state.results.push({
              ...skipItem,
              ok: false,
              error: "luna_gate_fail",
              screenshot: errShot
            });
          }
          i += 14;
          lastPerson = item.person.name;
          continue;
        }
        lastPerson = item.person.name;
        currentRoom = 0;
        console.log(
          JSON.stringify({
            phase: "person",
            name: item.person.name,
            department: item.person.department
          })
        );
      }

      if (!page || !context) throw new Error("no page");

      if (item.room !== currentRoom) {
        if (currentRoom !== 0) await openNewRoom(page);
        currentRoom = item.room;
        await page.waitForTimeout(500);
      }

      const result = await askOne(page, item, shotDir);
      state.results.push(result);
      state.costEstUsd = Number(
        (state.results.filter((r) => r.ok).length * EST_USD_PER_Q).toFixed(3)
      );

      // mark conversation title after first Q of room
      if (item.index % 5 === 0) {
        await markConversationTitle(
          admin,
          profile.id as string,
          RUN_ID,
          item.room,
          state
        );
      }

      console.log(
        JSON.stringify({
          phase: "q",
          n: state.results.length,
          name: item.person.name,
          type: item.type,
          ok: result.ok,
          wallSec: result.wallSec,
          uiSec: result.uiSec,
          costEst: state.costEstUsd,
          err: result.error ?? null
        })
      );

      if (state.results.length % 5 === 0) {
        saveLocal(state);
        await saveRunRegistry(admin, state);
      }
    }

    // last person memo
    if (lastPerson) {
      const prev = byName.get(lastPerson)!;
      await rewriteUserMemo(admin, prev.id as string, { force: true });
      const mem = await snapshotMemo(admin, prev.id as string);
      state.memosAfter[lastPerson] = mem?.memo ?? "";
      if (page) {
        await openMyLunaMemo(page, lastPerson, shotDir).catch(() => null);
      }
    }
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // collect any missing memos
  for (const person of PERSONA_9) {
    if (state.memosAfter[person.name] != null) continue;
    const p = byName.get(person.name)!;
    const mem = await snapshotMemo(admin, p.id as string);
    state.memosAfter[person.name] = mem?.memo ?? "";
  }

  // perspective: current (>=3) and simulate >=2
  state.promote = await promoteSharedMemoPatterns(admin);

  // collect conversation message ids for cleanup
  if (state.conversationIds.length > 0) {
    const { data: msgs } = await admin
      .from("luna_messages")
      .select("id")
      .in("conversation_id", state.conversationIds);
    state.messageIds = (msgs ?? []).map((m) => m.id as string);
  }

  await saveRunRegistry(admin, state);
  saveLocal(state);

  // summary file for report
  const foundN = state.results.filter((r) => r.ok && r.reaction === "found")
    .length;
  const notFoundN = state.results.filter(
    (r) => r.ok && r.reaction === "not_found"
  ).length;
  const skipN = state.results.filter((r) => r.ok && r.reaction === "skip")
    .length;
  const failN = state.results.filter((r) => !r.ok).length;
  const byType: Record<string, number[]> = {};
  for (const r of state.results) {
    if (!r.ok || r.wallSec == null) continue;
    (byType[r.type] ??= []).push(r.wallSec);
  }
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const summary = {
    runId: RUN_ID,
    hubUrl: HUB_URL,
    done: state.results.length,
    ok: state.results.filter((r) => r.ok).length,
    failN,
    foundN,
    notFoundN,
    skipN,
    costEstUsd: state.costEstUsd,
    stoppedForCost: state.stoppedForCost,
    avgWallByType: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [
        k,
        Number((avg(v) ?? 0).toFixed(1))
      ])
    ),
    techLeakCount: state.results.filter((r) => r.hasTechLeak).length,
    memosAfter: state.memosAfter,
    promote: state.promote,
    betaGranted: state.betaGranted,
    conversationIds: state.conversationIds,
    errors: state.errors
  };
  writeFileSync(
    resolve(OUT_DIR, `summary-${RUN_ID}.json`),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ phase: "done", summary }, null, 2));

  // 05:00 자습에 안 섞이게 — 보고 파일 남긴 뒤 기본 정리
  if (process.env.P9_AUTO_CLEANUP !== "0") {
    console.log(JSON.stringify({ phase: "auto_cleanup_start" }));
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      "npx",
      [
        "--yes",
        "tsx",
        "--require",
        "./scripts/stub-server-only.cjs",
        "scripts/cleanup-persona-9x15.ts"
      ],
      {
        env: { ...process.env, P9_RUN_ID: RUN_ID },
        encoding: "utf8",
        cwd: process.cwd(),
        shell: true
      }
    );
    console.log(r.stdout || "");
    if (r.stderr) console.error(r.stderr);
    console.log(
      JSON.stringify({
        phase: "auto_cleanup_done",
        status: r.status
      })
    );
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
