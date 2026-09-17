/**
 * Playwright 로 /devnote 화면을 연다.
 * 실계정 없이 쿠키 세션 + REST 가로채기로 데이터를 채운다.
 *
 * npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-devnote-browser.ts
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { loadDevnoteBlockers } from "../lib/devnote/blockers";
import { loadDevnoteDecisions } from "../lib/devnote/decisions";
import { loadDevnoteIdeas } from "../lib/devnote/ideas";
import { loadDevnoteNav } from "../lib/devnote/load-nav";
import { loadDevnoteOverview } from "../lib/devnote/overview";
import { loadDevnoteServiceNote } from "../lib/devnote/service";
import type {
  DevnoteBlockerRow,
  DevnoteDecisionListRow,
  DevnoteIdeaRow,
  DevnoteNavData,
  DevnoteOverviewRow,
  DevnoteServiceRow,
  DevnoteTodoRow
} from "../lib/devnote/types";

loadEnv({ path: ".env.local" });
loadEnv();

const BASE = process.env.DEVNOTE_BROWSER_BASE?.trim() || "http://127.0.0.1:3001";

type Fixture = {
  nav: DevnoteNavData;
  overview: DevnoteOverviewRow;
  blockers: DevnoteBlockerRow[];
  decisions: DevnoteDecisionListRow[];
  ideas: DevnoteIdeaRow[];
  services: Array<Record<string, unknown>>;
  luna: {
    service: DevnoteServiceRow;
    decisions: DevnoteDecisionListRow[];
    todos: DevnoteTodoRow[];
  };
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return {
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers": "content-range, prefer-count",
      ...extraHeaders
    },
    body: JSON.stringify(data)
  };
}

async function loadFixture(): Promise<Fixture> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!service) throw new Error("missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const [nav, overview, blockers, decisions, ideas, luna, servicesRes] =
      await Promise.all([
        loadDevnoteNav(admin),
        loadDevnoteOverview(admin),
        loadDevnoteBlockers(admin),
        loadDevnoteDecisions(admin),
        loadDevnoteIdeas(admin),
        loadDevnoteServiceNote(admin, "luna"),
        admin
          .from("devnote_services")
          .select(
            "id, slug, name, path, repo, status, overview, data_notes, updated_at, sort_order"
          )
          .order("sort_order", { ascending: true })
      ]);
    if (!nav || !luna) throw new Error("nav/luna missing");
    if (servicesRes.error) throw new Error(servicesRes.error.message);
    return {
      nav,
      overview,
      blockers,
      decisions,
      ideas,
      services: servicesRes.data ?? [],
      luna: {
        service: luna.service,
        decisions: luna.decisions.map((d) => ({
          ...d,
          service_name: luna.service.name,
          service_slug: luna.service.slug
        })),
        todos: luna.todos
      }
    };
  } catch (err) {
    console.warn(
      "[verify-devnote-browser] live load failed, using fixture:",
      err instanceof Error ? err.message.slice(0, 120) : err
    );
    const lunaId = "01776a13-bd46-451e-82b0-87192d958cee";
    return {
      nav: {
        services: [
          { slug: "luna", name: "LUNA", status: "stuck" },
          { slug: "nas-scanner", name: "NAS 스캐너", status: "wip" }
        ],
        decisionCount: 76,
        ideaCount: 0,
        openBlockerCount: 14
      },
      overview: {
        body: "개발노트 개요 픽스처",
        env: "환경",
        structure: "구조",
        principles: "원칙",
        updated_at: "2026-09-17T00:00:00.000Z"
      },
      blockers: [
        {
          id: "b1",
          service_id: lunaId,
          service_name: "LUNA",
          service_slug: "luna",
          service_status: "stuck",
          title: "자습이 헛일을 고른다",
          body: "픽스처 본문",
          since: "2026-09-17",
          resolved_at: null
        },
        {
          id: "b2",
          service_id: lunaId,
          service_name: "LUNA",
          service_slug: "luna",
          service_status: "stuck",
          title: "파일 본문을 안 읽는다",
          body: "픽스처 본문 2",
          since: "2026-09-17",
          resolved_at: null
        }
      ],
      decisions: [
        {
          id: "d1",
          service_id: lunaId,
          decided_on: "2026-09-17",
          what: "Work 파일 본문 색인을 검토한다.",
          why: "가장 많은데 가장 얕다.",
          is_key: true,
          service_name: "LUNA",
          service_slug: "luna"
        },
        {
          id: "d2",
          service_id: lunaId,
          decided_on: "2026-09-16",
          what: "PPTX 는 yauzl 로 엔트리만 꺼낸다.",
          why: "",
          is_key: false,
          service_name: "NAS 스캐너",
          service_slug: "nas-scanner"
        }
      ],
      ideas: [],
      services: [
        {
          id: lunaId,
          slug: "luna",
          name: "LUNA",
          path: "/luna",
          repo: null,
          status: "stuck",
          overview: "LUNA 개요 픽스처 본문입니다. ".repeat(8),
          data_notes: "데이터 노트 픽스처. ".repeat(8),
          updated_at: "2026-09-17T00:00:00.000Z",
          sort_order: 1
        }
      ],
      luna: {
        service: {
          id: lunaId,
          slug: "luna",
          name: "LUNA",
          path: "/luna",
          repo: null,
          status: "stuck",
          overview: "LUNA 개요 픽스처 본문입니다. ".repeat(8),
          data_notes: "데이터 노트 픽스처. ".repeat(8),
          updated_at: "2026-09-17T00:00:00.000Z"
        },
        decisions: [
          {
            id: "d1",
            service_id: lunaId,
            decided_on: "2026-09-17",
            what: "Work 파일 본문 색인을 검토한다.",
            why: "가장 많은데 가장 얕다.",
            is_key: true,
            service_name: "LUNA",
            service_slug: "luna"
          }
        ],
        todos: [
          {
            id: "t1",
            service_id: lunaId,
            title: "할 일 픽스처",
            body: null,
            done: false,
            sort_order: 0
          }
        ]
      }
    };
  }
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const {
    nav,
    overview,
    blockers,
    decisions,
    ideas,
    services,
    luna
  } = await loadFixture();

  const host = new URL(url).host;
  const projectRef = host.split(".")[0]!;
  const fakeUser = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "devnote-browser@example.com",
    role: "authenticated",
    aud: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z"
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const fakeSession = {
    access_token: "devnote-browser-access",
    refresh_token: "devnote-browser-refresh",
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user: fakeUser
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const cookieName = `sb-${projectRef}-auth-token`;
  await context.addCookies([
    {
      name: cookieName,
      value: encodeURIComponent(JSON.stringify(fakeSession)),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax"
    }
  ]);

  await page.route(`**://${host}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname;

    if (req.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS"
        }
      });
      return;
    }

    if (path.startsWith("/auth/v1/")) {
      if (path.includes("/user")) {
        await route.fulfill(json(fakeUser));
        return;
      }
      if (path.includes("/token") || path.includes("/session")) {
        await route.fulfill(json(fakeSession));
        return;
      }
      await route.fulfill(json({}));
      return;
    }

    if (path === "/rest/v1/profiles") {
      await route.fulfill(
        json([
          {
            id: fakeUser.id,
            role: "슈퍼관리자",
            email: fakeUser.email,
            name: "브라우저검증",
            department: "-",
            team: "-"
          }
        ])
      );
      return;
    }

    if (path === "/rest/v1/devnote_overview") {
      await route.fulfill(
        json([
          {
            id: 1,
            body: overview.body,
            env: overview.env,
            structure: overview.structure,
            principles: overview.principles,
            updated_at: overview.updated_at
          }
        ])
      );
      return;
    }

    if (path === "/rest/v1/devnote_services") {
      let rows = services;
      if (u.search.includes("slug=eq.")) {
        const m = u.search.match(/slug=eq\.([^&]+)/);
        const slug = m ? decodeURIComponent(m[1]) : "";
        rows = services.filter((s) => s.slug === slug);
      }
      await route.fulfill(json(rows));
      return;
    }

    if (path === "/rest/v1/devnote_blockers") {
      if (req.method() === "GET" && /select=id\b/.test(u.search) && !u.search.includes("title")) {
        await route.fulfill({
          ...json([]),
          headers: {
            ...json([]).headers,
            "content-range": `*/${nav.openBlockerCount}`
          }
        });
        return;
      }
      await route.fulfill(
        json(
          blockers.map((b) => ({
            id: b.id,
            service_id: b.service_id,
            title: b.title,
            body: b.body,
            since: b.since,
            resolved_at: b.resolved_at
          }))
        )
      );
      return;
    }

    if (path === "/rest/v1/devnote_decisions") {
      if (req.method() === "GET" && /select=id\b/.test(u.search) && !u.search.includes("what")) {
        await route.fulfill({
          ...json([]),
          headers: {
            ...json([]).headers,
            "content-range": `*/${nav.decisionCount}`
          }
        });
        return;
      }
      let rows = decisions.map((d) => ({
        id: d.id,
        service_id: d.service_id,
        decided_on: d.decided_on,
        what: d.what,
        why: d.why,
        is_key: d.is_key
      }));
      const m = u.search.match(/service_id=eq\.([^&]+)/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        rows = rows.filter((r) => r.service_id === id);
      }
      await route.fulfill(json(rows));
      return;
    }

    if (path === "/rest/v1/devnote_ideas") {
      if (req.method() === "GET" && /select=id\b/.test(u.search) && !u.search.includes("title")) {
        await route.fulfill({
          ...json([]),
          headers: {
            ...json([]).headers,
            "content-range": `*/${nav.ideaCount}`
          }
        });
        return;
      }
      await route.fulfill(
        json(
          ideas.map((i) => ({
            id: i.id,
            service_id: i.service_id,
            title: i.title,
            body: i.body,
            stage: i.stage,
            sort_order: i.sort_order
          }))
        )
      );
      return;
    }

    if (path === "/rest/v1/devnote_todos") {
      await route.fulfill(
        json(
          luna.todos.map((t) => ({
            id: t.id,
            service_id: t.service_id,
            title: t.title,
            body: t.body,
            done: t.done,
            sort_order: t.sort_order
          }))
        )
      );
      return;
    }

    await route.fulfill(json({}));
  });

  const paths = [
    "/devnote",
    "/devnote/blockers",
    "/devnote/decisions",
    "/devnote/ideas",
    "/devnote/s/luna",
    "/devnote/s/luna?tab=decisions",
    "/devnote/s/luna?tab=data",
    "/devnote/s/luna?tab=todos"
  ] as const;

  const report: Record<
    string,
    { title: string; bodySnippet: string; ok: boolean; note: string }
  > = {};

  for (const path of paths) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page
      .waitForFunction(
        () => {
          const t = document.body?.innerText ?? "";
          return (
            t.includes("기본 정보") ||
            t.includes("막힌 것") ||
            t.includes("결정 기록") ||
            t.includes("만들고 싶은 것") ||
            t.includes("LUNA") ||
            t.includes("팀 포털 로그인") ||
            t.includes("접근할 수 없습니다")
          ) && !t.includes("인증 상태를 확인하는 중");
        },
        { timeout: 30_000 }
      )
      .catch(() => null);
    await page.waitForTimeout(800);
    const text = ((await page.locator("body").innerText()) || "")
      .replace(/\s+/g, " ")
      .trim();
    const title = await page
      .locator("h1")
      .first()
      .innerText()
      .catch(() => "");
    let ok = false;
    let note = "";
    if (text.includes("팀 포털 로그인") || text.includes("접근할 수 없습니다")) {
      ok = false;
      note = "auth blocked";
    } else if (path === "/devnote/blockers") {
      ok =
        /파일 본문을 안 읽는다|자습이 헛일을 고른다/.test(text) &&
        /해결됨|일째/.test(text);
      note = ok ? "blocker rows visible" : `missing blocker content: ${text.slice(0, 80)}`;
    } else if (path === "/devnote/decisions") {
      ok =
        /제목·본문 검색|중요만/.test(text) &&
        /\d+\s*\/\s*\d+건/.test(text) &&
        text.length > 80;
      note = ok ? "search UI + list" : `stub or empty: ${text.slice(0, 80)}`;
    } else if (path === "/devnote/ideas") {
      ok = /다음에|언젠가|씨앗|아직 적힌 것이 없습니다/.test(text);
      note = ok ? "ideas stages UI" : "stub";
    } else if (path === "/devnote") {
      ok = /기본 정보/.test(text) && text.length > 40;
      note = ok ? "overview" : "empty";
    } else if (path.includes("tab=decisions")) {
      ok = text.length > 80;
      note = ok ? "service decisions" : "empty";
    } else if (path.includes("tab=todos")) {
      ok = text.length > 40;
      note = "todos tab";
    } else if (path.includes("tab=data")) {
      ok = text.length > 60;
      note = "data tab";
    } else {
      ok = /LUNA/.test(text) && text.length > 60;
      note = "service overview";
    }
    report[path] = { title, bodySnippet: text.slice(0, 240), ok, note };
  }

  await browser.close();
  console.log(JSON.stringify({ base: BASE, report }, null, 2));
  const failed = Object.entries(report).filter(([, r]) => !r.ok);
  if (failed.length) {
    console.error(
      "FAILED",
      failed.map(([p, r]) => `${p}: ${r.note}`)
    );
    process.exit(1);
  }
  console.log("verify-devnote-browser OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
