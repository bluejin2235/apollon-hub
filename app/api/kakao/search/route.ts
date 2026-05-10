import { NextRequest, NextResponse } from "next/server";

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";

/** Node 런타임에서 `process.env`를 요청 시점에 읽도록 고정 (Edge/캐시 이슈 회피) */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 카카오 로컬 키워드 검색 프록시 — 클라이언트에 REST API 키 노출 방지 */
export async function GET(request: NextRequest) {
  try {
    const rawKey = process.env.KAKAO_REST_API_KEY;
    const restKey = typeof rawKey === "string" ? rawKey.trim() : "";

    if (process.env.NODE_ENV === "development") {
      console.log("[api/kakao/search] env KAKAO_REST_API_KEY:", {
        defined: rawKey !== undefined,
        lengthAfterTrim: restKey.length,
        hasNonWhitespace: Boolean(rawKey && rawKey.length > 0)
      });
    }

    if (process.env.VERCEL) {
      console.info("[api/kakao/search] runtime env", {
        hasKakaoRestKey: restKey.length > 0,
        keyLength: restKey.length
      });
    }

    if (!restKey) {
      console.error(
        "[api/kakao/search] KAKAO_REST_API_KEY 비어 있음 — Vercel Project Settings → Environment Variables에 KAKAO_REST_API_KEY(REST API 키)를 추가하고 Production/Preview에 연결한 뒤 재배포하세요."
      );
      return NextResponse.json({ error: "KAKAO_REST_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
    if (!query) {
      return NextResponse.json({ error: "query 파라미터가 필요합니다." }, { status: 400 });
    }

    const url = new URL(KAKAO_KEYWORD_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("size", "15");

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          Authorization: `KakaoAK ${restKey}`,
          Accept: "application/json"
        },
        cache: "no-store"
      });
    } catch (err) {
      console.error("[api/kakao/search] fetch 네트워크 오류:", err);
      return NextResponse.json(
        {
          error: "카카오 API에 연결하지 못했습니다.",
          detail: err instanceof Error ? err.message : String(err)
        },
        { status: 502 }
      );
    }

    const body = await res.text();
    if (!res.ok) {
      console.error("[api/kakao/search] 카카오 로컬 API HTTP 오류:", {
        status: res.status,
        statusText: res.statusText,
        requestUrl: url.toString(),
        responseBody: body.slice(0, 500)
      });
      return NextResponse.json(
        { error: "카카오 로컬 API 요청 실패", status: res.status, detail: body.slice(0, 2000) },
        { status: 502 }
      );
    }

    try {
      const data = JSON.parse(body) as unknown;
      return NextResponse.json(data);
    } catch (parseErr) {
      console.error("[api/kakao/search] JSON 파싱 실패:", parseErr, "body 앞부분:", body.slice(0, 500));
      return NextResponse.json({ error: "카카오 API 응답 파싱 실패" }, { status: 502 });
    }
  } catch (e) {
    console.error("[api/kakao/search] unhandled:", e);
    return NextResponse.json(
      { error: "서버에서 검색 처리 중 오류가 발생했습니다.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
