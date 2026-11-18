import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";

/** 할 일 영역 — 통계 v3 「이번 주 할 일」 오른쪽 태그 */
const TODO_AREAS = ["검색", "콘텐츠", "AI", "방문 패턴", "수집 설정"] as const;

export type StatsBriefTodo = {
  level: "high" | "mid" | "low";
  title: string;
  reason: string;
  area?: (typeof TODO_AREAS)[number];
};

export type StatsBriefResult = {
  summary: string;
  todos: StatsBriefTodo[];
};

type Facts = {
  from?: unknown;
  to?: unknown;
  visitsBasis?: unknown;
  visits?: { current?: unknown; previous?: unknown };
  genericClicks?: { current?: unknown; previous?: unknown };
  searchToArticleRate?: { current?: unknown; previous?: unknown };
  impressions?: { current?: unknown; previous?: unknown };
  clicks?: { current?: unknown; previous?: unknown };
  clickRate?: { current?: unknown; previous?: unknown };
  bounceRate?: { current?: unknown; previous?: unknown };
  engagementRate?: { current?: unknown; previous?: unknown };
  avgEngagementTime?: { current?: unknown; previous?: unknown };
  previousIsOldSite?: unknown;
  channels?: unknown;
  queries?: unknown;
  pages?: unknown;
};

const BRIEF_TOOL: Anthropic.Messages.Tool = {
  name: "stats_brief",
  description: "홈페이지 통계 총평과 할 일",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "한국어 3~4문장. 무엇이 달라졌고 무엇이 문제인지. 비율은 56%처럼, 시간은 「1분 12초」처럼 쓸 것."
      },
      todos: {
        type: "array",
        description: "많아야 3개. 심각도 순. 근거 숫자가 없으면 빈 배열.",
        items: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["high", "mid", "low"] },
            title: { type: "string" },
            reason: { type: "string" },
            area: {
              type: "string",
              enum: [...TODO_AREAS],
              description: "이 할 일이 속한 통계 화면. 수집 방법을 바꾸는 일은 「수집 설정」"
            }
          },
          required: ["level", "title", "reason", "area"]
        }
      }
    },
    required: ["summary", "todos"]
  }
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pair(label: string, current: unknown, previous: unknown): string {
  const cur = current == null || current === "" ? "없음" : String(current);
  const prev = previous == null || previous === "" ? "없음" : String(previous);
  return `${label}: 이번 ${cur} / 지난 ${prev}`;
}

function strPair(
  label: string,
  current: unknown,
  previous: unknown
): string {
  const cur =
    typeof current === "string" && current.trim()
      ? current.trim()
      : current == null
        ? "없음"
        : String(current);
  const prev =
    typeof previous === "string" && previous.trim()
      ? previous.trim()
      : previous == null
        ? "없음"
        : String(previous);
  return `${label}: 이번 ${cur} / 지난 ${prev}`;
}

function listChannels(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "경로(세션 수):\n없음";
  return (
    "경로(세션 수):\n" +
    raw
      .slice(0, 5)
      .map((item) => {
        const row = item as { name?: unknown; sessions?: unknown };
        return `- ${String(row.name ?? "")} ${num(row.sessions) ?? 0}`;
      })
      .join("\n")
  );
}

function listQueries(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "검색어(노출·클릭·클릭률 %):\n없음";
  return (
    "검색어(노출·클릭·클릭률 %):\n" +
    raw
      .slice(0, 5)
      .map((item) => {
        const row = item as {
          name?: unknown;
          impressions?: unknown;
          clicks?: unknown;
          clickRate?: unknown;
        };
        const ctr = num(row.clickRate);
        return `- ${String(row.name ?? "")} 노출 ${num(row.impressions) ?? 0} 클릭 ${num(row.clicks) ?? 0} 클릭률 ${ctr == null ? "없음" : ctr} (%)`;
      })
      .join("\n")
  );
}

function listPages(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "페이지(조회 수):\n없음";
  return (
    "페이지(조회 수):\n" +
    raw
      .slice(0, 5)
      .map((item) => {
        const row = item as { path?: unknown; views?: unknown };
        return `- ${String(row.path ?? "")} ${num(row.views) ?? 0}`;
      })
      .join("\n")
  );
}

