import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { scheduleNotionIndexContinue } from "@/lib/luna/notion-index-continue";
import {
  alreadyStartedNotionIndexToday,
  getRunningNotionIndex,
  runNotionIndexChunk
} from "@/lib/luna/notion-index-runner";
import {
  getNotionIndexSchedule,
  shouldRunNotionIndexNow,
  type NotionIndexMode
} from "@/lib/luna/notion-index-settings";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/notion-index?mode=full|incremental
 * GET /api/cron/notion-index?continue=<runId>
 *
 * Vercel Cron 은 10분마다 호출. luna_settings.notion_index_schedule 시각과
 * 맞을 때만 새 실행을 시작하고, running 이면 청크를 이어간다.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[notion-index] CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const continueId = request.nextUrl.searchParams.get("continue");
  if (continueId) {
    try {
      const result = await runNotionIndexChunk(admin, {
        mode: "full",
        triggeredBy: "cron",
        continueRunId: continueId
      });
      if (result.continued) {
        scheduleNotionIndexContinue(request, result.run.id);
      }
      return NextResponse.json({
        continued: true,
        done: result.done,
        run: result.run
      });
    } catch (err) {
      console.error("[notion-index] continue", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Continue failed" },
        { status: 500 }
      );
    }
  }

  const modeParam = request.nextUrl.searchParams.get("mode");
  const modes: NotionIndexMode[] =
    modeParam === "full" || modeParam === "incremental"
      ? [modeParam]
      : ["full", "incremental"];

  const schedule = await getNotionIndexSchedule(admin);
  const out: Record<string, unknown> = { schedule };

  // 진행 중이면 mode 무관하게 이어가기
  const running = await getRunningNotionIndex(admin);
  if (running) {
    try {
      const result = await runNotionIndexChunk(admin, {
        mode: running.mode,
        triggeredBy: running.triggered_by,
        continueRunId: running.id
      });
      if (result.continued) {
        scheduleNotionIndexContinue(request, result.run.id);
      }
      out.running = {
        continued: result.continued,
        done: result.done,
        run: result.run
      };
      return NextResponse.json(out);
    } catch (err) {
      console.error("[notion-index] resume", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Resume failed" },
        { status: 500 }
      );
    }
  }

  for (const mode of modes) {
    if (!shouldRunNotionIndexNow(schedule, mode)) {
      out[mode] = {
        skipped: true,
        reason: schedule[mode].enabled ? "not due" : "disabled"
      };
      continue;
    }
    if (await alreadyStartedNotionIndexToday(admin, mode, "cron")) {
      out[mode] = { skipped: true, reason: "already ran today" };
      continue;
    }
    try {
      const result = await runNotionIndexChunk(admin, {
        mode,
        triggeredBy: "cron"
      });
      if (result.continued) {
        scheduleNotionIndexContinue(request, result.run.id);
      }
      out[mode] = {
        skipped: false,
        done: result.done,
        continued: result.continued,
        run: result.run
      };
      // 한 번에 한 모드만 시작
      break;
    } catch (err) {
      console.error(`[notion-index] ${mode}`, err);
      out[mode] = {
        error: err instanceof Error ? err.message : "Index failed"
      };
    }
  }

  console.log("[notion-index] cron", out);
  return NextResponse.json(out);
}
