import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  formatDurationSec
} from "@/lib/luna/knowledge-format";
import { kstParts } from "@/lib/luna/eval-schedule";
import {
  getNotionIndexStats,
  getRunningNotionIndex,
  listNotionIndexRuns,
  type NotionIndexRunRow
} from "@/lib/luna/notion-index-runner";
import {
  getNotionIndexExclude,
  getNotionIndexSchedule
} from "@/lib/luna/notion-index-settings";

export const runtime = "nodejs";

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

function formatRunWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = kstParts(d);
  const now = kstParts(new Date());
  const hm = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const sameDay =
    p.year === now.year && p.month === now.month && p.day === now.day;
  if (sameDay) return `오늘 ${hm}`;
  const yest = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const y = kstParts(yest);
  if (p.year === y.year && p.month === y.month && p.day === y.day) {
    return `어제 ${hm}`;
  }
  return `${p.month}월 ${p.day}일 ${hm}`;
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "0초";
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}초`;
  return `${m}분 ${s}초`;
}

function serializeRun(run: NotionIndexRunRow) {
  return {
    id: run.id,
    mode: run.mode,
    mode_label: run.mode === "full" ? "전체" : "증분",
    started_at: run.started_at,
    finished_at: run.finished_at,
    when_label: formatRunWhen(run.finished_at ?? run.started_at),
    pages_total: run.pages_total,
    pages_processed: run.pages_processed,
    pages_skipped: run.pages_skipped,
    blocks: run.blocks,
    embeddings_added: run.embeddings_added,
    duration_ms: run.duration_ms,
    duration_label:
      run.duration_ms != null
        ? formatDurationSec(Math.round(run.duration_ms / 1000))
        : "—",
    status: run.status,
    error_message: run.error_message,
    triggered_by: run.triggered_by,
    abort_requested: run.abort_requested,
    elapsed_label: run.status === "running" ? formatElapsed(run.started_at) : null,
    progress_pct:
      run.pages_total > 0
        ? Math.min(100, Math.round((run.pages_processed / run.pages_total) * 100))
        : 0
  };
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  try {
    const connected = Boolean(process.env.NOTION_TOKEN?.trim());
    const [schedule, exclude, stats, running, history] = await Promise.all([
      getNotionIndexSchedule(admin),
      getNotionIndexExclude(admin),
      getNotionIndexStats(admin),
      getRunningNotionIndex(admin),
      listNotionIndexRuns(admin, 10)
    ]);

    const lastSuccess = stats.last_success;
    const lastFailed = stats.last_failed;
    const showFailureBanner =
      !running &&
      lastFailed &&
      (!lastSuccess ||
        new Date(lastFailed.finished_at ?? lastFailed.started_at).getTime() >
          new Date(lastSuccess.finished_at ?? lastSuccess.started_at).getTime());

    const asOfLabel = lastSuccess
      ? `${formatRunWhen(lastSuccess.finished_at ?? lastSuccess.started_at)} 기준`
      : null;

    const changedLast =
      lastSuccess?.checkpoint &&
      typeof lastSuccess.checkpoint.changed_pages === "number"
        ? lastSuccess.checkpoint.changed_pages
        : lastSuccess
          ? Math.max(0, lastSuccess.pages_processed - lastSuccess.pages_skipped)
          : null;

    return NextResponse.json({
      connected,
      connection: {
        connected,
        teamspaces: stats.teamspaces,
        accessible_pages: stats.pages,
        subtitle: connected
          ? `통합 토큰 정상 · 팀스페이스 ${stats.teamspaces.toLocaleString()}곳 · 접근 가능 페이지 ${stats.pages.toLocaleString()}`
          : "NOTION_TOKEN을 설정하면 검색·색인을 사용합니다"
      },
      stats: {
        pages: stats.pages,
        blocks: stats.blocks,
        embeddings: stats.embeddings,
        avg_blocks_per_page: stats.avg_blocks_per_page,
        last_index_label: lastSuccess
          ? formatRunWhen(lastSuccess.finished_at ?? lastSuccess.started_at)
          : "—",
        last_changed: changedLast,
        as_of_label: showFailureBanner ? asOfLabel : null,
        captions: {
          pages: stats.pages > 0 ? "전체와 같음" : "색인 없음",
          blocks:
            stats.avg_blocks_per_page != null
              ? `평균 ${stats.avg_blocks_per_page}개`
              : "—",
          embeddings: `${exclude.min_block_length}자 미만 제외`,
          last:
            changedLast != null
              ? `바뀐 것 ${changedLast.toLocaleString()}건`
              : "—"
        }
      },
      schedule,
      exclude,
      running: running ? serializeRun(running) : null,
      failure: showFailureBanner && lastFailed ? serializeRun(lastFailed) : null,
      history: history.map(serializeRun),
      rules: [
        { left: "먼저 보는 것", right: "색인" },
        { left: "실시간 조회", right: "최근 수정분만" },
        { left: "결과 없을 때", right: "웹으로 보완" },
        { left: "출처 표기", right: "노션 / 워크 구분" }
      ]
    });
  } catch (err) {
    console.error("[luna/notion/overview]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Overview failed" },
      { status: 500 }
    );
  }
}
