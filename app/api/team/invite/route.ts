import { NextRequest, NextResponse } from "next/server";

type Role = "슈퍼관리자" | "중간관리자" | "멤버";

function makeTemporaryPassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  let password = "";

  for (let i = 0; i < length; i += 1) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  return password;
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

  const {
    data: { user },
    error: authError
  } = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`
    }
  }).then(async (res) => {
    if (!res.ok) {
      return { data: { user: null }, error: await res.json() };
    }
    return { data: { user: await res.json() }, error: null };
  });

  if (authError || !user?.email) {
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
    return NextResponse.json({ error: "슈퍼관리자만 팀원을 초대할 수 있습니다." }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    email?: string;
    department?: string;
    role?: Role;
  };

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const department = body.department?.trim();
  const role = body.role;

  if (!name || !email || !department || !role) {
    return NextResponse.json({ error: "모든 초대 항목을 입력해주세요." }, { status: 400 });
  }

  if (!["슈퍼관리자", "중간관리자", "멤버"].includes(role)) {
    return NextResponse.json({ error: "권한 값이 올바르지 않습니다." }, { status: 400 });
  }

  const temporaryPassword = makeTemporaryPassword();
  const createAuthRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        name,
        department
      }
    })
  });

  if (!createAuthRes.ok) {
    const authCreateError = await createAuthRes.json();
    return NextResponse.json(
      { error: authCreateError?.msg ?? authCreateError?.message ?? "Auth 계정 생성에 실패했습니다." },
      { status: createAuthRes.status }
    );
  }

  const profilePayload = [
    {
      email,
      name,
      department,
      role,
      status: "근무"
    }
  ];

  const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=email`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(profilePayload)
  });

  if (!profileRes.ok) {
    const profileError = await profileRes.json();
    return NextResponse.json(
      { error: profileError?.message ?? "profiles 생성에 실패했습니다." },
      { status: profileRes.status }
    );
  }

  const [profile] = (await profileRes.json()) as Array<{
    id: string;
    email: string;
    name: string;
    department: string;
    role: Role;
    status: "근무" | "휴직" | "퇴사";
    created_at?: string;
  }>;

  return NextResponse.json({
    temporaryPassword,
    profile
  });
}
