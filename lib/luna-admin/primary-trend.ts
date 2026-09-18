import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDayBounds } from "@/lib/luna/selfstudy";
import { kstParts } from "@/lib/luna/eval-schedule";
import type { PrimaryTrendBar, PrimaryTrendPayload } from "@/lib/luna-admin/types";

function kstDate(iso: string): string {
  const p = kstParts(new Date(iso));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function labelOf(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return "오늘";
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${d}`;
}

async function timestamps(
  admin: SupabaseClient,
  table: string,
  column: string,
  startIso: string | null
): Promise<string[]> {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    let q = admin.from(table).select(column).order(column, { ascending: true }).range(from, from + 999);
    if (startIso) q = q.gte(column, startIso);
    const { data, error } = await q;
    if (error) break;
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const row of rows) {
      const v = row[column];
      if (typeof v === "string" && v) out.push(v);
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  return out;
}

function bucket(isos: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const iso of isos) {
    const k = kstDate(iso);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function addYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function eachYmd(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cur = from; cur <= to; cur = addYmd(cur, 1)) out.push(cur);
  return out;
}

function captionFor(bars: PrimaryTrendBar[]): string {
  if (bars.length === 0) return "지난 기록이 없어 오늘부터 쌓입니다.";
  let best: PrimaryTrendBar | null = null;
  let imgBest: PrimaryTrendBar | null = null;
  for (const b of bars) {
    if (!best || b.work + b.notion + b.image > best.work + best.notion + best.image) best = b;
    if (!imgBest || b.image > imgBest.image) imgBest = b;
  }
  if (!best || best.work + best.notion + best.image === 0) {
    return "지난 기록이 없어 오늘부터 쌓입니다.";
  }
  const line =
    best.work > 0
      ? `${best.label} 에 Work 본문 ${best.work.toLocaleString("ko-KR")}건이 한꺼번에 들어왔다.`
      : `${best.label} 에 ${[
          best.image > 0 ? `이미지 ${best.image.toLocaleString("ko-KR")}건` : "",
          best.notion > 0 ? `노션 ${best.notion.toLocaleString("ko-KR")}건` : ""
        ]
          .filter(Boolean)
          .join(" · ")}이 들어왔다.`;
  if (imgBest && imgBest.image > 20 && imgBest.date !== best.date) {
    return `${line} ${imgBest.label} 은 이미지 색인.`;
  }
  return line;
}

let trendCache: { key: string; at: number; payload: PrimaryTrendPayload } | null = null;

export async function buildPrimaryTrend(
  admin: SupabaseClient,
  raw: string | null
): Promise<PrimaryTrendPayload> {
  const range: PrimaryTrendPayload["range"] =
    raw === "7" || raw === "90" || raw === "all" ? raw : "30";
  const cacheKey = range;
  if (trendCache && trendCache.key === cacheKey && Date.now() - trendCache.at < 5 * 60 * 1000) {
    return trendCache.payload;
  }
  const t0 = Date.now();
  const today = kstDayBounds();
  const todayYmd = kstDate(today.startIso);
  const days = range === "7" ? 7 : range === "90" ? 90 : range === "all" ? 400 : 30;
  const start =
    range === "all"
      ? null
      : kstDayBounds(new Date(Date.now() - (days - 1) * 86_400_000)).startIso;

  const [workIso, notionIso, imageIso] = await Promise.all([
    timestamps(admin, "nas_file_text", "created_at", start),
    timestamps(admin, "luna_notion_pages", "indexed_at", start),
    timestamps(admin, "luna_media_index", "indexed_at", start)
  ]);
  const workB = bucket(workIso);
  const notionB = bucket(notionIso);
  const imageB = bucket(imageIso);

  const keys = [...workB.keys(), ...notionB.keys(), ...imageB.keys()].sort();
  const fromYmd =
    range === "all" ? (keys[0] ?? todayYmd) : start ? kstDate(start) : todayYmd;
  const sliced = eachYmd(fromYmd, todayYmd);
  const bars: PrimaryTrendBar[] = sliced.map((date) => ({
    date,
    label: labelOf(date, todayYmd),
    work: workB.get(date) ?? 0,
    notion: notionB.get(date) ?? 0,
    image: imageB.get(date) ?? 0
  }));

  const payload: PrimaryTrendPayload = {
    range,
    bars,
    caption: captionFor(bars),
    query_ms: Date.now() - t0
  };
  trendCache = { key: cacheKey, at: Date.now(), payload };
  return payload;
}
