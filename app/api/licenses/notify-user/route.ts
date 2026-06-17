import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { resolveUiContractType } from "@/lib/licenses/calc";

const HUB_LICENSES_BASE = "https://hub.apollonworks.com/licenses";

type NotifyUserBody = {
  type: "user_added" | "user_removed";
  service_id: string;
  profile_id: string;
};

type ProfileJoin = { id: string; email: string | null; name: string | null } | ProfileJoin[] | null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildItemCard(mainText: string, subText: string): string {
  return `<div style="background: rgba(230,204,190,0.15); border: 0.5px solid #E6CCBE; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 14px; color: #5A5353; font-weight: 500;">${escapeHtml(mainText)}</span>
      <span style="font-size: 11px; color: #776274;">${escapeHtml(subText)}</span>
    </div>`;
}

function joinProfile(row: ProfileJoin): { id: string; email: string | null; name: string | null } | null {
  if (!row) return null;
  const p = Array.isArray(row) ? row[0] : row;
  if (!p || !("id" in p) || !p.id) return null;
  return p;
}

function buildEmailShell(params: {
  title: string;
  subtitle: string;
  cardsHtml: string;
  detailUrl: string;
}): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e0d8d4;">
  <div style="background: #5A5353; padding: 28px 32px;">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
      <div style="width: 28px; height: 28px; background: #A07178; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #E6CCBE;">A</div>
      <span style="color: #E6CCBE; font-size: 12px; font-weight: 500; letter-spacing: 0.05em;">APOLLON HUB</span>
    </div>
    <h1 style="color: #ffffff; font-size: 20px; font-weight: 500; margin: 0 0 4px;">${escapeHtml(params.title)}</h1>
    <p style="color: #C8CC92; font-size: 13px; margin: 0;">${escapeHtml(params.subtitle)}</p>
  </div>
  <div style="padding: 24px 32px; background: #ffffff;">
    ${params.cardsHtml}
    <div style="text-align: center; margin-top: 24px;">
      <a href="${params.detailUrl}" style="display: inline-block; background: #5A5353; color: #E6CCBE; font-size: 14px; font-weight: 500; padding: 12px 32px; border-radius: 8px; text-decoration: none; letter-spacing: 0.02em;">라이선스 상세 보기</a>
    </div>
  </div>
  <div style="padding: 16px 32px; background: rgba(160,113,120,0.1); border-top: 0.5px solid #E6CCBE; text-align: center;">
    <p style="font-size: 12px; color: #776274; margin: 0;">아폴론이머시브웍스 · hub@apollonworks.com</p>
  </div>
</div>`;
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

  const cards = [
    buildItemCard("서비스명", serviceName),
    buildItemCard("카테고리", category),
    buildItemCard("계약 유형", contractType),
    ...(type === "user_added" ? [buildItemCard("담당자", managerNames)] : [])
  ].join("\n");

  if (type === "user_added") {
    return {
      subject: `[아폴론 Hub] 라이선스 사용자 추가 — ${serviceName}`,
      html: buildEmailShell({
        title: "➕ 라이선스 사용자 추가",
        subtitle: `${userName}님이 ${serviceName} 라이선스 사용자로 추가되었습니다.`,
        cardsHtml: cards,
        detailUrl
      })
    };
  }

  return {
    subject: `[아폴론 Hub] 라이선스 사용자 제거 — ${serviceName}`,
    html: buildEmailShell({
      title: "➖ 라이선스 사용자 제거",
      subtitle: `${userName}님이 ${serviceName} 라이선스 사용자에서 제거되었습니다.`,
      cardsHtml: cards,
      detailUrl
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
