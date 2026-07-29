import { NextRequest, NextResponse } from "next/server";
import {
  fetchAllRows,
  fetchTeamProfiles,
  isNextResponse,
  parseStatsDateRange,
  requireSuperAdmin,
  sortMembersByTotalThenName,
  toKstDateString
} from "@/lib/stats/stats-api";

export const runtime = "nodejs";

type AccessLogRow = {
  profile_id: string;
  device: string | null;
  created_at: string;
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

    const [profilesRes, logsRes] = await Promise.all([
      fetchTeamProfiles(admin),
      fetchAllRows<AccessLogRow>((from, to) =>
        admin
          .from("access_logs")
          .select("profile_id, device, created_at")
          .gte("created_at", range.startIso)
          .lte("created_at", range.endIso)
          .order("created_at", { ascending: true })
          .range(from, to)
      )
    ]);

    if (profilesRes.error) {
      console.error("[stats/access] profiles fetch failed", profilesRes.error);
      return NextResponse.json({ error: "멤버 목록 조회에 실패했습니다." }, { status: 500 });
    }
    if (logsRes.error) {
      console.error("[stats/access] fetch failed", logsRes.error);
      return NextResponse.json({ error: "접속 로그 조회에 실패했습니다." }, { status: 500 });
    }

    const dailyCounts = new Map<string, number>(range.dates.map((d) => [d, 0]));
    const membersMap = new Map<string, MemberAgg>();

    for (const p of profilesRes.data) {
      membersMap.set(p.id, {
        profile_id: p.id,
        name: p.name,
        department: p.department,
        pc: 0,
        mobile: 0,
        total: 0
      });
    }

    for (const row of logsRes.data) {
      const dateKey = toKstDateString(new Date(row.created_at).getTime());
      if (dailyCounts.has(dateKey)) {
        dailyCounts.set(dateKey, (dailyCounts.get(dateKey) ?? 0) + 1);
      }

      if (!row.profile_id) continue;
      const member = membersMap.get(row.profile_id);
      if (!member) continue; // 공용 계정 등 제외 대상

      member.total += 1;
      if (row.device === "mobile") member.mobile += 1;
      else if (row.device === "pc") member.pc += 1;
    }

    const daily = range.dates.map((date) => ({
      date,
      count: dailyCounts.get(date) ?? 0
    }));

    const members = sortMembersByTotalThenName(Array.from(membersMap.values()));

    return NextResponse.json({ daily, members });
  } catch (e) {
    console.error("[stats/access] unexpected", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
