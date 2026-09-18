import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDurationSec } from "@/lib/luna/knowledge-format";
import { kstOvernightJobBounds, kstParts } from "@/lib/luna/eval-schedule";
import { getNotionIndexSchedule } from "@/lib/luna/notion-index-settings";
import { kstDayBounds } from "@/lib/luna/selfstudy";
import { formatStorageBytes } from "@/lib/luna/storage";
import {
  ADMIN_REPORT_HOUR,
  ADMIN_REPORT_MINUTE
} from "@/lib/luna-admin/schedule";
import type {
  PrimaryCheckRow,
  PrimaryFlowStep,
  PrimaryPayload,
  PrimarySourceRow,
  PrimaryStorageRow
} from "@/lib/luna-admin/types";
import {
  kstCalendarDaysAgo,
  lightFromIdleDays,
  worstLight,
  type TrafficLight
} from "@/lib/luna-admin/traffic";

export type { PrimaryPayload, PrimarySourceRow };

/** scripts/index-media.ts 의 전체 이미지 규모 상수와 같음 */
export const IMAGE_CORPUS_TOTAL = 77_065;
/** 이미지 색인 파이프라인 — 회사 PC 전수 스캔 규모 (nas_directory 가 아님) */
export const IMAGE_SCAN_TOTAL = 2_436_857;
export const IMAGE_AFTER_EXCLUDE = 198_302;
export const IMAGE_UNREAD = 235;

const CHECK_IDS = ["work_index", "work_text", "notion_index", "image_index"] as const;
const CHECK_NAMES: Record<(typeof CHECK_IDS)[number], string> = {
  work_index: "Work 스캔",
  work_text: "Work 본문",
  notion_index: "노션",
  image_index: "이미지"
};

const STORAGE_ROWS: Array<{
  name: string;
  color: string;
  tables: string[];
}> = [
  {
    name: "노션",
    color: "#4A5568",
    tables: [
      "luna_notion_pages",
      "luna_notion_blocks",
      "luna_notion_chunks",
      "luna_notion_chunk_embeddings",
      "luna_notion_embeddings",
      "luna_notion_relations"
    ]
  },
  {
    name: "Work 본문",
    color: "#2E8B7A",
    tables: ["nas_file_text", "nas_file_chunks"]
  },
  { name: "Work 목록", color: "#2E8B7A", tables: ["nas_directory"] },
  {
    name: "이미지",
    color: "#4A7FB5",
    tables: ["luna_media_index", "luna_media_index_runs"]
  }
];

const CACHE_MS = 5 * 60 * 1000;

type CacheEntry = { at: number; payload: PrimaryPayload };

let payloadCache: CacheEntry | null = null;

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

function checkStatusLabel(light: TrafficLight): string {
  if (light === "green") return "정상";
  if (light === "yellow") return "지연";
  return "멈춤";
}

function lightFromCheckStatus(status: string | null | undefined): TrafficLight {
  if (status === "ok") return "green";
  if (status === "warn") return "yellow";
  return "red";
}

function deltaLabel(delta: number | null): string {
  if (delta == null || delta === 0) return "— 어제";
  if (delta > 0) return `+${delta.toLocaleString("ko-KR")} 어제`;
  return `${delta.toLocaleString("ko-KR")} 어제`;
}

function signedCount(n: number): string {
  return n > 0 ? `+${n.toLocaleString("ko-KR")}` : n.toLocaleString("ko-KR");
}

/** 0은 숨기고, 값이 있는 쪽만 「파일 +12 · 본문 +8 어제」 */
function pairDeltaLabel(
  parts: Array<{ key: string; n: number | null }>
): { delta: number | null; label: string } {
  const measured = parts.filter((p) => p.n != null);
  const shown = measured.filter((p) => p.n !== 0);
  if (shown.length === 0) {
    return { delta: measured.length > 0 ? 0 : null, label: "— 어제" };
  }
  return {
    delta: shown.reduce((sum, p) => sum + (p.n ?? 0), 0),
    label: `${shown.map((p) => `${p.key} ${signedCount(p.n as number)}`).join(" · ")} 어제`
  };
}

