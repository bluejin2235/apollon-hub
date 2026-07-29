import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { buildChangeRow, buildHubEmailShell, buildInfoTable, EMAIL_HEADER_LICENSE } from "@/lib/mail/hub-email";

const HUB_LICENSES_BASE = "https://hub.apollonworks.com/licenses";

type LicenseChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

type NotifyBody = {
  type: "created" | "updated";
  service: {
    id: string;
    name: string;
    plan: string | null;
    category: string | null;
    contract_type: string;
    cost: number;
    cost_monthly: number;
    currency: string;
    license_count: number;
    start_date: string | null;
  };
  changes?: LicenseChange[];
  actor_id: string;
};

type ProfileJoin = { id: string; email: string | null; name: string | null } | ProfileJoin[] | null;

function joinProfile(row: ProfileJoin): { id: string; email: string | null; name: string | null } | null {
  if (!row) return null;
  const p = Array.isArray(row) ? row[0] : row;
  if (!p || !("id" in p) || !p.id) return null;
  return p;
}

function formatCost(amount: number, currency: string): string {
  const cur = currency?.trim() || "KRW";
  if (cur === "USD") {
    return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  if (cur === "EUR") {
    return `€${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return `₩${amount.toLocaleString("ko-KR")}`;
}

function formatDateLabel(iso: string | null): string {
  if (!iso?.trim()) return "—";
  const d = iso.slice(0, 10);
  return d.length === 10 ? d : iso;
}

function buildCreatedHtml(service: NotifyBody["service"], assigneeNames: string[], actorName: string): string {
  const table = buildInfoTable([
    { label: "서비스명", value: service.name },
    { label: "카테고리", value: service.category?.trim() || "—" },
    { label: "계약 유형", value: service.contract_type || "—" },
    {
      label: "비용",
      value: formatCost(Number(service.cost ?? service.cost_monthly ?? 0), service.currency)
    },
    { label: "시작일", value: formatDateLabel(service.start_date) },
    { label: "담당자", value: assigneeNames.length > 0 ? assigneeNames.join(", ") : "—" },
    { label: "등록자", value: actorName }
  ]);

  return buildHubEmailShell({
    headerBg: EMAIL_HEADER_LICENSE,
    headerLabel: "LICENSE MANAGER",
    title: "신규 라이선스 등록",
    subtitle: service.name,
    bodyHtml: table,
    cta: { href: `${HUB_LICENSES_BASE}/${service.id}`, label: "라이선스 상세 보기" }
  });
}

function buildUpdatedHtml(
  service: NotifyBody["service"],
  changes: LicenseChange[],
  actorName: string
): string {
  const changeRows = changes.map((c) => buildChangeRow(c.label, c.before, c.after)).join("\n");
  const bodyHtml = `${buildInfoTable([{ label: "서비스명", value: service.name }])}
    <div style="margin-top: 16px;">
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #776274; letter-spacing: 0.03em;">변경 내역</p>
      ${changeRows}
    </div>
    ${buildInfoTable([{ label: "수정자", value: actorName }])}`;

  return buildHubEmailShell({
    headerBg: EMAIL_HEADER_LICENSE,
    headerLabel: "LICENSE MANAGER",
    title: "라이선스 정보 수정",
    subtitle: service.name,
    bodyHtml,
    cta: { href: `${HUB_LICENSES_BASE}/${service.id}`, label: "라이선스 상세 보기" }
  });
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;

    if (!supabaseUrl || !secretKey) {
      console.error("[licenses/notify] Supabase env vars missing");
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    if (!resendApiKey || !fromEmail) {
      console.error("[licenses/notify] Resend env vars missing");
      return NextResponse.json({ error: "Resend environment variables missing" }, { status: 500 });
    }

    let body: NotifyBody;
    try {
      body = (await request.json()) as NotifyBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.type || !body.service?.id || !body.service?.name?.trim() || !body.actor_id?.trim()) {
      return NextResponse.json({ error: "type, service.id, service.name, actor_id are required" }, { status: 400 });
    }

    if (body.type === "updated" && (!body.changes || body.changes.length === 0)) {
      return NextResponse.json({ success: true, skipped: true, reason: "no changes" });
    }

    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const serviceId = body.service.id;

    // 담당자 조회: license_managers (구 service_assignees).
    // service_assignees 마이그레이션 데이터는 이미 license_managers에 있을 수 있음.
    // Supabase SQL Editor에서 이관·중복 여부 확인 필요:
    //   SELECT service_id, profile_id FROM license_managers WHERE service_id = '<service_id>';
    //   -- service_assignees → license_managers INSERT … ON CONFLICT … 등 이관 SQL을 실행했다면
    //   -- license_managers에 동일 (service_id, profile_id) 행이 있는지 확인할 것.
    const [assigneesRes, superAdminsRes, actorRes] = await Promise.all([
      supabase
        .from("license_managers")
        .select("profile_id, profile:profiles!profile_id(id, email, name)")
        .eq("service_id", serviceId),
      supabase
        .from("profiles")
        .select("id, email, name")
        .eq("role", "슈퍼관리자")
        .not("email", "is", null),
      supabase.from("profiles").select("id, email, name").eq("id", body.actor_id).maybeSingle()
    ]);

    if (assigneesRes.error) {
      console.error("[licenses/notify] license_managers fetch failed", assigneesRes.error);
      return NextResponse.json({ error: assigneesRes.error.message }, { status: 500 });
    }
    if (superAdminsRes.error) {
      console.error("[licenses/notify] super admins fetch failed", superAdminsRes.error);
      return NextResponse.json({ error: superAdminsRes.error.message }, { status: 500 });
    }
    if (actorRes.error) {
      console.error("[licenses/notify] actor fetch failed", actorRes.error);
      return NextResponse.json({ error: actorRes.error.message }, { status: 500 });
    }

    const assigneeNames: string[] = [];
    const recipientMap = new Map<string, string>();

    for (const row of assigneesRes.data ?? []) {
      const profile = joinProfile(row.profile as ProfileJoin);
      if (!profile) continue;
      const name = profile.name?.trim() || "—";
      assigneeNames.push(name);
      const email = profile.email?.trim().toLowerCase();
      if (email) recipientMap.set(email, email);
    }

    for (const admin of superAdminsRes.data ?? []) {
      const email = admin.email?.trim().toLowerCase();
      if (email) recipientMap.set(email, email);
    }

    const recipients = [...recipientMap.values()];

    if (recipients.length === 0) {
      console.log("[licenses/notify] skipped — no recipient emails", { serviceId });
      return NextResponse.json({ success: true, skipped: true, reason: "no recipients" });
    }

    const actorName = actorRes.data?.name?.trim() || "—";
    const serviceName = body.service.name.trim();

    const subject =
      body.type === "created"
        ? `[아폴론 Hub] 신규 라이선스 등록 — ${serviceName}`
        : `[아폴론 Hub] 라이선스 수정 알림 — ${serviceName}`;

    const html =
      body.type === "created"
        ? buildCreatedHtml(body.service, assigneeNames, actorName)
        : buildUpdatedHtml(body.service, body.changes ?? [], actorName);

    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject,
      html
    });

    if (error) {
      console.error("[licenses/notify] Resend failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[licenses/notify] sent", {
      messageId: data?.id,
      type: body.type,
      serviceId,
      recipients: recipients.length
    });

    return NextResponse.json({ success: true, messageId: data?.id, recipients: recipients.length });
  } catch (e) {
    console.error("[licenses/notify] unexpected error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
