import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { canAccessWebsiteAdmin } from "@/lib/auth/website-tester";
import { websiteAdminFetch } from "@/lib/website/client";
import { applyHubActorHeaders, getHubActor } from "@/lib/website/hub-actor";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * 조치 기록의 적은 사람은 브라우저가 보낸 값을 믿지 않는다.
 * 새로 적을 때 로그인 사용자 이름을 넣고, 고칠 때는 바꾸지 못하게 뺀다.
 */
function statsActionBody(text: string, method: string, actorName: string | null): string | undefined {
  if (!text) return undefined;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    delete json.created_by;
    if (method === "POST") json.created_by = actorName?.trim() || null;
    return JSON.stringify(json);
  } catch {
    return text;
  }
}

/**
 * 목표 키워드를 고친 사람도 브라우저 값 대신 로그인 사용자 이름으로 채운다.
 * JSON 객체가 아니면 null (프록시가 400 으로 돌려준다).
 */
function targetKeywordBody(text: string, actorName: string | null): string | null {
  try {
    const json = JSON.parse(text) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const record = json as Record<string, unknown>;
    record.updated_by = actorName?.trim() || null;
    return JSON.stringify(record);
  } catch {
    return null;
  }
}

async function proxy(request: NextRequest, ctx: Ctx, method: string) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const actor = await getHubActor(admin, user.id);
  if (!canAccessWebsiteAdmin(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { path } = await ctx.params;
  const joined = (path ?? []).join("/");
  if (!joined || joined.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const headers = new Headers();
  applyHubActorHeaders(headers, user.id, actor.name);
  const init: RequestInit = { method, headers };

  try {
    const isTargetKeywords = joined === "stats/target-keywords" || joined.startsWith("stats/target-keywords/");
    if (isTargetKeywords && method !== "GET" && method !== "HEAD") {
      // 목표 키워드 쓰기는 JSON 객체만 받는다(multipart 로 updated_by 덮어쓰기를 우회하지 못하게)
      const body = targetKeywordBody(await request.text(), actor.name);
      if (body === null) {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
      }
      init.body = body;
      const jsonHeaders = new Headers(init.headers);
      jsonHeaders.set("Content-Type", "application/json");
      init.headers = jsonHeaders;
    } else if (method !== "GET" && method !== "HEAD") {
      if (contentType.includes("multipart/form-data")) {
        const expected = Number(request.headers.get("content-length") || 0);
        const raw = await request.arrayBuffer();
        if (expected > 0 && raw.byteLength < expected) {
          return NextResponse.json(
            {
              error: "upload_body_read_failed",
              details: {
                message:
                  "업로드 본문이 미들웨어에서 잘렸습니다. GIF·큰 파일은 Storage 직접 업로드를 쓰거나 파일 크기를 줄여 주세요.",
                received: raw.byteLength,
                expected
              }
            },
            { status: 413 }
          );
        }
        init.body = raw;
        const uploadHeaders = new Headers(init.headers);
        uploadHeaders.set("Content-Type", contentType);
        init.headers = uploadHeaders;
      } else {
        const text = await request.text();
        if (joined === "stats/actions" || joined.startsWith("stats/actions/")) {
          init.body = statsActionBody(text, method, actor.name);
        } else if (text) {
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
