import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { kstWeekBounds } from "@/lib/luna/self-report";

export const runtime = "nodejs";

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const termId = request.nextUrl.searchParams.get("id");
  const category = request.nextUrl.searchParams.get("category");
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const index = request.nextUrl.searchParams.get("index");

  const week = kstWeekBounds();

  const countByCategory = async (cat: string) => {
    const { count, error } = await admin
      .from("glossary_terms")
      .select("id", { count: "exact", head: true })
      .eq("category", cat);
    if (error) return null;
    return count ?? 0;
  };

  try {
    const [totalRes, weekRes, pendingRes, common, interior, hw] = await Promise.all([
      admin.from("glossary_terms").select("id", { count: "exact", head: true }),
      admin
        .from("glossary_terms")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", week.startIso)
        .lt("updated_at", week.endIso),
      admin
        .from("glossary_candidates")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      countByCategory("common"),
      countByCategory("interior"),
      countByCategory("hw")
    ]);

    if (totalRes.error) throw totalRes.error;

    const stats = {
      total: totalRes.count ?? 0,
      week_updated: weekRes.count ?? 0,
      pending_candidates: pendingRes.count ?? 0,
      by_category: {
        common: common,
        interior: interior,
        hw: hw
      }
    };

    if (termId) {
      const { data: term, error: termError } = await admin
        .from("glossary_terms")
        .select("*")
        .eq("id", termId)
        .maybeSingle();
      if (termError) throw termError;

      const { data: versions } = await admin
        .from("glossary_versions")
        .select("*")
        .eq("term_id", termId)
        .order("version", { ascending: false })
        .limit(10);

      return NextResponse.json({
        available: true,
        stats,
        term,
        versions: versions ?? []
      });
    }

    let listQuery = admin
      .from("glossary_terms")
      .select("id, term_ko, term_en, term_zh, category")
      .order("term_ko", { ascending: true })
      .limit(80);

    if (category === "common" || category === "interior" || category === "hw") {
      listQuery = listQuery.eq("category", category);
    }

    if (q) {
      const safe = q.replace(/[%_]/g, "");
      listQuery = listQuery.or(
        `term_ko.ilike.%${safe}%,term_en.ilike.%${safe}%,term_zh.ilike.%${safe}%`
      );
    }

    const { data: terms, error: listError } = await listQuery;
    if (listError) throw listError;

    let filtered = terms ?? [];
    if (index && index !== "all") {
      filtered = filtered.filter((t) => {
        const ko = (t.term_ko as string) || "";
        const en = (t.term_en as string) || "";
        if (index === "A" || index === "B" || index === "C" || index === "S") {
          return en.toUpperCase().startsWith(index);
        }
        const ch = ko.charAt(0);
        const map: Record<string, string> = {
          "ㄱ": "가",
          "ㄴ": "나",
          "ㄷ": "다",
          "ㄹ": "라",
          "ㅁ": "마",
          "ㅂ": "바",
          "ㅅ": "사",
          "ㅇ": "아",
          "ㅈ": "자",
          "ㅊ": "차",
          "ㅋ": "카",
          "ㅌ": "타",
          "ㅍ": "파",
          "ㅎ": "하"
        };
        const start = map[index];
        if (!start) return true;
        return ch >= start && ch < String.fromCharCode(start.charCodeAt(0) + 200);
      });
    }

    return NextResponse.json({
      available: true,
      stats,
      terms: filtered
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing =
      message.includes("glossary_terms") ||
      message.includes("does not exist") ||
      message.includes("relation");
    return NextResponse.json({
      available: false,
      stats: null,
      terms: [],
      term: null,
      versions: [],
      message: missing
        ? "glossary_terms 테이블이 아직 없습니다. supabase/migrations/glossary_*.sql 마이그레이션을 적용하세요."
        : message
    });
  }
}
