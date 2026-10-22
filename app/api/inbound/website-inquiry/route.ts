import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

const NAME_MAX = 80;
const COMPANY_MAX = 120;

function secretsEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export async function POST(request: NextRequest) {
  const secret = process.env.WEBSITE_ADMIN_SECRET?.trim();
  if (!secret) {
    console.error("[inbound/website-inquiry] WEBSITE_ADMIN_SECRET missing");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }

  const token = readBearer(request);
  if (!token || !secretsEqual(token, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const name = clip(record?.name, NAME_MAX);
  const company = clip(record?.company, COMPANY_MAX) || "—";
  if (!name) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    console.error("[inbound/website-inquiry] supabase missing");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }

  const { error } = await admin.from("hub_notifications").insert({
    category: "website_inquiry",
    title: `새 프로젝트 문의 — ${name} · ${company}`,
    body: null,
    link: "/website/contact",
    level: "info",
    scope: "admin",
    meta: { source: "website_inquiry" }
  });

  if (error) {
    console.error("[inbound/website-inquiry] insert", error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