function buildPrompt(facts: Facts): string {
  const from = typeof facts.from === "string" ? facts.from : "";
  const to = typeof facts.to === "string" ? facts.to : "";
  return [
    "당신은 홈페이지 통계를 읽는 루나입니다. 한국어로 쓰세요.",
    "아래 숫자만 근거로 삼으세요. 없는 사실을 지어내지 마세요.",
    "비율 값은 이미 백분율입니다. 0.56 같은 소수로 쓰지 말고 56% 처럼 쓰세요.",
    "시간 값은 이미 「1분 12초」 형태입니다. 초 숫자로 바꾸지 마세요.",
    "stats_brief 도구로만 답하세요.",
    "summary: 3~4문장. 무엇이 달라졌고 무엇이 문제인지. 숫자를 직접 넣으세요.",
    "todos: 많아야 3개. 심각도 순. 근거 숫자가 없으면 빈 배열.",
    "숫자는 모두 새 홈페이지(오픈일 이후) 값입니다. 옛 홈페이지 숫자는 들어 있지 않습니다.",
    facts.previousIsOldSite === true
      ? "지난 기간은 옛 홈페이지 시절이라 값을 비워 두었습니다. 지난 기간과 비교하지 말고 이번 기간 숫자만 읽으세요."
      : null,
    "AI에서 온 방문과 문의하기 누름은 아직 모으지 않습니다. 이 둘에 대해 말하지 마세요.",
    "",
    `기간: ${from} ~ ${to}`,
    pair(
      facts.visitsBasis === "period"
        ? "방문자 (명, 기간 전체를 한 번 센 수)"
        : "방문자 (이번에는 기간 방문자 수를 세지 못해 값이 없음. 방문자 숫자를 말하지 마세요)",
      num(facts.visits?.current),
      num(facts.visits?.previous)
    ),
    pair(
      "일반 명사 검색 클릭 (회, 회사 이름이 아닌 검색어)",
      num(facts.genericClicks?.current),
      num(facts.genericClicks?.previous)
    ),
    pair(
      "검색으로 온 방문 중 워크·인사이트 글로 바로 들어온 비율 (%)",
      num(facts.searchToArticleRate?.current),
      num(facts.searchToArticleRate?.previous)
    ),
    pair("검색 노출 (회)", num(facts.impressions?.current), num(facts.impressions?.previous)),
    pair("검색 클릭 (회)", num(facts.clicks?.current), num(facts.clicks?.previous)),
    pair("검색 클릭률 (%)", num(facts.clickRate?.current), num(facts.clickRate?.previous)),
    pair("이탈률 (%)", num(facts.bounceRate?.current), num(facts.bounceRate?.previous)),
    pair("참여율 (%)", num(facts.engagementRate?.current), num(facts.engagementRate?.previous)),
    strPair(
      "평균 세션 시간",
      facts.avgEngagementTime?.current,
      facts.avgEngagementTime?.previous
    ),
    listChannels(facts.channels),
    listQueries(facts.queries),
    listPages(facts.pages)
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function parseToolResult(response: Anthropic.Messages.Message): StatsBriefResult | null {
  const block = response.content.find(
    (part): part is Anthropic.Messages.ToolUseBlock =>
      part.type === "tool_use" && part.name === "stats_brief"
  );
  if (!block || !block.input || typeof block.input !== "object") return null;

  const raw = block.input as { summary?: unknown; todos?: unknown };
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (!summary) return null;

  const todos: StatsBriefTodo[] = [];
  if (Array.isArray(raw.todos)) {
    for (const item of raw.todos.slice(0, 3)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const level =
        row.level === "high" || row.level === "mid" || row.level === "low" ? row.level : null;
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const reason = typeof row.reason === "string" ? row.reason.trim() : "";
      if (!level || !title || !reason) continue;
      const area = TODO_AREAS.find((name) => name === row.area);
      todos.push(area ? { level, title, reason, area } : { level, title, reason });
    }
  }
  return { summary, todos };
}

/**
 * 요약 화면용 루나 총평·할 일.
 * 클라이언트는 기간이 같으면 다시 부르지 않도록 캐시한다.
 */
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const facts = (body && typeof body === "object" ? (body as { facts?: Facts }).facts : null) ?? null;
  if (!facts || typeof facts.from !== "string" || typeof facts.to !== "string") {
    return NextResponse.json({ error: "invalid_facts" }, { status: 400 });
  }

  const apiKey =
    process.env.hubtrendchat_claude?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "api_key_missing" }, { status: 503 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      tools: [BRIEF_TOOL],
      tool_choice: { type: "tool", name: "stats_brief" },
      messages: [{ role: "user", content: buildPrompt(facts) }]
    });

    const parsed = parseToolResult(response);
    if (!parsed) {
      console.error("[website/luna/stats-brief] parse_failed", response.stop_reason);
      return NextResponse.json({ error: "parse_failed" }, { status: 502 });
    }

    return NextResponse.json({ data: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : "luna_failed";
    console.error("[website/luna/stats-brief]", message);
    return NextResponse.json({ error: "luna_failed" }, { status: 502 });
  }
}
