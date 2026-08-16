import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { EXCLUDED_TEAM_EMAIL } from "@/lib/mail/hub-email";
import {
  buildExpiryEmailHtml,
  buildExpiryEmailSubject,
  buildExpiryInAppCopy,
  calendarDaysUntil,
  kstTodayYmd,
  milestoneForDaysUntil,
  type ExpiryItem,
  type ExpiryMilestone
} from "@/lib/licenses/expiry-notify";
import type { License } from "@/lib/licenses/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type ProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
};

type SendRow = {
  service_id: string;
  milestone: ExpiryMilestone;
  channel: "email" | "in_app";
  profile_id: string;
};

function sendKey(row: {
  service_id: string;
  milestone: string;
  channel: string;
  profile_id: string;
}): string {
  return `${row.service_id}|${row.milestone}|${row.channel}|${row.profile_id}`;
}

function profileEmail(profile: ProfileRow): string | null {
  const email = profile.email?.trim().toLowerCase() ?? "";
  if (!email || email === EXCLUDED_TEAM_EMAIL) return null;
  return email;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[license-expiry] CRON_SECRET is not configured");
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
    console.error("[license-expiry] Supabase env vars missing");
    return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
  }

  const todayYmd = kstTodayYmd();
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [servicesRes, managersRes, profilesRes, sentRes] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("status", "활성")
      .eq("is_hub_card", false)
      .not("end_date", "is", null),
    supabase.from("license_managers").select("service_id, profile_id"),
    supabase.from("profiles").select("id, email, name, role"),
    supabase
      .from("license_expiry_sends")
      .select("service_id, milestone, channel, profile_id")
      .eq("send_date", todayYmd)
  ]);

  if (servicesRes.error) {
    console.error("[license-expiry] services fetch failed", servicesRes.error);
    return NextResponse.json({ error: servicesRes.error.message }, { status: 500 });
  }
  if (managersRes.error) {
    console.error("[license-expiry] license_managers fetch failed", managersRes.error);
    return NextResponse.json({ error: managersRes.error.message }, { status: 500 });
  }
  if (profilesRes.error) {
    console.error("[license-expiry] profiles fetch failed", profilesRes.error);
    return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
  }
  if (sentRes.error) {
    console.error("[license-expiry] license_expiry_sends fetch failed", sentRes.error);
    return NextResponse.json(
      { error: sentRes.error.message, hint: "license_expiry_sends 테이블이 없으면 migrations/license_expiry_sends.sql 을 실행하세요." },
      { status: 500 }
    );
  }

  const profileMap = new Map<string, ProfileRow>();
  const superAdmins: ProfileRow[] = [];
  for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
    profileMap.set(row.id, row);
    if (row.role === "슈퍼관리자") superAdmins.push(row);
  }

  const managerIdsByService = new Map<string, string[]>();
  for (const row of managersRes.data ?? []) {
    const serviceId = String(row.service_id ?? "");
    const profileId = String(row.profile_id ?? "");
    if (!serviceId || !profileId) continue;
    const list = managerIdsByService.get(serviceId) ?? [];
    if (!list.includes(profileId)) list.push(profileId);
    managerIdsByService.set(serviceId, list);
  }

  const alreadySent = new Set((sentRes.data ?? []).map((row) => sendKey(row as SendRow)));

  const dueToday: ExpiryItem[] = [];
  for (const row of servicesRes.data ?? []) {
    const service = row as License;
    const endYmd = service.end_date?.slice(0, 10);
    if (!endYmd) continue;
    const daysUntil = calendarDaysUntil(endYmd, todayYmd);
    const milestone = milestoneForDaysUntil(daysUntil);
    if (!milestone) continue;
    const managerIds = managerIdsByService.get(service.id) ?? [];
    const managerNames = managerIds
      .map((id) => profileMap.get(id)?.name?.trim())
      .filter((name): name is string => Boolean(name));
    dueToday.push({ service, milestone, daysUntil, managerNames });
  }

  const emailItems = dueToday.filter((item) => item.milestone === "d7");
  const inAppDayItems = dueToday.filter((item) => item.milestone === "d0");
  const inAppOverdueItems = dueToday.filter((item) => item.milestone === "overdue");

  let emailsSent = 0;
  let inAppSent = 0;
  const errors: string[] = [];

  async function recordSends(rows: SendRow[]): Promise<boolean> {
    if (rows.length === 0) return true;
    const { error } = await supabase.from("license_expiry_sends").insert(
      rows.map((row) => ({
        ...row,
        send_date: todayYmd
      }))
    );
    if (error) {
      console.error("[license-expiry] send log insert failed", error);
      errors.push(error.message);
      return false;
    }
    for (const row of rows) alreadySent.add(sendKey(row));
    return true;
  }

  function pendingItems(
    items: ExpiryItem[],
    channel: "email" | "in_app",
    profileId: string
  ): ExpiryItem[] {
    return items.filter(
      (item) =>
        !alreadySent.has(
          sendKey({
            service_id: item.service.id,
            milestone: item.milestone,
            channel,
            profile_id: profileId
          })
        )
    );
  }

  function recipientsForEmail(item: ExpiryItem): ProfileRow[] {
    const managerIds = managerIdsByService.get(item.service.id) ?? [];
    const map = new Map<string, ProfileRow>();
    for (const id of managerIds) {
      const profile = profileMap.get(id);
      if (profile && profileEmail(profile)) map.set(profile.id, profile);
    }
    for (const admin of superAdmins) {
      if (profileEmail(admin)) map.set(admin.id, admin);
    }
    return [...map.values()];
  }

  if (emailItems.length > 0) {
    if (!resendApiKey || !fromEmail) {
      console.error("[license-expiry] Resend env vars missing");
      errors.push("Resend environment variables missing");
    } else {
      const itemsByProfile = new Map<string, ExpiryItem[]>();
      for (const item of emailItems) {
        for (const profile of recipientsForEmail(item)) {
          const list = itemsByProfile.get(profile.id) ?? [];
          list.push(item);
          itemsByProfile.set(profile.id, list);
        }
      }

      const resend = new Resend(resendApiKey);
      for (const [profileId, items] of itemsByProfile) {
        const profile = profileMap.get(profileId);
        const email = profile ? profileEmail(profile) : null;
        if (!profile || !email) continue;
        const pending = pendingItems(items, "email", profileId);
        if (pending.length === 0) continue;

        const { error } = await resend.emails.send({
          from: fromEmail,
          to: [email],
          subject: buildExpiryEmailSubject(pending),
          html: buildExpiryEmailHtml(pending)
        });

        if (error) {
          console.error("[license-expiry] Resend failed", { profileId, error });
          errors.push(`${profileId}: ${error.message}`);
          continue;
        }

        const ok = await recordSends(
          pending.map((item) => ({
            service_id: item.service.id,
            milestone: item.milestone,
            channel: "email",
            profile_id: profileId
          }))
        );
        if (ok) emailsSent += 1;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }

  async function insertUserInApp(items: ExpiryItem[], profile: ProfileRow): Promise<number> {
    const pending = pendingItems(items, "in_app", profile.id);
    if (pending.length === 0) return 0;
    const copy = buildExpiryInAppCopy(pending);
    const { error } = await supabase.from("hub_notifications").insert({
      category: "license_expiry",
      title: copy.title,
      body: copy.body,
      link: "/licenses",
      level: "warn",
      scope: "user",
      target_user_id: profile.id,
      meta: {
        service_ids: pending.map((item) => item.service.id),
        milestones: pending.map((item) => item.milestone)
      }
    });
    if (error) {
      console.error("[license-expiry] hub_notifications insert failed", error);
      errors.push(error.message);
      return 0;
    }
    const ok = await recordSends(
      pending.map((item) => ({
        service_id: item.service.id,
        milestone: item.milestone,
        channel: "in_app",
        profile_id: profile.id
      }))
    );
    return ok ? 1 : 0;
  }

  async function insertAdminInApp(items: ExpiryItem[]): Promise<number> {
    const pendingByAdmin = superAdmins.map((admin) => ({
      admin,
      pending: pendingItems(items, "in_app", admin.id)
    }));
    const union: ExpiryItem[] = [];
    const seen = new Set<string>();
    for (const { pending } of pendingByAdmin) {
      for (const item of pending) {
        if (seen.has(item.service.id)) continue;
        seen.add(item.service.id);
        union.push(item);
      }
    }
    if (union.length === 0) return 0;

    const copy = buildExpiryInAppCopy(union);
    const { error } = await supabase.from("hub_notifications").insert({
      category: "license_expiry",
      title: copy.title,
      body: copy.body,
      link: "/licenses",
      level: "warn",
      scope: "admin",
      target_user_id: null,
      meta: {
        service_ids: union.map((item) => item.service.id),
        milestones: union.map((item) => item.milestone)
      }
    });
    if (error) {
      console.error("[license-expiry] hub_notifications insert failed", error);
      errors.push(error.message);
      return 0;
    }

    const rows: SendRow[] = [];
    for (const { admin, pending } of pendingByAdmin) {
      for (const item of pending) {
        rows.push({
          service_id: item.service.id,
          milestone: item.milestone,
          channel: "in_app",
          profile_id: admin.id
        });
      }
    }
    const ok = await recordSends(rows);
    return ok ? 1 : 0;
  }

  const superAdminIds = new Set(superAdmins.map((p) => p.id));

  if (inAppDayItems.length > 0) {
    inAppSent += await insertAdminInApp(inAppDayItems);

    const managerRecipients = new Map<string, ExpiryItem[]>();
    for (const item of inAppDayItems) {
      for (const id of managerIdsByService.get(item.service.id) ?? []) {
        if (superAdminIds.has(id)) continue;
        const list = managerRecipients.get(id) ?? [];
        list.push(item);
        managerRecipients.set(id, list);
      }
    }
    for (const [profileId, items] of managerRecipients) {
      const profile = profileMap.get(profileId);
      if (!profile) continue;
      inAppSent += await insertUserInApp(items, profile);
    }
  }

  if (inAppOverdueItems.length > 0) {
    inAppSent += await insertAdminInApp(inAppOverdueItems);
  }

  console.log("[license-expiry]", {
    todayYmd,
    due: dueToday.length,
    emailsSent,
    inAppSent,
    errors: errors.length
  });

  return NextResponse.json({
    success: errors.length === 0,
    todayYmd,
    due: dueToday.map((item) => ({
      name: item.service.name,
      end_date: item.service.end_date,
      milestone: item.milestone,
      daysUntil: item.daysUntil
    })),
    emailsSent,
    inAppSent,
    errors
  });
}
