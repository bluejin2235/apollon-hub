/**
 * LUNA 관리자 · 저장 공간
 * DB 용량은 RPC 실시간. Storage/Egress 는 Management API 자리만.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/luna/eval-schedule";

export const LUNA_DB_DISK_LIMIT_GB = (() => {
  const raw = process.env.LUNA_DB_DISK_LIMIT_GB?.trim();
  const n = raw ? Number(raw) : 8;
  return Number.isFinite(n) && n > 0 ? n : 8;
})();

export const LUNA_DB_DISK_LIMIT_BYTES = Math.round(
  LUNA_DB_DISK_LIMIT_GB * 1024 * 1024 * 1024
);

/** Storage / Egress — SUPABASE_ACCESS_TOKEN 생기면 Management API 로 채운다 */
export type LunaPlatformUsage = {
  storage_bytes: number | null;
  storage_limit_bytes: number | null;
  egress_bytes: number | null;
  egress_limit_bytes: number | null;
  edge_invocations: number | null;
  edge_limit: number | null;
  source: "unavailable" | "management_api";
  note: string;
};

const GROUP_ORDER = [
  "노션",
  "Work서버",
  "2차 데이터",
  "이미지",
  "위키·용어",
  "LUNA 기타",
  "트렌드",
  "그 밖"
] as const;

const GROUP_COLORS: Record<string, string> = {
  노션: "#534AB7",
  Work서버: "#2E8B7A",
  "2차 데이터": "#C97B3F",
  이미지: "#4A7FB5",
  "위키·용어": "#8E6BA8",
  "LUNA 기타": "#5B8C5A",
  트렌드: "#B5654A",
  "그 밖": "#b0b5bd"
};

const CACHE_MS = 5 * 60 * 1000;
const SLOW_MS = 300;

type RawUsage = { grp: string; bytes: number };
type RawTable = { table_name: string; bytes: number };

type CacheEntry = {
  at: number;
  groups: RawUsage[];
  tables: RawTable[];
  rpc_ms: number;
  cached: boolean;
};

let usageCache: CacheEntry | null = null;

export type StorageGroupRow = {
  grp: string;
  bytes: number;
  color: string;
  pct_of_limit: number;
};

export type StorageTableRow = {
  table_name: string;
  bytes: number;
  yesterday_delta_bytes: number | null;
  legacy?: boolean;
};

export type StorageForecastRow = {
  id: string;
  label: string;
  note: string;
  estimated_bytes: number;
  status: "pending" | "running" | "done";
  monthly?: boolean;
};

export type StorageDashboard = {
  region_label: string;
  plan_label: string;
  supabase_url: string | null;
  used_bytes: number;
  limit_bytes: number;
  limit_gb: number;
  used_pct: number;
  free_bytes: number;
  warn_level: "ok" | "warn" | "bad";
  groups: StorageGroupRow[];
  tables: StorageTableRow[];
  forecast: StorageForecastRow[];
  forecast_total_bytes: number;
  forecast_pct: number;
  platform: LunaPlatformUsage;
  disk_expansions_used: number | null;
  disk_expansions_max: number | null;
  overage_usd_per_gb: number;
  years_to_limit_label: string;
  legacy_embeddings: {
    table_name: string;
    bytes: number;
    after_delete_bytes: number;
  } | null;
  rpc_ms: number;
  rpc_cached: boolean;
  has_yesterday: boolean;
};

