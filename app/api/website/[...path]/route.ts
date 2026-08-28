import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  canAccessWebsiteAdmin,
  getProfileRole,
  isWebsiteTesterBlockedApiRequest,
  isWebsiteTesterRole
} from "@/lib/auth/website-tester";
import { websiteAdminFetch } from "@/lib/website/client";

// TODO(홈페이지 오픈 후 삭제) 개발 기간 한정 테스트 계정 권한

export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, ctx: Ctx, method: string) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const role = await getProfileRole(admin, user.id);
  if (!canAccessWebsiteAdmin(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { path } = await ctx.params;
  const joined = (path ?? []).join("/");
  if (!joined || joined.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (isWebsiteTesterRole(role) && (await isWebsiteTesterBlockedApiRequest(method, joined, request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const init: RequestInit = { method };

  if (method !== "GET" && method !== "HEAD") {
    if (contentType.includes("multipart/form-data")) {
      init.body = await request.formData();
    } else {
      const text = await request.text();
      if (text) init.body = text;
    }
  }

  try {
    const { status, body } = await websiteAdminFetch(
      `/api/admin/${joined}${request.nextUrl.search}`,
      init
    );
    return NextResponse.json(body, { status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "proxy_failed" },
      { status: 500 }
    );
  }
}

export function GET(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx, "GET");
}

export function POST(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx, "POST");
}

export function PATCH(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx, "PATCH");
}

export function PUT(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx, "PUT");
}

export function DELETE(request: NextRequest, ctx: Ctx) {
  return proxy(request, ctx, "DELETE");
}
