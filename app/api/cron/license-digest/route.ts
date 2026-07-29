import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  buildHubEmailShell,
  EMAIL_HEADER_LICENSE,
  escapeHtml,
  EXCLUDED_TEAM_EMAIL,
  toKstDateString
} from "@/lib/mail/hub-email";
import {
  computeLicenseCostBreakdown,
  formatCurrency,
  resolveUiContractType
} from "@/lib/licenses/calc";
import type { License } from "@/lib/licenses/types";

const HUB_MEMBERS_BASE = "https://hub.apollonworks.com/licenses/members";

/** 고정 환율 — 추후 실시간 환율 API로 교체 가능 */
const LICENSE_DIGEST_FX_RATES = {
  USD: 1525,
  EUR: 1690
} as const;

type SnapshotService = {
  id: string;
  name: string;
  plan: string | null;
  contract_type: string;
  monthly_krw: number;
};

type MailSnapshot = {
  services: SnapshotService[];
  total_monthly_krw: number;
};

type SnapshotChange =
  | { kind: "added"; service: SnapshotService }
  | { kind: "removed"; service: SnapshotService }
  | { kind: "cost_changed"; service: SnapshotService; before: number; after: number };

type ProfileRow = {
  id: string;
  email: string;
  name: string;
};

function isSubscriptionLicense(service: License): boolean {
  if (service.status !== "활성") return false;
  const ct = resolveUiContractType(service);
  return ct === "월 구독" || ct === "년 구독";
}

function serviceMonthlyKrw(service: License): number {
  const breakdown = computeLicenseCostBreakdown(service, LICENSE_DIGEST_FX_RATES);
  const monthlyTotalKrw = Math.round(breakdown.monthlyTotalKrw ?? 0);
  const licenseCount = service.license_count ?? 0;
  if (licenseCount > 0) {
    return Math.round(monthlyTotalKrw / licenseCount);
  }
  return monthlyTotalKrw;
}

function buildMemberSnapshot(serviceIds: string[], serviceMap: Map<string, License>): MailSnapshot {
  const services: SnapshotService[] = [];

  for (const id of serviceIds) {
    const service = serviceMap.get(id);
    if (!service || !isSubscriptionLicense(service)) continue;

    const contractType = resolveUiContractType(service);
    services.push({
      id: service.id,
      name: service.name,
      plan: service.plan?.trim() || null,
      contract_type: contractType,
      monthly_krw: serviceMonthlyKrw(service)
    });
  }

  services.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const total_monthly_krw = services.reduce((sum, row) => sum + row.monthly_krw, 0);

  return { services, total_monthly_krw };
}

function diffSnapshots(previous: MailSnapshot | null, current: MailSnapshot): SnapshotChange[] {
  if (!previous) return [];

  const prevMap = new Map(previous.services.map((s) => [s.id, s]));
  const currMap = new Map(current.services.map((s) => [s.id, s]));
  const changes: SnapshotChange[] = [];

  for (const service of current.services) {
    const old = prevMap.get(service.id);
    if (!old) {
      changes.push({ kind: "added", service });
    } else if (old.monthly_krw !== service.monthly_krw) {
      changes.push({
        kind: "cost_changed",
        service,
        before: old.monthly_krw,
        after: service.monthly_krw
      });
    }
  }

  for (const service of previous.services) {
    if (!currMap.has(service.id)) {
      changes.push({ kind: "removed", service });
    }
  }

  return changes;
}

function contractTagHtml(contractType: string): string {
  const isYearly = contractType === "년 구독";
  const bg = isYearly ? "#dbeafe" : "#ede9fe";
  const color = isYearly ? "#1d4ed8" : "#6d28d9";
  const label = isYearly ? "년 구독" : "월 구독";
  return `<span style="display:inline-block;background:${bg};color:${color};padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:500;">${label}</span>`;
}