function kstToday(): string {
  const p = kstParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function kstYesterday(): string {
  const d = new Date(Date.now() - 86400000);
  const p = kstParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function formatStorageBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024 * 1024) {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  }
  if (abs >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 100 ? Math.round(mb) : mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  }
  if (abs >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function warnLevelFromPct(pct: number): "ok" | "warn" | "bad" {
  if (pct >= 85) return "bad";
  if (pct >= 70) return "warn";
  return "ok";
}

async function fetchLiveUsage(
  admin: SupabaseClient
): Promise<{ groups: RawUsage[]; tables: RawTable[]; rpc_ms: number }> {
  const t0 = Date.now();
  const [gRes, tRes] = await Promise.all([
    admin.rpc("luna_storage_usage"),
    admin.rpc("luna_storage_top_tables", { limit_n: 6 })
  ]);
  const rpc_ms = Date.now() - t0;
  if (gRes.error) throw new Error(`luna_storage_usage: ${gRes.error.message}`);
  if (tRes.error) {
    throw new Error(`luna_storage_top_tables: ${tRes.error.message}`);
  }
  const groups = ((gRes.data ?? []) as Array<{ grp?: string; bytes?: number }>).map(
    (r) => ({
      grp: String(r.grp ?? "그 밖"),
      bytes: Number(r.bytes ?? 0)
    })
  );
  const tables = (
    (tRes.data ?? []) as Array<{ table_name?: string; bytes?: number }>
  ).map((r) => ({
    table_name: String(r.table_name ?? ""),
    bytes: Number(r.bytes ?? 0)
  }));
  return { groups, tables, rpc_ms };
}

export async function loadStorageUsageRaw(
  admin: SupabaseClient,
  opts?: { bypassCache?: boolean }
): Promise<CacheEntry> {
  if (
    !opts?.bypassCache &&
    usageCache &&
    Date.now() - usageCache.at < CACHE_MS
  ) {
    return { ...usageCache, cached: true };
  }
  const live = await fetchLiveUsage(admin);
  const entry: CacheEntry = {
    at: Date.now(),
    groups: live.groups,
    tables: live.tables,
    rpc_ms: live.rpc_ms,
    cached: false
  };
  // 300ms 넘을 때만 5분 캐시
  if (live.rpc_ms > SLOW_MS) {
    usageCache = entry;
  } else {
    usageCache = null;
  }
  return entry;
}

/**
 * Management API 자리.
 * SUPABASE_ACCESS_TOKEN + project ref 가 있으면 나중에 채운다.
 */
export async function fetchPlatformUsage(): Promise<LunaPlatformUsage> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    return {
      storage_bytes: null,
      storage_limit_bytes: 100 * 1024 * 1024 * 1024,
      egress_bytes: null,
      egress_limit_bytes: 250 * 1024 * 1024 * 1024,
      edge_invocations: null,
      edge_limit: 2_000_000,
      source: "unavailable",
      note: "Supabase Management API 토큰이 없어 가져오지 못합니다"
    };
  }
  // TODO: SUPABASE_ACCESS_TOKEN 으로 usage API 호출
  return {
    storage_bytes: null,
    storage_limit_bytes: 100 * 1024 * 1024 * 1024,
    egress_bytes: null,
    egress_limit_bytes: 250 * 1024 * 1024 * 1024,
    edge_invocations: null,
    edge_limit: 2_000_000,
    source: "unavailable",
    note: "Management API 연동 자리만 있음 — 아직 호출하지 않음"
  };
}

function supabaseDashboardUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const ref = host.split(".")[0];
    if (!ref) return null;
    return `https://supabase.com/dashboard/project/${ref}`;
  } catch {
    return null;
  }
}

export async function takeStorageSnapshot(
  admin: SupabaseClient,
  takenOn = kstToday()
): Promise<{ groups: number; tables: number }> {
  const live = await loadStorageUsageRaw(admin, { bypassCache: true });
  const rows: Array<{
    taken_on: string;
    grp: string;
    table_name: string;
    bytes: number;
  }> = [];
  for (const g of live.groups) {
    rows.push({
      taken_on: takenOn,
      grp: g.grp,
      table_name: "",
      bytes: g.bytes
    });
  }
  for (const t of live.tables) {
    rows.push({
      taken_on: takenOn,
      grp: "",
      table_name: t.table_name,
      bytes: t.bytes
    });
  }
  // 같은 날 재실행이면 지우고 다시
  await admin.from("luna_storage_snapshots").delete().eq("taken_on", takenOn);
  if (rows.length > 0) {
    const { error } = await admin.from("luna_storage_snapshots").insert(rows);
    if (error) throw new Error(`luna_storage_snapshots: ${error.message}`);
  }
  return { groups: live.groups.length, tables: live.tables.length };
}

