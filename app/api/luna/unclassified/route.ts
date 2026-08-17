import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

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
  return { user, admin };
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  const status = request.nextUrl.searchParams.get("status") || "pending";
  const { data, error } = await admin
    .from("luna_unclassified_questions")
    .select("id, question, types, reason, confidence, conversation_id, status, created_at")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ questions: [], table_ready: false });
    }
    console.error("[luna/unclassified] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ questions: data ?? [], table_ready: true });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  let body: {
    id?: string;
    status?: string;
    promoted_slug?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!id || !["pending", "promoted", "dismissed"].includes(status)) {
    return NextResponse.json({ error: "id 와 status 가 필요합니다." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_unclassified_questions")
    .update({
      status,
      promoted_slug:
        typeof body.promoted_slug === "string" ? body.promoted_slug : null
    })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("[luna/unclassified] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, question: data });
}
