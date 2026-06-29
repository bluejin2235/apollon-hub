import { NextRequest, NextResponse } from "next/server";
import { isResearchManagerServer } from "@/lib/auth/check-research-manager";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { resolveCommonGptPrompt } from "@/lib/research/gpt-curator-prompt";
import type { TrendSource } from "@/lib/research/types";

export const runtime = "nodejs";

const WEB_SEARCH_SYSTEM_PROMPT_FALLBACK = `너는 미디어 아키텍처 스튜디오 아폴론이머시브웍스의 트렌드 리서처야.
주어진 사이트에서 아폴론이 참고할 만한 최신 기사를 찾아서 JSON 배열로만 반환해.
아폴론의 관심 분야: 미디어 아키텍처, 미디어파사드, 인터랙티브 설치, 몰입형 경험, 전시/뮤지엄 공간, 리테일 경험 디자인, 공공공간 디지털 설치, AI/기술 활용 공간 경험.
제외: 패션, 뷰티, 식품, 자동차, 스포츠, 디지털 요소 없는 단순 건축.
반드시 아래 JSON 형식으로만 응답해. 다른 텍스트 없이.
[{"title": "기사제목", "url": "https://...", "description": "한줄요약", "published_at": "2026-06-25"}]
없으면: []`;

type TestCollectBody = {
  source_id: string;
  date_from?: string;
  date_to?: string;
};

type DateRange = {
  from: Date;
  to: Date;
};

type CollectedArticle = {
  title: string;
  url: string;
  description?: string;
  published_at: string;
};

function dateRangeFromStrings(dateFrom: string, dateTo: string): DateRange | null {
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const to = new Date(`${dateTo}T23:59:59.999Z`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return null;
  }

  return { from, to };
}

const URL_VALIDATION_TIMEOUT_MS = 5_000;
const URL_VALIDATION_CONCURRENCY = 3;

async function validateArticleUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(URL_VALIDATION_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ApollonHub/1.0)"
      }
    });

    const ok = response.status >= 200 && response.status < 300;
    if (!ok) {
      console.log(
        `[research/sources/test-collect] URL validation failed: ${url} status=${response.status}`
      );
    }
    return ok;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`[research/sources/test-collect] URL validation error: ${url} ${detail}`);
    return false;
  }
}

async function filterArticlesByValidUrls(articles: CollectedArticle[]): Promise<{
  valid: CollectedArticle[];
  urlValidationFailed: number;
}> {
  if (articles.length === 0) {
    return { valid: [], urlValidationFailed: 0 };
  }

  console.log("[research/sources/test-collect] === URL validation start ===", articles.length);

  const validationResults = new Array<boolean>(articles.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= articles.length) break;

      const article = articles[index];
      validationResults[index] = await validateArticleUrl(article.url);
    }
  }

  const workerCount = Math.min(URL_VALIDATION_CONCURRENCY, articles.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const valid: CollectedArticle[] = [];
  let urlValidationFailed = 0;

  for (const [index, article] of articles.entries()) {
    if (validationResults[index]) {
      valid.push(article);
    } else {
      urlValidationFailed += 1;
    }
  }

  console.log(
    "[research/sources/test-collect] === URL validation done ===",
    `${articles.length} -> ${valid.length} (${urlValidationFailed} failed)`
  );

  return { valid, urlValidationFailed };
}

function buildCollectResultMessage(collected: number, skipped: number, urlValidationFailed: number): string {
  const suffix = urlValidationFailed > 0 ? " (URL 검증 실패 포함)" : "";
  return `${collected}건 추가, ${skipped}건 스킵${suffix}`;
}

function matchKeywords(title: string, description: string, keywords: string[]): string[] {
  const text = (title + " " + description).toLowerCase();
  return keywords.filter((kw) => text.includes(kw.toLowerCase()));
}

function normalizeSiteUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function buildWebSearchUserPrompt(siteUrl: string, dateRange: DateRange | null): string {
  const dateHint = dateRange
    ? ` (${dateRange.from.toISOString().slice(0, 10)} ~ ${dateRange.to.toISOString().slice(0, 10)} 기간 내 기사 우선)`
    : "";

  return `${siteUrl} 사이트에서 위 기준에 맞는 최신 기사 5~10개를 찾아줘.${dateHint}`;
}