async function loadYesterdayTableBytes(
  admin: SupabaseClient
): Promise<Map<string, number> | null> {
  const y = kstYesterday();
  const { data, error } = await admin
    .from("luna_storage_snapshots")
    .select("table_name, bytes")
    .eq("taken_on", y)
    .neq("table_name", "");
  if (error) {
    console.error("[luna/storage] yesterday", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  const map = new Map<string, number>();
  for (const row of data) {
    map.set(String(row.table_name), Number(row.bytes ?? 0));
  }
  return map;
}

export async function buildStorageDashboard(
  admin: SupabaseClient
): Promise<StorageDashboard> {
  const live = await loadStorageUsageRaw(admin);

  const yesterday = await loadYesterdayTableBytes(admin);
  const has_yesterday = yesterday != null;

  const byGrp = new Map(live.groups.map((g) => [g.grp, g.bytes]));
  const groups: StorageGroupRow[] = [];
  for (const grp of GROUP_ORDER) {
    const bytes = byGrp.get(grp) ?? 0;
    if (bytes <= 0) continue;
    groups.push({
      grp,
      bytes,
      color: GROUP_COLORS[grp] ?? "#b0b5bd",
      pct_of_limit: (bytes / LUNA_DB_DISK_LIMIT_BYTES) * 100
    });
  }
  for (const g of live.groups) {
    if (GROUP_ORDER.includes(g.grp as (typeof GROUP_ORDER)[number])) continue;
    if (g.bytes <= 0) continue;
    groups.push({
      grp: g.grp,
      bytes: g.bytes,
      color: GROUP_COLORS[g.grp] ?? "#b0b5bd",
      pct_of_limit: (g.bytes / LUNA_DB_DISK_LIMIT_BYTES) * 100
    });
  }

  const used_bytes = live.groups.reduce((s, g) => s + g.bytes, 0);
  const used_pct = (used_bytes / LUNA_DB_DISK_LIMIT_BYTES) * 100;
  const free_bytes = Math.max(0, LUNA_DB_DISK_LIMIT_BYTES - used_bytes);

  const tables: StorageTableRow[] = live.tables.map((t) => {
    const yBytes = yesterday?.get(t.table_name);
    return {
      table_name: t.table_name,
      bytes: t.bytes,
      yesterday_delta_bytes:
        yBytes == null ? null : t.bytes - yBytes,
      legacy: t.table_name === "luna_notion_embeddings"
    };
  });

  const { data: forecastRows, error: fErr } = await admin
    .from("luna_storage_forecast")
    .select("id, label, note, estimated_bytes, status, sort_order")
    .order("sort_order", { ascending: true });
  if (fErr) console.error("[luna/storage] forecast", fErr.message);

  const forecast: StorageForecastRow[] = (forecastRows ?? []).map((r) => ({
    id: String(r.id),
    label: String(r.label),
    note: String(r.note ?? ""),
    estimated_bytes: Number(r.estimated_bytes ?? 0),
    status: (r.status as StorageForecastRow["status"]) ?? "pending",
    monthly: String(r.note ?? "").includes("월") || String(r.label) === "증분"
  }));

  const oneTimeExtra = forecast
    .filter((f) => f.status !== "done" && !f.monthly)
    .reduce((s, f) => s + f.estimated_bytes, 0);
  const forecast_total_bytes = used_bytes + oneTimeExtra;
  const forecast_pct = (forecast_total_bytes / LUNA_DB_DISK_LIMIT_BYTES) * 100;

  const legacyRow = live.tables.find(
    (t) => t.table_name === "luna_notion_embeddings"
  );
  const platform = await fetchPlatformUsage();

  // 한도까지 — 월 50MB만 보면 낙관적(Work·이미지 계획분 무시).
  // 스냅샷 증분 추정이 생기기 전에는 계획 작업 반영 사용률만 표시.
  const years_to_limit_label = `계획된 작업 반영 시 ${Math.round(forecast_pct)}%`;

  return {
    region_label: "Tokyo",
    plan_label: "Pro",
    supabase_url: supabaseDashboardUrl(),
    used_bytes,
    limit_bytes: LUNA_DB_DISK_LIMIT_BYTES,
    limit_gb: LUNA_DB_DISK_LIMIT_GB,
    used_pct,
    free_bytes,
    warn_level: warnLevelFromPct(used_pct),
    groups,
    tables,
    forecast,
    forecast_total_bytes,
    forecast_pct,
    platform,
    disk_expansions_used: null,
    disk_expansions_max: null,
    overage_usd_per_gb: 0.125,
    years_to_limit_label,
    legacy_embeddings: legacyRow
      ? {
          table_name: legacyRow.table_name,
          bytes: legacyRow.bytes,
          after_delete_bytes: Math.max(0, used_bytes - legacyRow.bytes)
        }
      : null,
    rpc_ms: live.rpc_ms,
    rpc_cached: live.cached,
    has_yesterday
  };
}

/** luna_checks 용 — 사용률 70% 미만이면 ok */
export async function resolveStorageCheck(
  admin: SupabaseClient
): Promise<{
  lastOkAt: string | null;
  light: "green" | "yellow" | "red";
  extraDetail?: string;
}> {
  try {
    const dash = await buildStorageDashboard(admin);
    const pct = Math.round(dash.used_pct);
    const detail = `${formatStorageBytes(dash.used_bytes)} / ${dash.limit_gb} GB · ${pct}%`;
    if (dash.warn_level === "ok") {
      return {
        lastOkAt: new Date().toISOString(),
        light: "green",
        extraDetail: detail
      };
    }
    if (dash.warn_level === "warn") {
      return {
        lastOkAt: null,
        light: "yellow",
        extraDetail: `${detail} · 70% 초과`
      };
    }
    return {
      lastOkAt: null,
      light: "red",
      extraDetail: `${detail} · 85% 초과`
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      lastOkAt: null,
      light: "yellow",
      extraDetail: msg.slice(0, 160)
    };
  }
}
