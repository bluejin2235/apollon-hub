import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { scheduleNotionIndexContinue } from "@/lib/luna/notion-index-continue";
import {
  getRunningNotionIndex,
  requestAbortNotionIndex,
  reindexSingleNotionPage,
  runNotionIndexChunk
} from "@/lib/luna/notion-index-runner";
import type { NotionIndexMode } from "@/lib/luna/notion-index-settings";

export const runtime = "nodejs";
export const maxDuration = 300;

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      )
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, admin };
}

/** POST { mode?: 'full'|'incremental', action?: 'start'|'abort' } */
export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { user, admin } = gate;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const action = body.action === "abort" ? "abort" : body.action === "repair" ? "repair" : "start";

  if (action === "repair") {
    const pageId = typeof body.page_id === "string" ? body.page_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageId)) {
      return NextResponse.json({ error: "올바른 페이지 ID가 필요합니다" }, { status: 400 });
    }
    if (await getRunningNotionIndex(admin)) {
      return NextResponse.json({ error: "전체 색인이 진행 중입니다" }, { status: 409 });
    }
    try {
      const result = await reindexSingleNotionPage(admin, pageId);
      return NextResponse.json({ ok: true, page_id: pageId, ...result });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "페이지 재색인 실패" }, { status: 500 });
    }
  }

  if (action === "abort") {
    try {
      const run = await requestAbortNotionIndex(
        admin,
        typeof body.run_id === "string" ? body.run_id : undefined
      );
      return NextResponse.json({ ok: true, run });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Abort failed" },
        { status: 500 }
      );
    }
  }

  const mode: NotionIndexMode =
    body.mode === "incremental" ? "incremental" : "full";

  const running = await getRunningNotionIndex(admin);
  if (running) {
    return NextResponse.json(
      {
        error: "already_running",
        message: "이미 색인이 진행 중입니다",
        run: running
      },
      { status: 409 }
    );
  }

  try {
    const result = await runNotionIndexChunk(admin, {
      mode,
      triggeredBy: "manual",
      userId: user.id
    });
    if (result.continued) {
      scheduleNotionIndexContinue(request, result.run.id);
    }
    return NextResponse.json({
      ok: true,
      done: result.done,
      continued: result.continued,
      run: result.run
    });
  } catch (err) {
    console.error("[luna/notion/index]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Index failed" },
      { status: 500 }
    );
  }
}
