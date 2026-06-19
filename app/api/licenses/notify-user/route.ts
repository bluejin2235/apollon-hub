import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { resolveUiContractType } from "@/lib/licenses/calc";
import { buildHubEmailShell, buildInfoTable, EMAIL_HEADER_LICENSE } from "@/lib/mail/hub-email";

const HUB_LICENSES_BASE = "https://hub.apollonworks.com/licenses";

type NotifyUserBody = {
  type: "user_added" | "user_removed";
  service_id: string;
  profile_id: string;
};

type ProfileJoin = { id: string; email: string | null; name: string | null } | ProfileJoin[] | null;

function joinProfile(row: ProfileJoin): { id: string; email: string | null; name: string | null } | null {
  if (!row) return null;
  const p = Array.isArray(row) ? row[0] : row;
  if (!p || !("id" in p) || !p.id) return null;
  return p;
}

function buildUserNotifyHtml(params: {
  type: NotifyUserBody["type"];
  userName: string;
  serviceName: string;
  category: string;
  contractType: string;
  managerNames: string;
  serviceId: string;
}): { subject: string; html: string } {
  const { type, userName, serviceName, category, contractType, managerNames, serviceId } = params;
  const detailUrl = `${HUB_LICENSES_BASE}/${serviceId}`;

  const tableRows = [
    { label: "서비스명", value: serviceName },
    { label: "카테고리", value: category },
    { label: "계약 유형", value: contractType },
    ...(type === "user_added" ? [{ label: "담당자", value: managerNames }] : [])
  ];

  const shellParams = {
    headerBg: EMAIL_HEADER_LICENSE,
    headerLabel: "LICENSE MANAGER",
    bodyHtml: buildInfoTable(tableRows),
    cta: { href: detailUrl, label: "라이선스 상세 보기" }
  };

  if (type === "user_added") {
    return {
      subject: `[아폴론 Hub] 라이선스 사용자 추가 — ${serviceName}`,
      html: buildHubEmailShell({
        ...shellParams,
        title: "라이선스 사용자 추가",
        subtitle: `${userName}님이 ${serviceName} 라이선스 사용자로 추가되었습니다.`
      })
    };
  }

  return {
    subject: `[아폴론 Hub] 라이선스 사용자 제거 — ${serviceName}`,
    html: buildHubEmailShell({
      ...shellParams,
      title: "라이선스 사용자 제거",
      subtitle: `${userName}님이 ${serviceName} 라이선스 사용자에서 제거되었습니다.`
    })
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;

    if (!supabaseUrl || !secretKey) {
      console.error("[licenses/notify-user] Supabase env vars missing");
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    if (!resendApiKey || !fromEmail) {
      console.error("[licenses/notify-user] Resend env vars missing");
      return NextResponse.json({ error: "Resend environment variables missing" }, { status: 500 });
    }

    let body: NotifyUserBody;
    try {
      body = (await request.json()) as NotifyUserBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (
      (body.type !== "user_added" && body.type !== "user_removed") ||
      !body.service_id?.trim() ||
      !body.profile_id?.trim()
    ) {
      return NextResponse.json({ error: "type, service_id, profile_id are required" }, { status: 400 });
    }

    const serviceId = body.service_id.trim();
    const profileId = body.profile_id.trim();

    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const [serviceRes, userRes, assigneesRes, superAdminsRes] = await Promise.all([
      supabase
        .from("services")
        .select("id, name, category, contract_type")
        .eq("id", serviceId)
        .eq("is_hub_card", false)
        .maybeSingle(),
      supabase.from("profiles").select("id, email, name").eq("id", profileId).maybeSingle(),
      supabase
        .from("license_managers")
        .select("profile_id, profile:profiles!profile_id(id, email, name)")
        .eq("service_id", serviceId),
      supabase
        .from("profiles")
        .select("id, email, name")
        .eq("role", "슈퍼관리자")
        .not("email", "is", null)
    ]);

    if (serviceRes.error) {
      console.error("[licenses/notify-user] services fetch failed", serviceRes.error);
      return NextResponse.json({ error: serviceRes.error.message }, { status: 500 });
    }
    if (userRes.error) {
      console.error("[licenses/notify-user] user profile fetch failed", userRes.error);
      return NextResponse.json({ error: userRes.error.message }, { status: 500 });
    }
    if (assigneesRes.error) {
      console.error("[licenses/notify-user] license_managers fetch failed", assigneesRes.error);
      return NextResponse.json({ error: assigneesRes.error.message }, { status: 500 });
    }
    if (superAdminsRes.error) {
      console.error("[licenses/notify-user] super admins fetch failed", superAdminsRes.error);
      return NextResponse.json({ error: superAdminsRes.error.message }, { status: 500 });
    }

    if (!serviceRes.data) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    const serviceName = String(serviceRes.data.name ?? "").trim() || "—";
    const category = String(serviceRes.data.category ?? "").trim() || "—";
    const contractType = resolveUiContractType({
      contract_type: serviceRes.data.contract_type
    } as Parameters<typeof resolveUiContractType>[0]);
    const userName = userRes.data?.name?.trim() || "—";

    const managerNames: string[] = [];
    const recipientMap = new Map<string, string>();

    const userEmail = userRes.data?.email?.trim().toLowerCase();
    if (userEmail) recipientMap.set(userEmail, userEmail);

    for (const row of assigneesRes.data ?? []) {
      const profile = joinProfile(row.profile as ProfileJoin);
      if (!profile) continue;
      const name = profile.name?.trim();
      if (name) managerNames.push(name);
      const email = profile.email?.trim().toLowerCase();
      if (email) recipientMap.set(email, email);
    }

    for (const admin of superAdminsRes.data ?? []) {
      const email = admin.email?.trim().toLowerCase();
      if (email) recipientMap.set(email, email);
    }

    const recipients = [...recipientMap.values()];

    if (recipients.length === 0) {
      console.log("[licenses/notify-user] skipped — no recipient emails", { serviceId, profileId });
      return NextResponse.json({ success: true, skipped: true, reason: "no recipients" });
    }

    const { subject, html } = buildUserNotifyHtml({
      type: body.type,
      userName,
      serviceName,
      category,
      contractType,
      managerNames: managerNames.length > 0 ? managerNames.join(", ") : "—",
      serviceId
    });

    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject,
      html
    });

    if (error) {
      console.error("[licenses/notify-user] Resend failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[licenses/notify-user] sent", {
      messageId: data?.id,
      type: body.type,
      serviceId,
      profileId,
      recipients: recipients.length
    });

    return NextResponse.json({ success: true, messageId: data?.id, recipients: recipients.length });
  } catch (e) {
    console.error("[licenses/notify-user] unexpected error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
