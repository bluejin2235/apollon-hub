import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  buildAmountHighlightCard,
  buildHubEmailShell,
  buildInfoTable,
  EMAIL_HEADER_CREDIT,
  toKstDateTimeString
} from "@/lib/mail/hub-email";

const RECIPIENT = "tjlee@apollonworks.com";
const AGENTS_URL = "https://hub.apollonworks.com/agents";

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
  const registeredAtKst = toKstDateTimeString();
  const amountText = formatAmountSubText(body);
  const table = buildInfoTable([
    { label: "서비스", value: body.service_name },
    { label: "결제 유형", value: body.payment_type },
    { label: "결제일", value: body.paid_at },
    ...(body.memo?.trim() ? [{ label: "메모", value: body.memo.trim() }] : []),
    { label: "등록자", value: body.registered_by_name }
  ]);

  const bodyHtml = `${buildAmountHighlightCard("결제 금액", amountText)}${table}`;

  return buildHubEmailShell({
    headerBg: EMAIL_HEADER_CREDIT,
    headerLabel: "아르테 · AI 비용",
    title: "크레딧 · 추가 결제 등록",
    subtitle: `등록 일시 ${registeredAtKst}`,
    bodyHtml,
    cta: { href: AGENTS_URL, label: "크레딧 내역 보기" }
  });
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
