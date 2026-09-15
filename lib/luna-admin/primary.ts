import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDurationSec } from "@/lib/luna/knowledge-format";
import { kstParts } from "@/lib/luna/eval-schedule";
import {
  getNotionIndexStats,
  type NotionIndexRunRow
} from "@/lib/luna/notion-index-runner";
import { getNotionIndexSchedule } from "@/lib/luna/notion-index-settings";
import type { PrimaryPayload, PrimarySourceRow } from "@/lib/luna-admin/types";
import {
  formatIdleLabel,
  kstCalendarDaysAgo,
  lightFromIdleDays,
  type TrafficLight
} from "@/lib/luna-admin/traffic";

export type { PrimaryPayload, PrimarySourceRow };

/** scripts/index-media.ts 의 전체 이미지 규모 상수와 같음 */
export const IMAGE_CORPUS_TOTAL = 77_065;

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = kstParts(d);
  const now = kstParts(new Date());
  const hm = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  if (p.year === now.year && p.month === now.month && p.day === now.day) {
    return `오늘 ${hm}`;
  }
  return `${String(p.month).padStart(2, "0")}.${String(p.day).padStart(2, "0")} ${hm}`;
}

function statusLabel(light: TrafficLight, days: number | null): string {
  if (light === "green") return "정상";
  if (light === "yellow") return "지연";
  if (days == null) return "기록 없음";
  return "멈춤";
}

async function countTable(
  admin: SupabaseClient,
  table: string
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}

export async function buildPrimarySources(
  admin: SupabaseClient
): Promise<PrimaryPayload> {
  const [
    settingsRes,
    totalRes,
    pathsRes,
    notionStats,
    notionSchedule,
    wikiCount,
    glossaryCount,
    imageCountRes,
    imageLatestRes
  ] = await Promise.all([
    admin.from("nas_scan_settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("nas_directory").select("id", { count: "exact", head: true }),
    admin.from("nas_important_paths").select("id", { count: "exact", head: true }),
    getNotionIndexStats(admin),
    getNotionIndexSchedule(admin),
    countTable(admin, "luna_library"),
    countTable(admin, "glossary_terms"),
    admin.from("luna_media_index").select("path", { count: "exact", head: true }),
    admin
      .from("luna_media_index")
      .select("indexed_at")
      .order("indexed_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const settings = settingsRes.data;
  const workLast = (settings?.last_run_at as string | null) ?? null;
  const workDays = kstCalendarDaysAgo(workLast);
  const workLight = lightFromIdleDays(workDays);
  const workDuration =
    typeof settings?.last_duration_sec === "number"
      ? formatDurationSec(settings.last_duration_sec)
      : "—";
  const scanHour = typeof settings?.scan_hour === "number" ? settings.scan_hour : 3;
  const scanMinute = typeof settings?.scan_minute === "number" ? settings.scan_minute : 0;

  const work: PrimarySourceRow = {
    source: "workserver",
    label: "Work서버",
    count: totalRes.count ?? 0,
    size_label: `${(totalRes.count ?? 0).toLocaleString("ko-KR")}건 · 중요 ${pathsRes.count ?? 0}경로`,
    schedule_label: `매일 ${String(scanHour).padStart(2, "0")}:${String(scanMinute).padStart(2, "0")}`,
    last_iso: workLast,
    last_label: workLast
      ? `${formatWhen(workLast)} · ${workDuration}`
      : "—",
    duration_label: workDuration,
    status: workLight,
    status_label: statusLabel(workLight, workDays),
    note: formatIdleLabel(workDays)
  };

  const lastSuccess = notionStats.last_success as NotionIndexRunRow | null;
  const notionLast = lastSuccess?.finished_at ?? lastSuccess?.started_at ?? null;
  const notionDays = kstCalendarDaysAgo(notionLast);
  const notionLight = lightFromIdleDays(notionDays);
  const full = notionSchedule.full.enabled ? notionSchedule.full.time : null;
  const inc = notionSchedule.incremental.enabled
    ? notionSchedule.incremental.time
    : null;
  const notionSched = [full ? `${full} 전체` : null, inc ? `${inc} 증분` : null]
    .filter(Boolean)
    .join(" · ");
  const notionDur =
    lastSuccess?.duration_ms != null
      ? formatDurationSec(Math.round(lastSuccess.duration_ms / 1000))
      : "—";

  const notion: PrimarySourceRow = {
    source: "notion",
    label: "노션",
    count: notionStats.pages,
    extra_count: notionStats.blocks,
    size_label: `${notionStats.pages.toLocaleString("ko-KR")}p · 블록 ${notionStats.blocks.toLocaleString("ko-KR")}`,
    schedule_label: notionSched || "스케줄 없음",
    last_iso: notionLast,
    last_label: notionLast ? `${formatWhen(notionLast)} · ${notionDur}` : "—",
    duration_label: notionDur,
    status: notionLight,
    status_label: statusLabel(notionLight, notionDays),
    note: formatIdleLabel(notionDays)
  };

  const imageCount = imageCountRes.error ? 0 : (imageCountRes.count ?? 0);
  const imageLast =
    !imageLatestRes.error && typeof imageLatestRes.data?.indexed_at === "string"
      ? imageLatestRes.data.indexed_at
      : null;
  const imageDays = kstCalendarDaysAgo(imageLast);
  const imageLight = lightFromIdleDays(imageDays);
  const imagePct =
    IMAGE_CORPUS_TOTAL > 0
      ? Math.max(0, Math.round((imageCount / IMAGE_CORPUS_TOTAL) * 1000) / 10)
      : 0;

  const image: PrimarySourceRow = {
    source: "image",
    label: "이미지",
    count: imageCount,
    extra_count: IMAGE_CORPUS_TOTAL,
    size_label: `${imageCount.toLocaleString("ko-KR")} / ${IMAGE_CORPUS_TOTAL.toLocaleString("ko-KR")}`,
    schedule_label: "04:00 (증분)",
    last_iso: imageLast,
    last_label: formatWhen(imageLast),
    duration_label: "—",
    status: imageLight,
    status_label: statusLabel(imageLight, imageDays),
    note: `${imagePct}% · ${formatIdleLabel(imageDays)}`
  };

  const wiki: PrimarySourceRow = {
    source: "wiki",
    label: "위키",
    count: wikiCount,
    size_label: `${wikiCount.toLocaleString("ko-KR")}문서`,
    schedule_label: "저장 즉시",
    last_iso: null,
    last_label: "—",
    duration_label: "—",
    status: "green",
    status_label: "정상",
    note: "사람이 씀"
  };

  const glossary: PrimarySourceRow = {
    source: "glossary",
    label: "용어사전",
    count: glossaryCount,
    size_label: `${glossaryCount.toLocaleString("ko-KR")}`,
    schedule_label: "저장 즉시",
    last_iso: null,
    last_label: "—",
    duration_label: "—",
    status: "green",
    status_label: "정상",
    note: "사람이 씀"
  };

  return {
    work,
    notion,
    image,
    wiki,
    glossary,
    rows: [work, notion, image, wiki, glossary]
  };
}
