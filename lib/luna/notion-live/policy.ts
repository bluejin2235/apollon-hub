/** Server-owned scope. A request or model can never select another teamspace. */
export const NOTION_TEAMSPACE_ID = "3a3c795f-b818-8180-90bb-0042b5b865cc";
export const NOTION_TEAMSPACE_NAME = "아폴론 Working";
export const NOTION_MCP_ORIGIN = "https://mcp.notion.com";
export const LUNA_ORIGIN = "https://hub.apollonworks.com";
export const NOTION_CALLBACK = `${LUNA_ORIGIN}/api/luna/notion/callback`;
export const LIVE_NOTION_POLICY = "user-oauth-teamspace-v1";
export class NotionConnectionError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function scopedSearchArgs(query: string) {
  return {query, query_type: "internal", teamspace_id: NOTION_TEAMSPACE_ID,
    filters: {teamspace_ids: [NOTION_TEAMSPACE_ID]}, page_size: 50, max_highlight_length: 4000};
}
export function checkedSearchResults(payload: unknown): Record<string, unknown>[] {
  const p = object(payload);
  // Notion can silently drop unavailable filters. Never consume that response.
  if (p.notices && (!Array.isArray(p.notices) || p.notices.length)) throw new NotionConnectionError("scope_unverified", "노션 검색 범위 제한을 확인하지 못해 결과를 사용하지 않았습니다.");
  if (!Array.isArray(p.results)) throw new NotionConnectionError("scope_unverified", "노션 검색 응답 형식을 확인하지 못했습니다.");
  const results = p.results.map(object);
  for (const r of results) {
    if (typeof r.teamspace_id === "string" && r.teamspace_id.replace(/-/g, "") !== NOTION_TEAMSPACE_ID.replace(/-/g, "")) throw new NotionConnectionError("scope_unverified", "허용되지 않은 노션 검색 범위입니다.");
    if (r.is_private === true || r.in_trash === true) throw new NotionConnectionError("scope_unverified", "허용되지 않은 노션 검색 결과입니다.");
    // Never include Slack, Mail, Calendar or arbitrary external URLs.
    if (typeof r.url !== "string") throw new NotionConnectionError("scope_unverified", "노션 출처를 확인하지 못했습니다.");
    const url = new URL(r.url);
    if (url.protocol !== "https:" || !["notion.so", "www.notion.so", "notion.com", "www.notion.com", "app.notion.com"].includes(url.hostname)) throw new NotionConnectionError("scope_unverified", "노션 외 출처를 제외하기 위해 검색을 중단했습니다.");
  }
  return results;
}
export function rejectLegacyNotionAccess(): void {
  throw new Error("공용 노션 색인 및 대표 토큰 검색은 중단되었습니다. 사용자별 노션 연결을 이용하세요.");
}
