import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RECIPIENT = "tjlee@apollonworks.com";
const AGENTS_URL = "https://apollon-hub.vercel.app/agents";

type NotifyCreditBody = {
  service_name: string;
  payment_type: string;
  amount_krw: number;
  amount_usd?: number | null;
  usd_krw_rate?: number | null;
  currency?: string;
  paid_at: string;
  memo?: string | null;
  registered_by_name: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatKstNow(): string {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const d = kst.getUTCDate();
  const h = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}년 ${m}월 ${d}일 ${h}:${min} (KST)`;
}

function buildItemCard(mainText: string, subText: string): string {
  return `<div style="background: rgba(230,204,190,0.15); border: 0.5px solid #E6CCBE; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 14px; color: #5A5353; font-weight: 500;">${escapeHtml(mainText)}</span>
      <span style="font-size: 11px; color: #776274;">${escapeHtml(subText)}</span>
    </div>`;
}

function formatAmountSubText(body: NotifyCreditBody): string {
  const krw = `₩${body.amount_krw.toLocaleString("ko-KR")}`;
  if (body.currency === "USD" && body.amount_usd != null) {
    const usd = `$${body.amount_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const rate =
      body.usd_krw_rate != null
        ? ` · 1$=${body.usd_krw_rate.toLocaleString("ko-KR")}원`
        : "";
    return `${krw} (${usd}${rate})`;
  }
  return krw;
}

function buildCreditNotifyHtml(body: NotifyCreditBody): string {
  const registeredAtKst = formatKstNow();
  const cards = [
    buildItemCard("서비스", body.service_name),
    buildItemCard("결제 유형", body.payment_type),
    buildItemCard("금액", formatAmountSubText(body)),
    buildItemCard("결제일", body.paid_at),
    ...(body.memo?.trim()
      ? [buildItemCard("메모", body.memo.trim())]
      : []),
    buildItemCard("등록자", body.registered_by_name)
  ].join("\n");

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e0d8d4;">
  <div style="background: #5A5353; padding: 28px 32px;">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
      <div style="width: 28px; height: 28px; background: #A07178; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #E6CCBE;">A</div>
      <span style="color: #E6CCBE; font-size: 12px; font-weight: 500; letter-spacing: 0.05em;">APOLLON HUB</span>
    </div>
    <h1 style="color: #ffffff; font-size: 20px; font-weight: 500; margin: 0 0 4px;">💳 크레딧 · 추가 결제 등록 알림</h1>
    <p style="color: #C8CC92; font-size: 13px; margin: 0;">등록 일시 ${escapeHtml(registeredAtKst)}</p>
  </div>
  <div style="padding: 24px 32px; background: #ffffff;">
    ${cards}
    <div style="text-align: center; margin-top: 24px;">
      <a href="${AGENTS_URL}" style="display: inline-block; background: #5A5353; color: #E6CCBE; font-size: 14px; font-weight: 500; padding: 12px 32px; border-radius: 8px; text-decoration: none; letter-spacing: 0.02em;">크레딧 내역 보기</a>
    </div>
  </div>
  <div style="padding: 16px 32px; background: rgba(160,113,120,0.1); border-top: 0.5px solid #E6CCBE; text-align: center;">
    <p style="font-size: 12px; color: #776274; margin: 0;">아폴론이머시브웍스 · hub@apollonworks.com</p>
  </div>
</div>`;
}

async function getAuthenticatedUser(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !anonKey) return null;

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!resendApiKey || !fromEmail) {
      console.error("[notify-credit] Resend env vars missing");
      return NextResponse.json({ error: "Resend environment variables missing" }, { status: 500 });
    }

    let body: NotifyCreditBody;
    try {
      body = (await request.json()) as NotifyCreditBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const serviceName = body.service_name?.trim();
    const paidAt = body.paid_at?.trim();
    const amountKrw = Number(body.amount_krw);

    if (!serviceName || !paidAt || !Number.isFinite(amountKrw) || amountKrw <= 0) {
      return NextResponse.json(
        { error: "service_name, amount_krw, paid_at are required" },
        { status: 400 }
      );
    }

    const normalized: NotifyCreditBody = {
      service_name: serviceName,
      payment_type: body.payment_type?.trim() || "—",
      amount_krw: amountKrw,
      amount_usd: body.amount_usd ?? null,
      usd_krw_rate: body.usd_krw_rate ?? null,
      currency: body.currency?.trim() || "KRW",
      paid_at: paidAt,
      memo: body.memo ?? null,
      registered_by_name: body.registered_by_name?.trim() || "—"
    };

    const subject = `[아폴론 Hub] 크레딧 등록 알림 — ${serviceName} ${amountKrw.toLocaleString("ko-KR")}원`;
    const html = buildCreditNotifyHtml(normalized);

    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [RECIPIENT],
      subject,
      html
    });

    if (error) {
      console.error("[notify-credit] Resend failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[notify-credit] sent", { messageId: data?.id, serviceName, amountKrw });
    return NextResponse.json({ success: true, messageId: data?.id });
  } catch (e) {
    console.error("[notify-credit] unexpected error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