function num(n: number): string {
  return n.toLocaleString("ko-KR");
}

async function countHead(
  admin: SupabaseClient,
  table: string,
  filter?: { eq?: [string, string | boolean]; contains?: [string, string[]] }
): Promise<number> {
  const base = admin.from(table).select("*", { count: "exact", head: true });
  const filtered = filter?.contains
    ? base.contains(filter.contains[0], filter.contains[1])
    : filter?.eq
      ? base.eq(filter.eq[0], filter.eq[1])
      : base;
  const { count, error } = await filtered;
  if (error) return 0;
  return count ?? 0;
}

async function countYesterday(
  admin: SupabaseClient,
  table: string,
  column: string,
  startIso: string,
  endIso: string,
  filter?: { eq: [string, string] }
): Promise<number | null> {
  let q = admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte(column, startIso)
    .lt(column, endIso);
  if (filter?.eq) q = q.eq(filter.eq[0], filter.eq[1]);
  const { count, error } = await q;
  if (error) return null;
  return count ?? 0;
}

function scheduleFromPromise(promiseLabel: string | null | undefined): string {
  if (!promiseLabel) return "—";
  return promiseLabel.replace(/\s*약속$/, "");
}

export async function buildPrimarySources(
  admin: SupabaseClient,
  opts?: { bypassCache?: boolean }
): Promise<PrimaryPayload> {
  if (
    !opts?.bypassCache &&
    payloadCache &&
    Date.now() - payloadCache.at < CACHE_MS
  ) {
    return payloadCache.payload;
  }

  const t0 = Date.now();
  const yesterday = kstDayBounds(new Date(Date.now() - 86_400_000));
  const overnight = kstOvernightJobBounds(
    new Date(),
    ADMIN_REPORT_HOUR,
    ADMIN_REPORT_MINUTE
  );

  const [
    settingsRes,
    nasAll,
    nasFiles,
    textAll,
    textOk,
    textEmpty,
    textSkipped,
    textFailed,
    chunkCount,
    notionPages,
    notionBlocks,
    notionChunks,
    notionRels,
    notionRunRes,
    notionSchedule,
    wikiCount,
    wikiMenus,
    glossaryCount,
    glossCommon,
    glossSpace,
    imageCount,
    imageLatestRes,
    imageRunRes,
    checksRes,
    storageRes,
    yWorkFiles,
    yWorkText,
    yNotion,
    yNotionChunks,
    yImage,
    yWiki,
    yGloss
  ] = await Promise.all([
    admin.from("nas_scan_settings").select("*").eq("id", 1).maybeSingle(),
    countHead(admin, "nas_directory"),
    countHead(admin, "nas_directory", { eq: ["type", "file"] }),
    countHead(admin, "nas_file_text"),
    countHead(admin, "nas_file_text", { eq: ["status", "ok"] }),
    countHead(admin, "nas_file_text", { eq: ["status", "empty"] }),
    countHead(admin, "nas_file_text", { eq: ["status", "skipped"] }),
    countHead(admin, "nas_file_text", { eq: ["status", "failed"] }),
    countHead(admin, "nas_file_chunks"),
    countHead(admin, "luna_notion_pages"),
    countHead(admin, "luna_notion_blocks"),
    countHead(admin, "luna_notion_chunks"),
    countHead(admin, "luna_notion_relations"),
    admin
      .from("luna_notion_index_runs")
      .select("finished_at, started_at, duration_ms")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getNotionIndexSchedule(admin),
    countHead(admin, "luna_library"),
    countHead(admin, "luna_wiki_menus", { eq: ["is_active", true] }),
    countHead(admin, "glossary_terms"),
    countHead(admin, "glossary_terms", { contains: ["categories", ["공통"]] }),
    countHead(admin, "glossary_terms", { contains: ["categories", ["공간"]] }),
    countHead(admin, "luna_media_index"),
    admin
      .from("luna_media_index")
      .select("indexed_at")
      .order("indexed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("luna_media_index_runs")
      .select("finished_at, started_at")
      .in("status", ["done", "interrupted"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("luna_checks")
      .select("id, label, promise_label, status, last_ok_at, days_stale")
      .in("id", [...CHECK_IDS]),
    admin.rpc("luna_storage_top_tables", { limit_n: 30 }),
    countYesterday(
      admin,
      "nas_directory",
      "modified_at",
      overnight.startIso,
      overnight.endIso,
      { eq: ["type", "file"] }
    ),
    countYesterday(
      admin,
      "nas_file_text",
      "extracted_at",
      overnight.startIso,
      overnight.endIso
    ),
    countYesterday(
      admin,
      "luna_notion_pages",
      "indexed_at",
      overnight.startIso,
      overnight.endIso
    ),
    countYesterday(
      admin,
      "luna_notion_chunk_embeddings",
      "updated_at",
      overnight.startIso,
      overnight.endIso
    ),
    countYesterday(
      admin,
      "luna_media_index",
      "indexed_at",
      overnight.startIso,
      overnight.endIso
    ),
    countYesterday(
      admin,
      "luna_library",
      "created_at",
      yesterday.startIso,
      yesterday.endIso
    ),
    countYesterday(
      admin,
      "glossary_terms",
      "created_at",
      yesterday.startIso,
      yesterday.endIso
    )
  ]);

  const checkById = new Map(
    ((checksRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id),
      row
    ])
  );

  const settings = settingsRes.data;
  const workLast = (settings?.last_run_at as string | null) ?? null;
  const workDays = kstCalendarDaysAgo(workLast);
  const workScanLight = lightFromIdleDays(workDays);
  const workTextRow = checkById.get("work_text");
  const workTextLight = lightFromCheckStatus(
    typeof workTextRow?.status === "string" ? workTextRow.status : null
  );
  const workLight = worstLight(workScanLight, workTextLight);
  const workDuration =
    typeof settings?.last_duration_sec === "number"
      ? formatDurationSec(settings.last_duration_sec)
      : "—";
  const scanHour = typeof settings?.scan_hour === "number" ? settings.scan_hour : 3;
  const scanMinute = typeof settings?.scan_minute === "number" ? settings.scan_minute : 0;

  const unread = textSkipped + textEmpty + textFailed;
  const extractPct =
    textAll > 0 ? Math.round((textOk / textAll) * 100) : 0;
  const avgChunks =
    textOk > 0 ? Math.round((chunkCount / textOk) * 10) / 10 : 0;

  const workDelta = pairDeltaLabel([
    { key: "파일", n: yWorkFiles },
    { key: "본문", n: yWorkText }
  ]);
  const work: PrimarySourceRow = {
    source: "workserver",
    label: "Work서버",
    count: nasAll,
    extra_count: nasFiles,
    size_label: `파일 ${num(nasFiles)} · 본문 ${num(textOk)}`,
    schedule_label: `매일 ${String(scanHour).padStart(2, "0")}:${String(scanMinute).padStart(2, "0")}`,
    last_iso: workLast,
    last_label: workLast ? `${formatWhen(workLast)} · ${workDuration}` : "—",
    duration_label: workDuration,
    status: workLight,
    status_label: statusLabel(workLight, workDays),
    note: `파일 ${num(nasFiles)} · 본문 ${num(textOk)}`,
    delta: workDelta.delta,
    delta_label: workDelta.label
  };

  const notionRun = !notionRunRes.error ? notionRunRes.data : null;
  const notionLast =
    typeof notionRun?.finished_at === "string"
      ? notionRun.finished_at
      : typeof notionRun?.started_at === "string"
        ? notionRun.started_at
        : null;
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
    typeof notionRun?.duration_ms === "number"
      ? formatDurationSec(Math.round(notionRun.duration_ms / 1000))
      : "—";
  const notionDelta =
    yNotion != null &&
    yNotionChunks != null &&
    yNotionChunks !== yNotion
      ? pairDeltaLabel([
          { key: "페이지", n: yNotion },
          { key: "청크", n: yNotionChunks }
        ])
      : { delta: yNotion, label: deltaLabel(yNotion) };
  const notion: PrimarySourceRow = {
    source: "notion",
    label: "노션",
    count: notionPages,
    extra_count: notionChunks,
    unit: "p",
    size_label: `${num(notionPages)}p · 청크 ${num(notionChunks)}`,
    schedule_label: notionSched || "스케줄 없음",
    last_iso: notionLast,
    last_label: notionLast ? `${formatWhen(notionLast)} · ${notionDur}` : "—",
    duration_label: notionDur,
    status: notionLight,
    status_label: statusLabel(notionLight, notionDays),
    note: `청크 ${num(notionChunks)} · 관계 ${num(notionRels)}`,
    delta: notionDelta.delta,
    delta_label: notionDelta.label
  };

  const imageRun = !imageRunRes.error ? imageRunRes.data : null;
  const imageRunAt =
    typeof imageRun?.finished_at === "string"
      ? imageRun.finished_at
      : typeof imageRun?.started_at === "string"
        ? imageRun.started_at
        : null;
  const imageRowAt =
    !imageLatestRes.error && typeof imageLatestRes.data?.indexed_at === "string"
      ? imageLatestRes.data.indexed_at
      : null;
  const imageLast = imageRunAt ?? imageRowAt;
  const imageDays = kstCalendarDaysAgo(imageLast);
  let imageLight = lightFromIdleDays(imageDays);
  const imagePct =
    IMAGE_CORPUS_TOTAL > 0
      ? Math.max(0, Math.round((imageCount / IMAGE_CORPUS_TOTAL) * 1000) / 10)
      : 0;
  if (imageLight === "green" && imagePct < 50) imageLight = "yellow";

  const image: PrimarySourceRow = {
    source: "image",
    label: "이미지",
    count: imageCount,
    extra_count: IMAGE_CORPUS_TOTAL,
    size_label: `${num(imageCount)} / ${num(IMAGE_CORPUS_TOTAL)}`,
    schedule_label: "01:00 (증분)",
    last_iso: imageLast,
    last_label: formatWhen(imageLast),
    duration_label: "—",
    status: imageLight,
    status_label: statusLabel(imageLight, imageDays),
    note: `${num(IMAGE_CORPUS_TOTAL)} 중 ${imagePct}%`,
    delta: yImage,
    delta_label: deltaLabel(yImage)
  };

  const wikiMenuCount = wikiMenus || 7;
  const wiki: PrimarySourceRow = {
    source: "wiki",
    label: "위키",
    count: wikiCount,
    extra_count: wikiMenuCount,
    size_label: `${num(wikiCount)}문서`,
    schedule_label: "저장 즉시",
    last_iso: null,
    last_label: "—",
    duration_label: "—",
    status: "green",
    status_label: "정상",
    note: `${wikiMenuCount}분류 · 사람이 씀`,
    delta: yWiki,
    delta_label: deltaLabel(yWiki)
  };

  const glossary: PrimarySourceRow = {
    source: "glossary",
    label: "용어사전",
    count: glossaryCount,
    size_label: num(glossaryCount),
    schedule_label: "저장 즉시",
    last_iso: null,
    last_label: "—",
    duration_label: "—",
    status: "green",
    status_label: "정상",
    note: `공통 ${num(glossCommon)} · 공간 ${num(glossSpace)}`,
    delta: yGloss,
    delta_label: deltaLabel(yGloss)
  };

  const work_flow: PrimaryFlowStep[] = [
    { t: "파일", v: nasFiles, d: "전체" },
    { t: "읽을 수 있는 문서", v: textAll, d: "pdf·pptx·xlsx·docx" },
    { t: "본문 추출", v: textOk, d: `${extractPct}%` },
    { t: "청크", v: chunkCount, d: `평균 ${avgChunks}개` },
    {
      t: "못 읽음",
      v: unread,
      d: `skip ${num(textSkipped)} · 빈손 ${num(textEmpty)} · 실패 ${num(textFailed)}`,
      loss: true
    }
  ];

  const imagePctFlow =
    IMAGE_CORPUS_TOTAL > 0
      ? Math.max(0, Math.round((imageCount / IMAGE_CORPUS_TOTAL) * 1000) / 10)
      : 0;
  const notionAvg =
    notionPages > 0 ? Math.round((notionChunks / notionPages) * 10) / 10 : 0;

  const image_flow: PrimaryFlowStep[] = [
    { t: "전체 이미지", v: IMAGE_SCAN_TOTAL },
    { t: "제외 후", v: IMAGE_AFTER_EXCLUDE, d: "휴지통·캐시·중복 제외" },
    { t: "색인 대상", v: IMAGE_CORPUS_TOTAL },
    { t: "색인됨", v: imageCount, d: `${imagePctFlow}%` },
    { t: "읽지 못함", v: IMAGE_UNREAD, d: "psd·ai", loss: true }
  ];

  const notion_flow: PrimaryFlowStep[] = [
    { t: "페이지", v: notionPages },
    { t: "블록", v: notionBlocks },
    { t: "청크", v: notionChunks, d: `평균 ${notionAvg}개` },
    { t: "임베딩", v: notionChunks, d: "HNSW" },
    { t: "관계", v: notionRels, d: "2차 데이터로" }
  ];

  const wiki_flow: PrimaryFlowStep[] = [
    { t: "문서", v: wikiCount },
    { t: "분류", v: wikiMenuCount, d: "사람이 씀" }
  ];

  const glossary_flow: PrimaryFlowStep[] = [
    { t: "용어", v: glossaryCount },
    { t: "공통", v: glossCommon },
    { t: "공간", v: glossSpace }
  ];

  const checks: PrimaryCheckRow[] = CHECK_IDS.map((id) => {
    const row = checkById.get(id);
    const lastIso =
      typeof row?.last_ok_at === "string" ? row.last_ok_at : null;
    const light = lightFromCheckStatus(
      typeof row?.status === "string" ? row.status : null
    );
    return {
      id,
      name: CHECK_NAMES[id],
      schedule_label: scheduleFromPromise(
        typeof row?.promise_label === "string" ? row.promise_label : null
      ),
      last_label: formatWhen(lastIso),
      status: light,
      status_label: checkStatusLabel(light)
    };
  });

  const tableBytes = new Map<string, number>();
  if (!storageRes.error && Array.isArray(storageRes.data)) {
    for (const row of storageRes.data as Array<{
      table_name?: string;
      bytes?: number;
    }>) {
      tableBytes.set(String(row.table_name ?? ""), Number(row.bytes ?? 0));
    }
  }
  const storageBuilt: PrimaryStorageRow[] = STORAGE_ROWS.map((spec) => {
    const bytes = spec.tables.reduce((sum, name) => sum + (tableBytes.get(name) ?? 0), 0);
    return {
      name: spec.name,
      bytes,
      bytes_label: formatStorageBytes(bytes),
      color: spec.color,
      bar_pct: 0
    };
  });
  const maxBytes = Math.max(1, ...storageBuilt.map((r) => r.bytes));
  const storage = storageBuilt.map((r) => ({
    ...r,
    bar_pct: Math.max(3, Math.round((r.bytes / maxBytes) * 100))
  }));

  const query_ms = Date.now() - t0;
  const payload: PrimaryPayload = {
    work,
    notion,
    image,
    wiki,
    glossary,
    rows: [work, notion, image, wiki, glossary],
    work_flow,
    notion_flow,
    image_flow,
    wiki_flow,
    glossary_flow,
    checks,
    storage,
    query_ms
  };

  payloadCache = { at: Date.now(), payload };
  return payload;
}