function extractResponseText(payload: {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}): string {
  console.log("[research/sources/test-collect] extractResponseText: has output_text =", Boolean(payload.output_text?.trim()));
  console.log("[research/sources/test-collect] extractResponseText: output item count =", payload.output?.length ?? 0);

  if (payload.output?.length) {
    for (const [index, item] of payload.output.entries()) {
      console.log(
        `[research/sources/test-collect] output[${index}] type=${item.type ?? "unknown"} content_blocks=${item.content?.length ?? 0}`
      );
      if (item.type === "web_search_call" || item.type === "web_search_preview") {
        console.log(`[research/sources/test-collect] output[${index}] web_search item:`, JSON.stringify(item).slice(0, 500));
      }
    }
  }

  if (payload.output_text?.trim()) {
    return payload.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const block of item.content ?? []) {
      if (block.type === "output_text" && block.text?.trim()) {
        parts.push(block.text.trim());
      }
    }
  }

  return parts.join("\n").trim();
}

function parseCollectedArticles(content: string): CollectedArticle[] {
  const trimmed = content.trim();
  console.log("[research/sources/test-collect] parseCollectedArticles: content length =", trimmed.length);
  console.log("[research/sources/test-collect] parseCollectedArticles: content preview =", trimmed.slice(0, 800));

  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  const jsonText = jsonMatch?.[0] ?? trimmed;
  console.log("[research/sources/test-collect] parseCollectedArticles: jsonText length =", jsonText.length);
  console.log("[research/sources/test-collect] parseCollectedArticles: jsonText preview =", jsonText.slice(0, 800));

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch (parseError) {
    console.error("[research/sources/test-collect] parseCollectedArticles: JSON.parse failed", parseError);
    throw parseError;
  }

  if (!Array.isArray(parsed)) {
    console.error("[research/sources/test-collect] parseCollectedArticles: not an array, type =", typeof parsed);
    throw new Error("GPT response is not a JSON array");
  }

  console.log("[research/sources/test-collect] parseCollectedArticles: array length =", parsed.length);

  const articles: CollectedArticle[] = [];

  for (const [index, item] of parsed.entries()) {
    if (!item || typeof item !== "object") {
      console.log(`[research/sources/test-collect] parseCollectedArticles: skip[${index}] not an object`);
      continue;
    }

    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const description = typeof row.description === "string" ? row.description.trim() : undefined;
    const publishedAt =
      typeof row.published_at === "string"
        ? row.published_at.trim()
        : typeof row.publishedAt === "string"
          ? row.publishedAt.trim()
          : "";

    if (!title || !url) {
      console.log(
        `[research/sources/test-collect] parseCollectedArticles: skip[${index}] missing title/url`,
        JSON.stringify(row).slice(0, 200)
      );
      continue;
    }

    articles.push({
      title,
      url,
      description,
      published_at: publishedAt || new Date().toISOString()
    });
  }

  console.log("[research/sources/test-collect] parseCollectedArticles: valid articles =", articles.length);
  return articles;
}

function filterArticlesByDateRange(articles: CollectedArticle[], dateRange: DateRange | null): CollectedArticle[] {
  if (!dateRange) {
    console.log("[research/sources/test-collect] filterArticlesByDateRange: no date range, keeping all", articles.length);
    return articles;
  }

  const filtered = articles.filter((article) => {
    const publishedAt = new Date(article.published_at);
    if (Number.isNaN(publishedAt.getTime())) return true;
    return publishedAt >= dateRange.from && publishedAt <= dateRange.to;
  });

  console.log(
    "[research/sources/test-collect] filterArticlesByDateRange:",
    `${articles.length} -> ${filtered.length}`,
    `range=${dateRange.from.toISOString()}..${dateRange.to.toISOString()}`
  );

  if (articles.length > 0 && filtered.length === 0) {
    console.log(
      "[research/sources/test-collect] filterArticlesByDateRange: all filtered out, sample published_at values:",
      articles.slice(0, 5).map((a) => a.published_at)
    );
  }

  return filtered;
}