function buildLicenseDigestHtml(params: {
  dateLabel: string;
  memberName: string;
  profileId: string;
  snapshot: MailSnapshot;
  previous: MailSnapshot | null;
  changes: SnapshotChange[];
}): string {
  const { dateLabel, memberName, profileId, snapshot, previous, changes } = params;

  const diff = previous != null ? snapshot.total_monthly_krw - previous.total_monthly_krw : null;

  let diffValueHtml: string;
  if (previous == null) {
    diffValueHtml = `<p style="margin: 8px 0 0; font-size: 13px; color: #776274;">첫 발송 기준</p>`;
  } else if (diff === 0) {
    diffValueHtml = `<p style="margin: 8px 0 0; font-size: 20px; font-weight: 700; color: #5A5353;">변동 없음</p>`;
  } else if (diff! > 0) {
    diffValueHtml = `<p style="margin: 8px 0 0; font-size: 20px; font-weight: 700; color: #dc2626;">▲ ${formatCurrency(diff!)}</p>`;
  } else {
    diffValueHtml = `<p style="margin: 8px 0 0; font-size: 20px; font-weight: 700; color: #16a34a;">▼ ${formatCurrency(Math.abs(diff!))}</p>`;
  }

  const metricsHtml = `<table style="width: 100%; border-collapse: separate; border-spacing: 10px 0; margin-bottom: 20px;">
    <tr>
      <td style="width: 50%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; vertical-align: top;">
        <p style="margin: 0; font-size: 12px; color: #776274;">이번 달 총 비용</p>
        <p style="margin: 8px 0 0; font-size: 22px; font-weight: 700; color: ${EMAIL_HEADER_LICENSE};">${formatCurrency(snapshot.total_monthly_krw)}</p>
      </td>
      <td style="width: 50%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; vertical-align: top;">
        <p style="margin: 0; font-size: 12px; color: #776274;">직전 대비</p>
        ${diffValueHtml}
      </td>
    </tr>
  </table>`;

  const changeMap = new Map<string, SnapshotChange>();
  for (const change of changes) {
    changeMap.set(change.service.id, change);
  }

  const removedChanges = changes.filter((c) => c.kind === "removed");
  const removedHtml =
    removedChanges.length > 0
      ? `<div style="margin-bottom: 16px; padding: 12px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
      <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #991b1b;">제거된 라이선스</p>
      ${removedChanges
        .map(
          (c) =>
            `<p style="margin: 0 0 4px; font-size: 13px; color: #5A5353;">➖ ${escapeHtml(c.service.name)}</p>`
        )
        .join("\n")}
    </div>`
      : "";

  const noChangesHtml =
    changes.length === 0
      ? `<p style="text-align: center; color: #776274; font-size: 13px; padding: 8px 0 16px; margin: 0;">이번 기간 변경된 라이선스가 없습니다.</p>`
      : "";

  const tableRows =
    snapshot.services.length > 0
      ? snapshot.services
          .map((service) => {
            const change = changeMap.get(service.id);
            let rowStyle = "";
            let changeCell = `<span style="color: #9ca3af; font-size: 13px;">—</span>`;

            if (change?.kind === "added") {
              rowStyle = "background: #ecfdf5;";
              changeCell = `<span style="display: inline-block; background: #16a34a; color: #ffffff; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; margin-right: 6px;">신규</span><span style="color: #16a34a; font-weight: 600; font-size: 13px;">+${formatCurrency(service.monthly_krw)}</span>`;
            } else if (change?.kind === "cost_changed") {
              rowStyle = "background: #fef2f2;";
              changeCell = `<span style="display: inline-block; background: #dc2626; color: #ffffff; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; margin-right: 6px;">변경</span><span style="color: #9ca3af; text-decoration: line-through; font-size: 13px;">${formatCurrency(change.before)}</span> <span style="color: #dc2626; font-weight: 600; font-size: 13px;">${formatCurrency(change.after)}</span>`;
            }

            return `<tr style="${rowStyle}">
        <td style="padding: 10px 8px; border-bottom: 1px solid #f1ebe8; color: #5A5353; font-weight: 500; font-size: 13px;">${escapeHtml(service.name)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #f1ebe8;">${contractTagHtml(service.contract_type)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #f1ebe8; text-align: right; color: #5A5353; font-weight: 500; font-size: 13px;">${formatCurrency(service.monthly_krw)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #f1ebe8; text-align: right;">${changeCell}</td>
      </tr>`;
          })
          .join("\n")
      : `<tr>
        <td colspan="4" style="padding: 16px 8px; text-align: center; color: #776274; font-size: 13px;">이용 중인 구독 라이선스가 없습니다.</td>
      </tr>`;

  const tableHtml = `<table style="width: 100%; border-collapse: collapse; font-size: 13px;">
    <thead>
      <tr style="border-bottom: 1px solid #E6CCBE;">
        <th style="padding: 8px; text-align: left; font-size: 11px; color: #776274; font-weight: 600;">서비스명</th>
        <th style="padding: 8px; text-align: left; font-size: 11px; color: #776274; font-weight: 600;">계약유형</th>
        <th style="padding: 8px; text-align: right; font-size: 11px; color: #776274; font-weight: 600;">월비용</th>
        <th style="padding: 8px; text-align: right; font-size: 11px; color: #776274; font-weight: 600;">변경</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
    <tfoot>
      <tr style="border-top: 1px solid #E6CCBE;">
        <td colspan="2" style="padding: 12px 8px; font-weight: 600; color: #5A5353;">합계</td>
        <td style="padding: 12px 8px; text-align: right; font-weight: 700; color: #5A5353;">${formatCurrency(snapshot.total_monthly_krw)}</td>
        <td style="padding: 12px 8px;"></td>
      </tr>
    </tfoot>
  </table>`;

  const actionBox = `<div style="background: rgba(12,71,124,0.06); border: 1px solid rgba(12,71,124,0.15); border-radius: 8px; padding: 16px; margin-top: 20px;">
    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #5A5353;">
      잘못된 라이선스가 있다면 지금 바로 수정해 주세요.<br>
      방치하면 다음 현황 메일에도 동일하게 반영됩니다.
    </p>
  </div>`;

  const memberUrl = `${HUB_MEMBERS_BASE}/${profileId}`;

  const bodyHtml = `${metricsHtml}${noChangesHtml}${removedHtml}
    <div style="margin-bottom: 12px;">
      <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #5A5353;">라이선스 목록</p>
      ${tableHtml}
    </div>
    ${actionBox}`;

  return buildHubEmailShell({
    headerBg: EMAIL_HEADER_LICENSE,
    headerLabel: "LICENSE MANAGER · 2주 결산",
    title: `라이선스 현황 — ${dateLabel}`,
    subtitle: `${memberName}님의 이용 중인 라이선스 현황입니다.`,
    bodyHtml,
    cta: { href: memberUrl, label: "내 라이선스 확인·수정하기" }
  });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[license-digest] CRON_SECRET is not configured");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!supabaseUrl || !secretKey) {
    console.error("[license-digest] Supabase env vars missing");
    return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
  }

  if (!resendApiKey || !fromEmail) {
    console.error("[license-digest] Resend env vars missing");
    return NextResponse.json({ error: "Resend environment variables missing" }, { status: 500 });
  }

  const dateLabel = toKstDateString();
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [profilesRes, managersRes, servicesRes, snapshotsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, name")
      .eq("status", "근무")
      .neq("email", EXCLUDED_TEAM_EMAIL)
      .not("email", "is", null),
    supabase.from("license_managers").select("service_id, profile_id"),
    supabase.from("services").select("*").eq("is_hub_card", false).eq("status", "활성"),
    supabase
      .from("license_mail_snapshots")
      .select("profile_id, sent_at, snapshot")
      .order("sent_at", { ascending: false })
  ]);

  if (profilesRes.error) {
    console.error("[license-digest] profiles fetch failed", profilesRes.error);
    return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
  }
  if (managersRes.error) {
    console.error("[license-digest] license_managers fetch failed", managersRes.error);
    return NextResponse.json({ error: managersRes.error.message }, { status: 500 });
  }
  if (servicesRes.error) {
    console.error("[license-digest] services fetch failed", servicesRes.error);
    return NextResponse.json({ error: servicesRes.error.message }, { status: 500 });
  }
  if (snapshotsRes.error) {
    console.error("[license-digest] license_mail_snapshots fetch failed", snapshotsRes.error);
    return NextResponse.json({ error: snapshotsRes.error.message }, { status: 500 });
  }

  const serviceMap = new Map<string, License>();
  for (const row of servicesRes.data ?? []) {
    const license = row as License;
    if (isSubscriptionLicense(license)) {
      serviceMap.set(license.id, license);
    }
  }

  const serviceIdsByProfile = new Map<string, string[]>();
  for (const row of managersRes.data ?? []) {
    const profileId = String(row.profile_id ?? "");
    const serviceId = String(row.service_id ?? "");
    if (!profileId || !serviceId) continue;
    const list = serviceIdsByProfile.get(profileId) ?? [];
    if (!list.includes(serviceId)) list.push(serviceId);
    serviceIdsByProfile.set(profileId, list);
  }

  const latestSnapshotByProfile = new Map<string, MailSnapshot>();
  for (const row of snapshotsRes.data ?? []) {
    const profileId = String(row.profile_id ?? "");
    if (!profileId || latestSnapshotByProfile.has(profileId)) continue;
    latestSnapshotByProfile.set(profileId, row.snapshot as MailSnapshot);
  }

  const resend = new Resend(resendApiKey);
  let sent = 0;
  let skipped = 0;
  const errors: { profileId: string; error: string }[] = [];

  for (const profile of (profilesRes.data ?? []) as ProfileRow[]) {
    try {
      const email = profile.email?.trim().toLowerCase();
      if (!email) {
        skipped += 1;
        continue;
      }

      const serviceIds = serviceIdsByProfile.get(profile.id) ?? [];
      const snapshot = buildMemberSnapshot(serviceIds, serviceMap);
      const previous = latestSnapshotByProfile.get(profile.id) ?? null;
      const changes = diffSnapshots(previous, snapshot);

      const html = buildLicenseDigestHtml({
        dateLabel,
        memberName: profile.name?.trim() || profile.email,
        profileId: profile.id,
        snapshot,
        previous,
        changes
      });

      const subject = `[아폴론 Hub] 라이선스 현황 — ${dateLabel}`;

      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [email],
        subject,
        html
      });

      if (error) {
        console.error("[license-digest] Resend failed", { profileId: profile.id, error });
        errors.push({ profileId: profile.id, error: error.message });
        continue;
      }

      const { error: insertError } = await supabase.from("license_mail_snapshots").insert({
        profile_id: profile.id,
        sent_at: new Date().toISOString(),
        snapshot,
        total_monthly_krw: snapshot.total_monthly_krw ?? 0
      });

      if (insertError) {
        console.error("[license-digest] snapshot insert failed", {
          profileId: profile.id,
          messageId: data?.id,
          error: insertError
        });
        errors.push({ profileId: profile.id, error: insertError.message });
        continue;
      }

      sent += 1;
      console.log("[license-digest] sent", {
        profileId: profile.id,
        email,
        messageId: data?.id,
        totalMonthlyKrw: snapshot.total_monthly_krw,
        changes: changes.length
      });
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    dateLabel,
    members: (profilesRes.data ?? []).length,
    sent,
    skipped,
    errors
  });
}
