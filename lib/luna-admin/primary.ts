import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDurationSec } from "@/lib/luna/knowledge-format";
import { kstParts } from "@/lib/luna/eval-schedule";
import { getNotionIndexSchedule } from "@/lib/luna/notion-index-settings";
import { formatStorageBytes } from "@/lib/luna/storage";
import {
  IMAGE_AFTER_EXCLUDE,
  IMAGE_CORPUS_TOTAL,
  IMAGE_SCAN_TOTAL,
  IMAGE_UNREAD
} from "@/lib/luna-admin/primary-constants";
import {
  deltaNum,
  kindNum,
  loadOrComputeSourceStats,
  type SourceStatsRow
} from "@/lib/luna-admin/source-stats";
import type {
  PrimaryCheckRow,
  PrimaryFlowStep,
  PrimaryKindCard,
  PrimaryNotionDbRow,
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
export {
  IMAGE_AFTER_EXCLUDE,
  IMAGE_CORPUS_TOTAL,
  IMAGE_SCAN_TOTAL,
  IMAGE_UNREAD
} from "@/lib/luna-admin/primary-constants";

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

function scheduleFromPromise(promiseLabel: string | null | undefined): string {
  if (!promiseLabel) return "—";
  return promiseLabel.replace(/\s*약속$/, "");
}

function kindCard(
  id: string,
  label: string,
  count: number,
  note: string,
  delta: number | null,
  extra: string | null,
  tone: string,
  ic: string
): PrimaryKindCard {
  const base = deltaLabel(delta);
  return {
    id,
    label,
    count,
    note,
    delta,
    delta_label: extra ? (delta && delta !== 0 ? extra : base) : base,
    tone,
    ic
  };
}

function notionDbsFromStats(row: SourceStatsRow): PrimaryNotionDbRow[] {
  const raw = row.by_kind.db_rows;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is PrimaryNotionDbRow => {
    if (!x || typeof x !== "object") return false;
    const o = x as Record<string, unknown>;
    return typeof o.database_id === "string";
  });
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
  const [
    stats,
    settingsRes,
    notionRunRes,
    notionSchedule,
    imageLatestRes,
    imageRunRes,
    checksRes,
    storageSnap
  ] = await Promise.all([
    loadOrComputeSourceStats(admin),
    admin.from("nas_scan_settings").select("*").eq("id", 1).maybeSingle(),
    admin
      .from("luna_notion_index_runs")
      .select("finished_at, started_at, duration_ms")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getNotionIndexSchedule(admin),
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
    admin
      .from("luna_storage_snapshots")
      .select("table_name, bytes")
      .eq("taken_on", statsDayOrToday())
      .neq("table_name", "")
  ]);

  const workStats = stats.work;
  const notionStats = stats.notion;
  const wikiStats = stats.wiki;
  const glossStats = stats.glossary;

  const nasAll = workStats.total;
  const nasFolders = kindNum(workStats, "folders");
  const nasFiles = kindNum(workStats, "files");
  const textOk = kindNum(workStats, "docs");
  const textAll = kindNum(workStats, "text_all");
  const textEmpty = kindNum(workStats, "text_empty");
  const textSkipped = kindNum(workStats, "text_skipped");
  const textFailed = kindNum(workStats, "text_failed");
  const chunkCount = kindNum(workStats, "chunks");
  const unread = kindNum(workStats, "unread");
  const imageCount = kindNum(workStats, "images");
  const imageCorpus = kindNum(workStats, "image_corpus") || IMAGE_CORPUS_TOTAL;
  const imageScan = kindNum(workStats, "image_scan") || IMAGE_SCAN_TOTAL;
  const imageAfter = kindNum(workStats, "image_after_exclude") || IMAGE_AFTER_EXCLUDE;
  const imageUnread = kindNum(workStats, "image_unread") || IMAGE_UNREAD;

  const notionPages = kindNum(notionStats, "pages") || notionStats.total;
  const notionBlocks = kindNum(notionStats, "blocks");
  const notionChunks = kindNum(notionStats, "chunks");
  const notionEmbeds = kindNum(notionStats, "embeddings") || notionChunks;
  const notionRels = kindNum(notionStats, "relations");
  const notionDbs = kindNum(notionStats, "databases");

  const wikiCount = kindNum(wikiStats, "docs") || wikiStats.total;
  const wikiSections = kindNum(wikiStats, "sections");
  const wikiMenuCount = kindNum(wikiStats, "menus") || 7;

  const glossaryCount = kindNum(glossStats, "terms") || glossStats.total;
  const glossCommon = kindNum(glossStats, "cat_common");
  const glossSpace = kindNum(glossStats, "cat_space");
  const glossSyn = kindNum(glossStats, "synonyms");

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

  const extractPct = textAll > 0 ? Math.round((textOk / textAll) * 100) : 0;
  const avgChunks = textOk > 0 ? Math.round((chunkCount / textOk) * 10) / 10 : 0;

  const yWorkFiles = deltaNum(workStats, "files");
  const yWorkText = deltaNum(workStats, "docs");
  const yImage = deltaNum(workStats, "images");
  const yNotion = deltaNum(notionStats, "pages");
  const yNotionChunks = deltaNum(notionStats, "chunks");
  const yWiki = deltaNum(wikiStats, "docs");
  const yGloss = deltaNum(glossStats, "terms");

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
    yNotion != null && yNotionChunks != null && yNotionChunks !== yNotion
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
  const imageLight = lightFromIdleDays(imageDays);
  const imagePct =
    imageCorpus > 0
      ? Math.max(0, Math.round((imageCount / imageCorpus) * 1000) / 10)
      : 0;
  const image: PrimarySourceRow = {
    source: "image",
    label: "이미지",
    count: imageCount,
    extra_count: imageCorpus,
    size_label: `${num(imageCount)} / ${num(imageCorpus)}`,
    schedule_label: "01:00 (증분)",
    last_iso: imageLast,
    last_label: formatWhen(imageLast),
    duration_label: "—",
    status: imageLight,
    status_label: statusLabel(imageLight, imageDays),
    note: `${num(imageCorpus)} 중 ${imagePct}%`,
    delta: yImage,
    delta_label: deltaLabel(yImage)
  };

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
    { t: "파일", v: nasFiles, d: "전체", q: "file" },
    { t: "읽을 수 있는 문서", v: textAll, d: "pdf·pptx·xlsx·docx", q: "doc" },
    { t: "본문 추출", v: textOk, d: `${extractPct}%`, q: "doc" },
    { t: "청크", v: chunkCount, d: `평균 ${avgChunks}개`, q: "chunk" },
    {
      t: "못 읽음",
      v: unread,
      d: `skip ${num(textSkipped)} · 빈손 ${num(textEmpty)} · 실패 ${num(textFailed)}`,
      loss: true,
      q: "unread"
    }
  ];

  const left = Math.max(0, imageCorpus - imageCount);
  const image_flow: PrimaryFlowStep[] = [
    { t: "전체 이미지", v: imageScan },
    { t: "제외 후", v: imageAfter, d: "휴지통·캐시·중복 제외" },
    { t: "색인 대상", v: imageCorpus },
    { t: "색인됨", v: imageCount, d: `${imagePct}% · ${num(left)} 남음` },
    { t: "읽지 못함", v: imageUnread, d: "psd·ai", loss: true }
  ];

  const notionAvg =
    notionPages > 0 ? Math.round((notionChunks / notionPages) * 10) / 10 : 0;
  const blockAvg =
    notionPages > 0 ? Math.round((notionBlocks / notionPages) * 10) / 10 : 0;
  const embedPct =
    notionChunks > 0
      ? Math.max(0, Math.round((notionEmbeds / notionChunks) * 1000) / 10)
      : 0;

  const notion_flow: PrimaryFlowStep[] = [
    { t: "페이지", v: notionPages, q: "page" },
    { t: "블록", v: notionBlocks, d: `평균 ${blockAvg}개`, q: "block" },
    { t: "청크", v: notionChunks, d: `평균 ${notionAvg}개`, q: "chunk" },
    { t: "임베딩", v: notionEmbeds, d: `HNSW · ${embedPct}%`, q: "embed" },
    { t: "관계", v: notionRels, d: "2차 데이터로", q: "rel" }
  ];

  const wiki_flow: PrimaryFlowStep[] = [
    { t: "문서", v: wikiCount, q: "doc" },
    { t: "섹션", v: wikiSections || wikiMenuCount, d: "사람이 씀", q: "section" }
  ];

  const glossary_flow: PrimaryFlowStep[] = [
    { t: "용어", v: glossaryCount, q: "term" },
    { t: "동의어", v: glossSyn, q: "syn" },
    {
      t: "분류",
      v: glossCommon + glossSpace,
      d: `공통 ${num(glossCommon)} · 공간 ${num(glossSpace)}`,
      q: "cat"
    }
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
  if (!storageSnap.error && Array.isArray(storageSnap.data) && storageSnap.data.length > 0) {
    for (const row of storageSnap.data as Array<{ table_name?: string; bytes?: number }>) {
      tableBytes.set(String(row.table_name ?? ""), Number(row.bytes ?? 0));
    }
  } else {
    const live = await admin.rpc("luna_storage_top_tables", { limit_n: 30 });
    if (!live.error && Array.isArray(live.data)) {
      for (const row of live.data as Array<{ table_name?: string; bytes?: number }>) {
        tableBytes.set(String(row.table_name ?? ""), Number(row.bytes ?? 0));
      }
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

  const foldersT = kindNum(workStats, "folders_t");
  const foldersP = kindNum(workStats, "folders_p");
  const filesT = kindNum(workStats, "files_t");
  const filesP = kindNum(workStats, "files_p");
  const unreadHwp = kindNum(workStats, "unread_hwp");
  const unreadDrawing = kindNum(workStats, "unread_drawing");

  const work_kinds: PrimaryKindCard[] = [
    kindCard(
      "folders",
      "경로",
      nasFolders,
      `T: ${num(foldersT)} · P: ${num(foldersP)}`,
      0,
      null,
      "fold",
      "📁"
    ),
    kindCard(
      "files",
      "파일",
      nasFiles,
      `T: ${num(filesT)} · P: ${num(filesP)}`,
      yWorkFiles,
      null,
      "work",
      "📄"
    ),
    kindCard(
      "docs",
      "문서 본문",
      textOk,
      `청크 ${num(chunkCount)}`,
      yWorkText,
      yWorkText
        ? `+${yWorkText.toLocaleString("ko-KR")} 청크`
        : null,
      "notion",
      "본"
    ),
    kindCard(
      "images",
      "이미지",
      imageCount,
      `${num(imageCorpus)} 중 ${imagePct}%`,
      yImage,
      null,
      "img",
      "📷"
    ),
    kindCard(
      "unread",
      "못 읽음",
      unread,
      `hwp ${num(unreadHwp)} · 도면 ${num(unreadDrawing)}`,
      0,
      null,
      "faint",
      "—"
    )
  ];

  const notion_kinds: PrimaryKindCard[] = [
    kindCard(
      "page",
      "페이지",
      notionPages,
      `DB ${num(notionDbs)}개 · 아카이브 제외`,
      yNotion,
      null,
      "notion",
      "P"
    ),
    kindCard(
      "block",
      "블록",
      notionBlocks,
      `페이지당 평균 ${blockAvg}개`,
      deltaNum(notionStats, "blocks"),
      null,
      "notion",
      "B"
    ),
    kindCard(
      "chunk",
      "청크",
      notionChunks,
      `페이지당 평균 ${notionAvg}개`,
      yNotionChunks,
      null,
      "notion",
      "C"
    ),
    kindCard(
      "rel",
      "관계",
      notionRels,
      "2차 데이터로 쓰임",
      deltaNum(notionStats, "relations"),
      null,
      "notion",
      "R"
    )
  ];

  const wiki_kinds: PrimaryKindCard[] = [
    kindCard("doc", "문서", wikiCount, "사람이 씀", yWiki, null, "wiki", "위"),
    kindCard(
      "section",
      "섹션",
      wikiSections || wikiMenuCount,
      `${wikiMenuCount}분류`,
      null,
      null,
      "wiki",
      "§"
    )
  ];

  const glossary_kinds: PrimaryKindCard[] = [
    kindCard("term", "용어", glossaryCount, "검색·이미지에 씀", yGloss, null, "term", "용"),
    kindCard("syn", "동의어", glossSyn, "같은 뜻의 다른 말", null, null, "term", "同"),
    kindCard(
      "cat",
      "분류",
      glossCommon + glossSpace,
      `공통 ${num(glossCommon)} · 공간 ${num(glossSpace)}`,
      null,
      null,
      "term",
      "분"
    )
  ];

  const query_ms = Date.now() - t0;
  const payload: PrimaryPayload = {
    work,
    notion,
    image,
    wiki,
    glossary,
    rows: [work, notion, wiki, glossary],
    work_flow,
    notion_flow,
    image_flow,
    wiki_flow,
    glossary_flow,
    work_kinds,
    notion_kinds,
    wiki_kinds,
    glossary_kinds,
    notion_dbs: notionDbsFromStats(notionStats),
    checks,
    storage,
    nav_counts: {
      work: nasAll,
      notion: notionPages,
      wiki: wikiCount,
      glossary: glossaryCount
    },
    stats: {
      day: stats.day,
      computed_at: stats.computed_at,
      from_snapshot: stats.from_snapshot
    },
    query_ms
  };

  payloadCache = { at: Date.now(), payload };
  return payload;
}

function statsDayOrToday(): string {
  const p = kstParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
