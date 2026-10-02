import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotionSource } from "@/lib/luna/notion";
import { userMcp, validateTeamspace, connectionRow } from "./connection";
import { checkedSearchResults, scopedSearchArgs, NotionConnectionError, object } from "./policy";
export async function searchLiveNotion(admin: SupabaseClient, userId: string, query: string, signal: AbortSignal) {
  const {mcp, revision, notionUserId} = await userMcp(admin, userId, signal);
  await validateTeamspace(mcp);
  const names = await mcp.toolNames();
  if (!names.includes("notion-get-tool-access")) throw new NotionConnectionError("scope_unverified", "노션 검색 권한을 확인하지 못했습니다.");
  const access = object(object(await mcp.call("notion-get-tool-access", {})).current_tool_access);
  const ai = object(access.ai_search);
  const useAi = ai.status === "available" && names.includes("notion-ai-search");
  if (!useAi) throw new NotionConnectionError("ai_unavailable", "연결한 노션 계정에서 AI 검색을 사용할 수 없습니다. 노션 요금제와 연결 권한을 확인해 주세요.");
  const restrictions = ai.restricted_parameters;
  // Exact filters and access discovery are both required. No keyword/index fallback.
  if (JSON.stringify(restrictions || {}).includes('"teamspace_id"')) throw new NotionConnectionError("scope_unverified", "노션 팀스페이스 제한을 사용할 수 없습니다.");
  const rows = checkedSearchResults(await mcp.call("notion-ai-search", scopedSearchArgs(query)));
  const seen = new Set<string>();
  const sources: NotionSource[] = [];
  for (const row of rows) {
    const url = row.url as string;
    const id = typeof row.id === "string" ? row.id : url.match(/[0-9a-f]{32}/i)?.[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const excerpt = [row.highlight, row.highlights, row.excerpt, row.content, row.snippet].find(v => typeof v === "string" || Array.isArray(v));
    sources.push({id, url, title: typeof row.title === "string" ? row.title : "노션 자료", excerpt: (Array.isArray(excerpt) ? excerpt.filter(v=>typeof v === "string").join("\n") : typeof excerpt === "string" ? excerpt : "").slice(0, 6000)});
  }
  const current = await connectionRow(admin, userId);
  if (!current || current.revision !== revision || current.notion_user_id !== notionUserId) throw new NotionConnectionError("reconnect", "노션 연결이 변경되어 검색 결과를 사용하지 않았습니다.");
  return sources;
}
