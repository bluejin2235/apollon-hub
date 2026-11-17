import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth/get-api-user";
import {
  isAllowedWebsiteImageUrl,
  suggestAlt,
  type AltSuggestContext,
  type AltSuggestKind
} from "@/lib/website/alt-suggest";

export const runtime = "nodejs";

/** 같은 이미지 URL · 하루 캐시 (프로세스 메모리) */
const dayCache = new Map<string, { day: string; ko: string; en: string }>();

function kstDayKey(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function readContext(raw: unknown): AltSuggestContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind = asString(o.kind);
  if (kind !== "work" && kind !== "insight") return null;
  return {
    kind: kind as AltSuggestKind,
    titleKo: asString(o.titleKo) || null,
    titleEn: asString(o.titleEn) || null,
    category: asString(o.category) || null,
    locationCity: asString(o.locationCity) || null,
    locationCountry: asString(o.locationCountry) || null,
    sectionTitle: asString(o.sectionTitle) || null,
    fileName: asString(o.fileName) || null
  };
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const imageUrl = asString(rec?.imageUrl);
  const context = readContext(rec?.context);

  if (!imageUrl || !context) {
    return NextResponse.json(
      { data: null, error: "invalid_input", reason: "이미지 주소나 글 정보가 부족합니다" },
      { status: 400 }
    );
  }

  if (!isAllowedWebsiteImageUrl(imageUrl)) {
    return NextResponse.json(
      { data: null, error: "url_not_allowed", reason: "우리 저장소 이미지만 설명할 수 있습니다" },
      { status: 400 }
    );
  }

  const day = kstDayKey();
  const cached = dayCache.get(imageUrl);
  if (cached && cached.day === day) {
    return NextResponse.json({ data: { ko: cached.ko, en: cached.en }, cached: true });
  }

  const result = await suggestAlt({ imageUrl, context });
  if (!result) {
    return NextResponse.json({
      data: null,
      error: "suggest_failed",
      reason: "자동 설명을 못 썼어요. 직접 써 주세요"
    });
  }

  dayCache.set(imageUrl, { day, ko: result.ko, en: result.en });
  // 캐시 비대 방지
  if (dayCache.size > 500) {
    for (const [key, value] of dayCache) {
      if (value.day !== day) dayCache.delete(key);
    }
  }

  return NextResponse.json({ data: result, cached: false });
}
