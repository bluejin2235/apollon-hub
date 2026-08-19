import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { invalidateLunaAccessCache, LUNA_SUPER_ADMIN_ROLE } from "@/lib/luna/beta-access";

export const runtime = "nodejs";

type ProfileLite = { id: string; name: string | null };

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
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  const [{ data: superRows, error: superError }, { data: betaRows, error: betaError }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id, name")
        .eq("role", LUNA_SUPER_ADMIN_ROLE)
        .order("name"),
      admin.from("luna_beta_access").select("profile_id, note, created_at").order("created_at")
    ]);

  if (superError) {
    console.error("[luna/beta-access] super", superError);
    return NextResponse.json({ error: superError.message }, { status: 500 });
  }
  if (betaError) {
    console.error("[luna/beta-access] list", betaError);
    return NextResponse.json({ error: betaError.message }, { status: 500 });
  }

  const betaIds = (betaRows ?? []).map((r) => r.profile_id as string);
  const nameIds = [...new Set([...betaIds, ...((superRows ?? []) as ProfileLite[]).map((p) => p.id)])];

  const { data: named } = nameIds.length
    ? await admin.from("profiles").select("id, name, role, status").in("id", nameIds)
    : { data: [] as Array<{ id: string; name: string | null; role: string; status: string }> };

  const nameMap = new Map(
    (named ?? []).map((p) => [p.id, p] as const)
  );

  const { data: allMembers, error: membersError } = await admin
    .from("profiles")
    .select("id, name, role, status")
    .neq("role", LUNA_SUPER_ADMIN_ROLE)
    .order("name");

  if (membersError) {
    console.error("[luna/beta-access] members", membersError);
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  const taken = new Set(betaIds);
  const addable = (allMembers ?? []).filter((p) => !taken.has(p.id));

  return NextResponse.json({
    superadmins: ((superRows ?? []) as ProfileLite[]).map((p) => ({
      id: p.id,
      name: (p.name ?? "").trim() || "슈퍼관리자"
    })),
    members: betaIds.map((id) => {
      const p = nameMap.get(id);
      const row = (betaRows ?? []).find((r) => r.profile_id === id);
      return {
        id,
        name: (p?.name ?? "").trim() || id.slice(0, 8),
        note: (row?.note as string | null) ?? null
      };
    }),
    addable: addable.map((p) => ({
      id: p.id,
      name: (p.name ?? "").trim() || p.id.slice(0, 8)
    }))
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  let body: { profile_id?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const profileId = typeof body.profile_id === "string" ? body.profile_id.trim() : "";
  if (!profileId) {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, name, role")
    .eq("id", profileId)
    .maybeSingle();

  if (profileError || !profile) {
    return NextResponse.json({ error: "프로필이 없습니다." }, { status: 404 });
  }
  if (String(profile.role).trim() === LUNA_SUPER_ADMIN_ROLE) {
    return NextResponse.json({ error: "슈퍼관리자는 목록에 넣지 않습니다." }, { status: 400 });
  }

  const note =
    (typeof body.note === "string" && body.note.trim()) ||
    (typeof profile.name === "string" && profile.name.trim()) ||
    null;

  const { error } = await admin.from("luna_beta_access").insert({
    profile_id: profileId,
    note
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 목록에 있습니다." }, { status: 409 });
    }
    console.error("[luna/beta-access] insert", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateLunaAccessCache(profileId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate) return gate.error;
  const { admin } = gate;

  let body: { profile_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const profileId = typeof body.profile_id === "string" ? body.profile_id.trim() : "";
  if (!profileId) {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }

  const { error } = await admin.from("luna_beta_access").delete().eq("profile_id", profileId);
  if (error) {
    console.error("[luna/beta-access] delete", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateLunaAccessCache(profileId);
  return NextResponse.json({ ok: true });
}
