import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listFolder,
  prepareSearchTerms,
  refineWorkserverHits,
  runWorkserverResultPipeline,
  searchAll,
  searchIn,
  searchNasLegacy,
  type WorkserverItem
} from "@/lib/luna/workserver";

export const WS_TOOL_LOOP_MS = 25_000;
export const MAX_WS_TOOL_ROUNDS = 5;

export type WorkserverExploreRow = {
  drive: string | null;
  path: string;
  type: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  file_summary: string | null;
  importance?: number | null;
  variant_hidden?: number;
};

export const WORKSERVER_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_folder",
    description: "Work서버 특정 경로 바로 아래 항목 보기. 경로를 비우면 최상위",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        drive: { type: "string" }
      }
    }
  },
  {
    name: "search_in",
    description: "Work서버 특정 경로 아래에서만 검색",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        keywords: { type: "string" }
      },
      required: ["path", "keywords"]
    }
  },
  {
    name: "search_all",
    description: "Work서버 전체 검색. 어디를 볼지 모를 때만",
    input_schema: {
      type: "object",
      properties: {
        keywords: { type: "string" }
      },
      required: ["keywords"]
    }
  }
];

function itemToRow(item: WorkserverItem): WorkserverExploreRow {
  return {
    drive: item.drive,
    path: item.path,
    type: item.type,
    size_bytes: null,
    modified_at: item.modified_at,
    file_summary: item.file_summary,
    importance: item.importance,
    variant_hidden: item.variant_hidden
  };
}

export function finalizeWorkserverExploreRows(
  rows: WorkserverExploreRow[]
): WorkserverExploreRow[] {
  return runWorkserverResultPipeline(rows);
}

/**
 * 채팅·시험 공통 Work서버 탐색 (seed searchAll → 도구 루프 → refine → pipeline).
 */
export async function exploreWorkserverWithTools(
  admin: SupabaseClient,
  client: Anthropic,
  opts: {
    keywords: string;
    queryText: string;
    model: string;
    exploreSystem: string;
    maxRounds?: number;
    timeoutMs?: number;
    onToolRound?: (toolName: string) => void;
    onUsage?: (usage: Anthropic.Usage | undefined) => void;
  }
): Promise<{
  rows: WorkserverExploreRow[];
  toolCalls: Array<{ tool: string; input: unknown; result_count: number }>;
}> {
  const queryText = opts.queryText.trim();
  const kw = opts.keywords.trim();
  const loopStarted = Date.now();
  const timeoutMs = opts.timeoutMs ?? WS_TOOL_LOOP_MS;
  const maxRounds = opts.maxRounds ?? MAX_WS_TOOL_ROUNDS;
  const collected = new Map<string, WorkserverExploreRow>();
  const toolCalls: Array<{ tool: string; input: unknown; result_count: number }> =
    [];

  const seedTerms = prepareSearchTerms(kw, queryText);
  const hintKeywords = seedTerms.join(" ") || kw || queryText;

  if (seedTerms.length > 0 || hintKeywords) {
    try {
      const seeded = await searchAll(admin, hintKeywords, queryText);
      for (const item of seeded) {
        const key = `${item.drive ?? ""}::${item.path}`;
        if (!collected.has(key)) collected.set(key, itemToRow(item));
      }
      console.log(
        "[luna/ws] seed search",
        { hintKeywords },
        "→",
        seeded.length
      );
    } catch (seedErr) {
      console.error("[luna/ws] seed search", seedErr);
    }
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `질문: ${queryText}\n검색 키워드 힌트: ${hintKeywords}\n(프로젝트명·문서명만 space로 구분해 search_all/search_in keywords에 넣으세요. 위치·알려줘 등은 제외)`
    }
  ];

  for (let round = 0; round < maxRounds; round += 1) {
    if (Date.now() - loopStarted > timeoutMs) break;

    const res = await client.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system:
        opts.exploreSystem.trim() ||
        "Work서버 폴더를 단계적으로 탐색해 관련 자료를 찾으세요.",
      tools: WORKSERVER_TOOLS,
      messages
    });
    opts.onUsage?.(res.usage);

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: res.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      opts.onToolRound?.(tu.name);
      const input =
        tu.input && typeof tu.input === "object"
          ? (tu.input as Record<string, unknown>)
          : {};

      let items: WorkserverItem[] = [];
      try {
        if (tu.name === "list_folder") {
          items = await listFolder(
            admin,
            typeof input.path === "string" ? input.path : "",
            typeof input.drive === "string" ? input.drive : undefined
          );
        } else if (tu.name === "search_in") {
          items = await searchIn(
            admin,
            typeof input.path === "string" ? input.path : "",
            typeof input.keywords === "string" ? input.keywords : "",
            typeof input.drive === "string" ? input.drive : undefined,
            queryText
          );
        } else if (tu.name === "search_all") {
          items = await searchAll(
            admin,
            typeof input.keywords === "string" ? input.keywords : "",
            queryText
          );
        }
      } catch (toolErr) {
        console.error("[luna/ws] tool exec", tu.name, toolErr);
        items = [];
      }

      toolCalls.push({
        tool: tu.name,
        input,
        result_count: items.length
      });
      console.log("[luna/ws] tool", tu.name, input, "→", items.length);

      for (const item of items) {
        const key = `${item.drive ?? ""}::${item.path}`;
        if (!collected.has(key)) collected.set(key, itemToRow(item));
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(items)
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  const refined = refineWorkserverHits(
    Array.from(collected.values()),
    queryText
  );
  return {
    rows: finalizeWorkserverExploreRows(refined),
    toolCalls
  };
}

/** 도구 루프 실패 시 채팅과 동일한 legacy fallback */
export async function exploreWorkserverFallback(
  admin: SupabaseClient,
  keywords: string,
  queryText: string
): Promise<WorkserverExploreRow[]> {
  const legacy = await searchNasLegacy(admin, keywords || queryText, queryText);
  return finalizeWorkserverExploreRows(
    refineWorkserverHits(
      legacy.map((row) => ({
        drive: row.drive,
        path: row.path,
        type: row.type,
        size_bytes: row.size_bytes,
        modified_at: row.modified_at,
        file_summary: row.file_summary,
        importance: row.importance
      })),
      queryText
    )
  );
}
