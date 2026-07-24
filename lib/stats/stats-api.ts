import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { KST_OFFSET_MS } from "@/lib/mail/hub-email";

const SUPER_ADMIN_ROLE = "슈퍼관리자";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 1000;

export type StatsDateRange = {
  start: string;
  end: string;
  startIso: string;
  endIso: string;
  dates: string[];
};

export type SuperAdminContext = {
  user: User;
  admin: SupabaseClient;
};

/** KST 기준 YYYY-MM-DD */
export function toKstDateString(utcMs: number): string {
  const kst = new Date(utcMs + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

/** start/end 파싱. 없으면 최근 30일(KST). end는 해당일 23:59:59.999 KST까지. */
export function parseStatsDateRange(
  startParam: string | null,
  endParam: string | null
): StatsDateRange | { error: string } {
  const today = toKstDateString(Date.now());
  const start = (startParam?.trim() || addDays(today, -29)).slice(0, 10);
  const end = (endParam?.trim() || today).slice(0, 10);

  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return { error: "start/end는 YYYY-MM-DD 형식이어야 합니다." };
  }
  if (start > end) {
    return { error: "start는 end보다 이후일 수 없습니다." };
  }

  return {
    start,
    end,
    startIso: `${start}T00:00:00.000+09:00`,
    endIso: `${end}T23:59:59.999+09:00`,
    dates: enumerateDates(start, end)
  };
}

/** Bearer 인증 + 슈퍼관리자 검증 */
export async function requireSuperAdmin(
  request: NextRequest
): Promise<SuperAdminContext | NextResponse> {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase environment variables missing" },
      { status: 500 }
    );
  }

  const { data: profile, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[stats] profile lookup failed", error);
    return NextResponse.json({ error: "권한 확인에 실패했습니다." }, { status: 500 });
  }

  if (profile?.role !== SUPER_ADMIN_ROLE) {
    return NextResponse.json({ error: "슈퍼관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  return { user, admin };
}

export function isNextResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

type PageResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

/** 1000건 제한을 넘어 페이지네이션으로 전부 조회 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  let from = 0;

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { data: rows, error: error.message };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { data: rows, error: null };
}

type ProfileEmbed = { name: string | null; department: string | null };

/** PostgREST embed가 object | array 로 올 수 있어 정규화 */
export function unwrapProfile(
  profiles: ProfileEmbed | ProfileEmbed[] | null | undefined
): ProfileEmbed | null {
  if (!profiles) return null;
  if (Array.isArray(profiles)) return profiles[0] ?? null;
  return profiles;
}