async function collectArticlesViaWebSearch(
  siteUrl: string,
  dateRange: DateRange | null,
  systemPrompt: string
): Promise<CollectedArticle[]> {
  const apiKey = process.env.hubtrendchat_chatgpt;
  if (!apiKey) {
    throw new Error("ChatGPT API key is not configured");
  }

  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const userPrompt = buildWebSearchUserPrompt(normalizedSiteUrl, dateRange);
  console.log("[research/sources/test-collect] === STEP 1: OpenAI request ===");
  console.log("[research/sources/test-collect] siteUrl (raw):", siteUrl);
  console.log("[research/sources/test-collect] siteUrl (normalized):", normalizedSiteUrl);
  console.log("[research/sources/test-collect] apiKey configured:", Boolean(apiKey));
  console.log("[research/sources/test-collect] user prompt:", userPrompt);

  const requestBody = {
    model: "gpt-4o",
    instructions: systemPrompt,
    tools: [{ type: "web_search_preview" }],
    input: userPrompt
  };
  console.log("[research/sources/test-collect] request body preview:", {
    model: requestBody.model,
    instructionsLength: systemPrompt.length,
    input: userPrompt,
    tools: requestBody.tools
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(180_000)
  });

  console.log("[research/sources/test-collect] === STEP 2: OpenAI response status ===", response.status, response.statusText);

  if (!response.ok) {
    const detail = await response.text();
    console.error("[research/sources/test-collect] OpenAI error body:", detail.slice(0, 2000));
    throw new Error(`GPT web search failed (${response.status}): ${detail}`);
  }

  const rawBody = await response.text();
  console.log("[research/sources/test-collect] === STEP 3: raw response body (first 3000 chars) ===");
  console.log(rawBody.slice(0, 3000));

  let payload: {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    error?: unknown;
    status?: string;
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch (jsonError) {
    console.error("[research/sources/test-collect] failed to parse OpenAI JSON response", jsonError);
    throw jsonError;
  }

  const webSearchCalls = (payload.output ?? []).filter(
    (item) => item.type === "web_search_call" || item.type === "web_search_preview"
  );
  console.log("[research/sources/test-collect] === STEP 4: web_search items ===", webSearchCalls.length);
  for (const [index, call] of webSearchCalls.entries()) {
    console.log(`[research/sources/test-collect] web_search[${index}]:`, JSON.stringify(call).slice(0, 1000));
  }

  const content = extractResponseText(payload);
  console.log("[research/sources/test-collect] === STEP 5: extracted text length ===", content.length);
  if (!content) {
    console.error("[research/sources/test-collect] empty extracted text, full payload keys:", Object.keys(payload));
    throw new Error("GPT returned an empty response");
  }

  console.log("[research/sources/test-collect] === STEP 6: extracted text preview ===");
  console.log(content.slice(0, 2000));

  let parsedArticles: CollectedArticle[];
  try {
    parsedArticles = parseCollectedArticles(content);
  } catch (parseError) {
    console.error("[research/sources/test-collect] === STEP 7: JSON parse failed ===", parseError);
    throw parseError;
  }

  const articles = filterArticlesByDateRange(parsedArticles, dateRange);
  console.log("[research/sources/test-collect] === STEP 8: final articles after date filter ===", articles.length);
  if (articles.length > 0) {
    console.log("[research/sources/test-collect] sample article:", JSON.stringify(articles[0]));
  }

  return articles;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    const canManage = await isResearchManagerServer(admin, user.id);
    if (!canManage) {
      return NextResponse.json({ error: "트렌드 레이더 관리 권한이 없습니다." }, { status: 403 });
    }

    let body: TestCollectBody;
    try {
      body = (await request.json()) as TestCollectBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const sourceId = body.source_id?.trim();
    const dateFrom = body.date_from?.trim();
    const dateTo = body.date_to?.trim();

    if (!sourceId) {
      return NextResponse.json({ error: "source_id is required" }, { status: 400 });
    }

    const hasDateFilter = Boolean(dateFrom && dateTo);
    if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
      return NextResponse.json({ error: "date_from and date_to must both be provided or omitted" }, { status: 400 });
    }

    const range = hasDateFilter ? dateRangeFromStrings(dateFrom!, dateTo!) : null;
    if (hasDateFilter && !range) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const { data: sourceRow, error: sourceError } = await admin
      .from("trend_sources")
      .select("*")
      .eq("id", sourceId)
      .maybeSingle();

    if (sourceError) {
      return NextResponse.json({ error: sourceError.message }, { status: 500 });
    }

    if (!sourceRow) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    const source = sourceRow as TrendSource;
    const rawSiteUrl = source.url?.trim();

    if (!rawSiteUrl) {
      return NextResponse.json({ error: "사이트 URL이 설정되지 않았습니다." }, { status: 400 });
    }

    const systemPrompt =
      (await resolveCommonGptPrompt(admin, source.gpt_prompt)) || WEB_SEARCH_SYSTEM_PROMPT_FALLBACK;

    const siteUrl = normalizeSiteUrl(rawSiteUrl);
    console.log("[research/sources/test-collect] === START ===", {
      sourceId,
      rawSiteUrl,
      siteUrl,
      sourceName: source.name,
      hasDateFilter,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null
    });

    const collectedItems = await collectArticlesViaWebSearch(siteUrl, range, systemPrompt);
    console.log("[research/sources/test-collect] === collectedItems count ===", collectedItems.length);

    const { valid: validatedItems, urlValidationFailed } = await filterArticlesByValidUrls(collectedItems);

    const { data: existingRows, error: existingError } = await admin
      .from("trend_articles")
      .select("url")
      .eq("source_id", sourceId);

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const existingUrls = new Set((existingRows ?? []).map((row) => String((row as { url: string }).url)));
    console.log("[research/sources/test-collect] === existing urls in DB ===", existingUrls.size);

    let collected = 0;
    let skipped = urlValidationFailed;
    const seenInBatch = new Set<string>();

    for (const [index, item] of validatedItems.entries()) {
      if (existingUrls.has(item.url) || seenInBatch.has(item.url)) {
        console.log(`[research/sources/test-collect] INSERT skip[${index}] duplicate url:`, item.url);
        skipped += 1;
        continue;
      }

      const matchedKeywords = matchKeywords(item.title, item.description ?? "", source.keywords ?? []);
      const publishedAt = new Date(item.published_at);
      const collectedAt = Number.isNaN(publishedAt.getTime()) ? new Date().toISOString() : publishedAt.toISOString();

      const insertRow = {
        source_id: sourceId,
        title: item.title,
        url: item.url,
        summary: item.description ?? null,
        keywords: matchedKeywords,
        collected_at: collectedAt
      };
      console.log(`[research/sources/test-collect] INSERT attempt[${index}]:`, JSON.stringify(insertRow).slice(0, 300));

      const { error: insertError } = await admin.from("trend_articles").insert(insertRow);

      if (insertError) {
        console.error(`[research/sources/test-collect] INSERT failed[${index}]:`, insertError.message, insertError);
        skipped += 1;
        continue;
      }

      console.log(`[research/sources/test-collect] INSERT ok[${index}]:`, item.url);

      seenInBatch.add(item.url);
      existingUrls.add(item.url);
      collected += 1;
    }

    const now = new Date().toISOString();
    const nextArticleCount = source.article_count + collected;

    const { error: updateError } = await admin
      .from("trend_sources")
      .update({
        last_collected_at: collected > 0 ? now : source.last_collected_at,
        article_count: nextArticleCount
      })
      .eq("id", sourceId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    console.log("[research/sources/test-collect] === DONE ===", {
      collected,
      skipped,
      urlValidationFailed,
      method: "web-search"
    });

    const message = buildCollectResultMessage(collected, skipped, urlValidationFailed);

    return NextResponse.json({
      success: true,
      collected,
      skipped,
      url_validation_failed: urlValidationFailed,
      message,
      method: "web-search"
    });
  } catch (error) {
    console.error("[research/sources/test-collect]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
