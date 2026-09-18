import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDayBounds } from "@/lib/luna/selfstudy";
import { kstParts } from "@/lib/luna/eval-schedule";
import { kstDateBounds } from "@/lib/luna-admin/period";
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

async function trendViaRpc(
  admin: SupabaseClient,
  startIso: string
): Promise<Array<{ day: string; work: number; notion: number; image: number }> | null> {
  const { data, error } = await admin.rpc("luna_primary_trend_days", { p_start: startIso });
  if (error) {
    console.error("[primary-trend] rpc", error.message);
    return null;
  }
  if (!Array.isArray(data)) return null;
  return (data as Array<{ day: string; work: number; notion: number; image: number }>).map((row) => ({
    day: String(row.day).slice(0, 10),
    work: Number(row.work) || 0,
    notion: Number(row.notion) || 0,
    image: Number(row.image) || 0
  }));
}

async function countDay(
  admin: SupabaseClient,
  table: string,
  column: string,
  ymd: string
): Promise<number> {
  const b = kstDateBounds(ymd);
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte(column, b.startIso)
    .lt(column, b.endIso);
  if (error) return 0;
  return count ?? 0;
}

async function trendViaCounts(
  admin: SupabaseClient,
  days: string[]
): Promise<Array<{ day: string; work: number; notion: number; image: number }>> {
  const rows = await Promise.all(
    days.map(async (day) => {
      const [work, notion, image] = await Promise.all([
        countDay(admin, "nas_file_text", "extracted_at", day),
        countDay(admin, "luna_notion_pages", "indexed_at", day),
        countDay(admin, "luna_media_index", "indexed_at", day)
      ]);
      return { day, work, notion, image };
    })
  );
  return rows;
}

let trendCache: { key: string; at: number; payload: PrimaryTrendPayload } | null = null;

export async function buildPrimaryTrend(
  admin: SupabaseClient,
  raw: string | null
): Promise<PrimaryTrendPayload> {
  const range: PrimaryTrendPayload["range"] =
    raw === "7" || raw === "90" || raw === "all" ? raw : "30";
  if (trendCache && trendCache.key === range && Date.now() - trendCache.at < 5 * 60 * 1000) {
    return trendCache.payload;
  }
  const t0 = Date.now();
  const today = kstDayBounds();
  const todayYmd = kstDate(today.startIso);
  const dayCount = range === "7" ? 7 : range === "90" ? 90 : range === "all" ? 400 : 30;
  const start = kstDayBounds(new Date(Date.now() - (dayCount - 1) * 86_400_000)).startIso;
  const fromYmd = kstDate(start);
  const days = eachYmd(fromYmd, todayYmd);

  const rpc = await trendViaRpc(admin, start);
  const grouped = rpc ?? (await trendViaCounts(admin, days));
  const byDay = new Map(grouped.map((r) => [r.day, r]));

  const bars: PrimaryTrendBar[] = days.map((date) => {
    const row = byDay.get(date);
    return {
      date,
      label: labelOf(date, todayYmd),
      work: row?.work ?? 0,
      notion: row?.notion ?? 0,
      image: row?.image ?? 0
    };
  });

  const payload: PrimaryTrendPayload = {
    range,
    bars,
    caption: captionFor(bars),
    query_ms: Date.now() - t0
  };
  trendCache = { key: range, at: Date.now(), payload };
  return payload;
}
