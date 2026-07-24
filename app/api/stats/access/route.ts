import { NextRequest, NextResponse } from "next/server";
import {
  fetchAllRows,
  isNextResponse,
  parseStatsDateRange,
  requireSuperAdmin,
  toKstDateString,
  unwrapProfile
} from "@/lib/stats/stats-api";

export const runtime = "nodejs";

type AccessLogRow = {
  profile_id: string;
  device: string | null;
  created_at: string;
  profiles: { name: string | null; department: string | null } | { name: string | null; department: string | null }[] | null;
};

type MemberAgg = {
  profile_id: string;
  name: string;
  department: string;
  pc: number;
  mobile: number;
  total: number;
};

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if (isNextResponse(auth)) return auth;

    const { searchParams } = request.nextUrl;
    const range = parseStatsDateRange(searchParams.get("start"), searchParams.get("end"));
    if ("error" in range) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }

    const { admin } = auth;
    const { data: logs, error } = await fetchAllRows<AccessLogRow>((from, to) =>
      admin
        .from("access_logs")
        .select("profile_id, device, created_at, profiles(name, department)")
        .gte("created_at", range.startIso)
        .lte("created_at", range.endIso)
        .order("created_at", { ascending: true })
        .range(from, to)
    );

    if (error) {
      console.error("[stats/access] fetch failed", error);
      return NextResponse.json({ error: "접속 로그 조회에 실패했습니다." }, { status: 500 });
    }

    const dailyCounts = new Map<string, number>(range.dates.map((d) => [d, 0]));
    const membersMap = new Map<string, MemberAgg>();

    for (const row of logs) {
      const dateKey = toKstDateString(new Date(row.created_at).getTime());
      if (dailyCounts.has(dateKey)) {
        dailyCounts.set(dateKey, (dailyCounts.get(dateKey) ?? 0) + 1);
      }

      if (!row.profile_id) continue;
      let member = membersMap.get(row.profile_id);
      if (!member) {
        const profile = unwrapProfile(row.profiles);
        member = {
          profile_id: row.profile_id,
          name: profile?.name ?? "",
          department: profile?.department ?? "",
          pc: 0,
          mobile: 0,
          total: 0
        };
        membersMap.set(row.profile_id, member);
      }

      member.total += 1;
      if (row.device === "mobile") member.mobile += 1;
      else if (row.device === "pc") member.pc += 1;
    }

    const daily = range.dates.map((date) => ({
      date,
      count: dailyCounts.get(date) ?? 0
    }));

    const members = Array.from(membersMap.values()).sort((a, b) => b.total - a.total);

    return NextResponse.json({ daily, members });
  } catch (e) {
    console.error("[stats/access] unexpected", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
