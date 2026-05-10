import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

type Role = "슈퍼관리자" | "중간관리자" | "멤버";

/** `profiles.id`와 `auth.users.id`가 다를 수 있어, 우선 프로필 이메일로 Auth 사용자를 찾습니다. */
async function resolveAuthUserId(
  admin: SupabaseClient,
  profileId: string,
  profileEmail: string
): Promise<{ authUserId: string } | { error: string }> {
  const { data: byId, error: byIdErr } = await admin.auth.admin.getUserById(profileId);
  if (!byIdErr && byId.user?.id) {
    return { authUserId: byId.user.id };
  }

  const target = profileEmail.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 100; i += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return { error: error.message };
    }
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit?.id) {
      return { authUserId: hit.id };
    }
    if (data.users.length < perPage) {
      break;
    }
    page += 1;
  }

  return { error: "이 이메일과 연결된 Auth 계정을 찾지 못했습니다." };
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !publishableKey || !secretKey) {
    return NextResponse.json(
      { error: "Supabase 환경 변수가 누락되었습니다." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "");

  if (!accessToken) {
    return NextResponse.json({ error: "인증 토큰이 필요합니다." }, { status: 401 });
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!userRes.ok) {
    return NextResponse.json({ error: "요청자 인증에 실패했습니다." }, { status: 401 });
  }

  const user = (await userRes.json()) as { email?: string };

  if (!user?.email) {
    return NextResponse.json({ error: "요청자 인증에 실패했습니다." }, { status: 401 });
  }

  const adminProfileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=id,email,role&email=eq.${encodeURIComponent(user.email)}`,
    {
      method: "GET",
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`
      }
    }
  );

  const adminProfiles = (await adminProfileRes.json()) as Array<{ role?: Role }>;
  const isSuperAdmin = adminProfileRes.ok && adminProfiles?.[0]?.role === "슈퍼관리자";

  if (!isSuperAdmin) {
    return NextResponse.json(
      { error: "슈퍼관리자만 비밀번호를 재설정할 수 있습니다." },
      { status: 403 }
    );
  }

  const body = (await request.json()) as {
    /** `public.profiles` 행의 `id` (Auth `user_id`와 같을 수도, 다를 수도 있음) */
    userId?: string;
    newPassword?: string;
  };

  const profileId = body.userId?.trim();
  const newPassword = body.newPassword?.trim();

  if (!profileId || !newPassword) {
    return NextResponse.json({ error: "userId(프로필 id)와 newPassword가 필요합니다." }, { status: 400 });
  }

  if (newPassword.length < 6) {
    return NextResponse.json(
      { error: "비밀번호는 최소 6자 이상이어야 합니다." },
      { status: 400 }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .eq("id", profileId)
    .maybeSingle();

  if (profileError || !profile?.email) {
    return NextResponse.json({ error: "해당 팀원을 찾을 수 없습니다." }, { status: 404 });
  }

  const resolved = await resolveAuthUserId(supabaseAdmin, profile.id, profile.email);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 404 });
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(resolved.authUserId, {
    password: newPassword
  });

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message ?? "비밀번호 재설정에 실패했습니다." },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}
