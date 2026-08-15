import type { SupabaseClient } from "@supabase/supabase-js";
import {
  llmComplete,
  type LlmToolDef
} from "@/lib/luna/llm/client";
import type { ResolvedProviderModel } from "@/lib/luna/engine";
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

export const WORKSERVER_TOOL_DEFS: LlmToolDef[] = [
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
 * Anthropic / OpenAI / Gemini 모두 llmComplete 경로.
 */
export async function exploreWorkserverWithTools(
  admin: SupabaseClient,
  _client: unknown,
  opts: {
    keywords: string;
    queryText: string;
    model: string;
    exploreSystem: string;
    provider?: ResolvedProviderModel["provider"];
    maxRounds?: number;
    timeoutMs?: number;
    onToolRound?: (toolName: string) => void;
    onUsage?: (usage: unknown) => void;
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
  const provider = opts.provider ?? "anthropic";
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

  let conversationHint = `질문: ${queryText}\n검색 키워드 힌트: ${hintKeywords}\n(프로젝트명·문서명만 space로 구분해 search_all/search_in keywords에 넣으세요. 위치·알려줘 등은 제외)`;

  for (let round = 0; round < maxRounds; round += 1) {
    if (Date.now() - loopStarted > timeoutMs) break;

    const res = await llmComplete({
      provider,
      model_id: opts.model,
      system:
        opts.exploreSystem.trim() ||
        "Work서버 폴더를 단계적으로 탐색해 관련 자료를 찾으세요.",
      user: conversationHint,
      maxTokens: 1024,
      tools: WORKSERVER_TOOL_DEFS
    });
    opts.onUsage?.(res.usage);

    if (res.toolCalls.length === 0) break;

    const resultNotes: string[] = [];
    for (const tu of res.toolCalls) {
      opts.onToolRound?.(tu.name);
      const input = tu.input;

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
      resultNotes.push(
        `${tu.name}(${JSON.stringify(input)}) → ${items.length}건\n${JSON.stringify(items).slice(0, 4000)}`
      );
    }

    conversationHint = `${conversationHint}\n\n[이전 도구 결과]\n${resultNotes.join("\n")}\n\n필요하면 추가 도구를 호출하고, 충분하면 도구 없이 끝내세요.`;
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
