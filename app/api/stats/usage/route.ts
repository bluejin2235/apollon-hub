import { NextRequest, NextResponse } from "next/server";
import {
  ALL_STATS_SERVICES,
  fetchAllRows,
  fetchTeamProfiles,
  isNextResponse,
  mergeStatsServices,
  parseStatsDateRange,
  requireSuperAdmin,
  sortMembersByTotalThenName
} from "@/lib/stats/stats-api";

export const runtime = "nodejs";

type PageViewRow = {
  profile_id: string;
  service: string;
};

type TrendMsgRow = {
  profile_id: string;
};

type MemberAgg = {
  profile_id: string;
  name: string;
  department: string;
  pageviews: Record<string, number>;
  trendChat: number;
  total: number;
};

function emptyPageviews(): Record<string, number> {
  const pageviews: Record<string, number> = {};
  for (const service of ALL_STATS_SERVICES) {
    pageviews[service] = 0;
  }
  return pageviews;
}

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

    const [profilesRes, pageViewsRes, trendRes] = await Promise.all([
      fetchTeamProfiles(admin),
      fetchAllRows<PageViewRow>((from, to) =>
        admin
          .from("page_view_logs")
          .select("profile_id, service")
          .gte("created_at", range.startIso)
          .lte("created_at", range.endIso)
          .order("created_at", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<TrendMsgRow>((from, to) =>
        admin
          .from("trend_messages")
          .select("profile_id")
          .neq("message_type", "ai")
          .not("profile_id", "is", null)
          .gte("created_at", range.startIso)
          .lte("created_at", range.endIso)
          .order("created_at", { ascending: true })
          .range(from, to)
      )
    ]);

    if (profilesRes.error) {
      console.error("[stats/usage] profiles fetch failed", profilesRes.error);
      return NextResponse.json({ error: "멤버 목록 조회에 실패했습니다." }, { status: 500 });
    }
    if (pageViewsRes.error) {
      console.error("[stats/usage] page_view_logs fetch failed", pageViewsRes.error);
      return NextResponse.json({ error: "페이지 조회 로그 조회에 실패했습니다." }, { status: 500 });
    }
    if (trendRes.error) {
      console.error("[stats/usage] trend_messages fetch failed", trendRes.error);
      return NextResponse.json({ error: "트렌드 대화 로그 조회에 실패했습니다." }, { status: 500 });
    }

    const serviceSet = new Set<string>();
    const membersMap = new Map<string, MemberAgg>();

    for (const p of profilesRes.data) {
      membersMap.set(p.id, {
        profile_id: p.id,
        name: p.name,
        department: p.department,
        pageviews: emptyPageviews(),
        trendChat: 0,
        total: 0
      });
    }

    for (const row of pageViewsRes.data) {
      if (!row.profile_id || !row.service) continue;
      serviceSet.add(row.service);
      const member = membersMap.get(row.profile_id);
      if (!member) continue;
      member.pageviews[row.service] = (member.pageviews[row.service] ?? 0) + 1;
    }

    for (const row of trendRes.data) {
      if (!row.profile_id) continue;
      const member = membersMap.get(row.profile_id);
      if (!member) continue;
      member.trendChat += 1;
    }

    const services = mergeStatsServices(serviceSet);

    const members = sortMembersByTotalThenName(
      Array.from(membersMap.values()).map((m) => {
        const pageviewTotal = Object.values(m.pageviews).reduce((sum, n) => sum + n, 0);
        return { ...m, total: pageviewTotal + m.trendChat };
      })
    );

    return NextResponse.json({ services, members });
  } catch (e) {
    console.error("[stats/usage] unexpected", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
