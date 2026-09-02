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

  try {
    if (method !== "GET" && method !== "HEAD") {
      if (contentType.includes("multipart/form-data")) {
        const raw = await request.arrayBuffer();
        init.body = raw;
        const headers = new Headers(init.headers);
        headers.set("Content-Type", contentType);
        init.headers = headers;
      } else {
        const text = await request.text();
        if (text) {
          if (method === "POST" && joined === "publish") {
            try {
              const json = JSON.parse(text) as Record<string, unknown>;
              if (!json.publishedBy) json.publishedBy = user.id;
              init.body = JSON.stringify(json);
            } catch {
              init.body = text;
            }
          } else {
            init.body = text;
          }
        }
      }
    }

    const { status, body } = await websiteAdminFetch(
      `/api/admin/${joined}${request.nextUrl.search}`,
      init
    );
    return NextResponse.json(body, { status });
  } catch (err) {
    console.error("[website proxy]", joined, err);
    const message = err instanceof Error ? err.message : "proxy_failed";
    const truncated =
      message.includes("boundary") || message.includes("Failed to parse body as FormData");
    return NextResponse.json(
      {
        error: truncated ? "upload_body_read_failed" : "proxy_failed",
        details: {
          message: truncated
            ? "업로드 본문이 잘렸거나 손상되었습니다. 파일이 너무 크면 200MB 이하여야 합니다."
            : message
        }
      },
      { status: truncated ? 413 : 500 }
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
