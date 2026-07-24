import { NextRequest, NextResponse } from "next/server";
import {
  fetchAllRows,
  isNextResponse,
  parseStatsDateRange,
  requireSuperAdmin,
  unwrapProfile
} from "@/lib/stats/stats-api";

export const runtime = "nodejs";

type PageViewRow = {
  profile_id: string;
  service: string;
  profiles: { name: string | null; department: string | null } | { name: string | null; department: string | null }[] | null;
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

    const [pageViewsRes, trendRes] = await Promise.all([
      fetchAllRows<PageViewRow>((from, to) =>
        admin
          .from("page_view_logs")
          .select("profile_id, service, profiles(name, department)")
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

    function ensureMember(
      profileId: string,
      profiles:
        | { name: string | null; department: string | null }
        | { name: string | null; department: string | null }[]
        | null
        | undefined
    ): MemberAgg {
      const profile = unwrapProfile(profiles);
      let member = membersMap.get(profileId);
      if (!member) {
        member = {
          profile_id: profileId,
          name: profile?.name ?? "",
          department: profile?.department ?? "",
          pageviews: {},
          trendChat: 0,
          total: 0
        };
        membersMap.set(profileId, member);
      } else if (profile) {
        if (!member.name && profile.name) member.name = profile.name;
        if (!member.department && profile.department) member.department = profile.department;
      }
      return member;
    }

    for (const row of pageViewsRes.data) {
      if (!row.profile_id || !row.service) continue;
      serviceSet.add(row.service);
      const member = ensureMember(row.profile_id, row.profiles);
      member.pageviews[row.service] = (member.pageviews[row.service] ?? 0) + 1;
    }

    // trendChat만 있는 멤버도 포함 — 이름/부서는 profiles 일괄 조회
    const missingProfileIds = new Set<string>();
    for (const row of trendRes.data) {
      if (!row.profile_id) continue;
      if (!membersMap.has(row.profile_id)) missingProfileIds.add(row.profile_id);
      const member = ensureMember(row.profile_id, null);
      member.trendChat += 1;
    }

    if (missingProfileIds.size > 0) {
      const ids = Array.from(missingProfileIds);
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, name, department")
        .in("id", ids);

      if (profilesError) {
        console.error("[stats/usage] profiles fetch failed", profilesError);
      } else {
        for (const p of profiles ?? []) {
          const member = membersMap.get(p.id);
          if (!member) continue;
          member.name = p.name ?? "";
          member.department = p.department ?? "";
        }
      }
    }

    const services = Array.from(serviceSet).sort();

    const members = Array.from(membersMap.values())
      .map((m) => {
        const pageviewTotal = Object.values(m.pageviews).reduce((sum, n) => sum + n, 0);
        return { ...m, total: pageviewTotal + m.trendChat };
      })
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({ services, members });
  } catch (e) {
    console.error("[stats/usage] unexpected", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
