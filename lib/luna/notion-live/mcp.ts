import "server-only";
import { NOTION_MCP_ORIGIN, NotionConnectionError, object } from "./policy";
type RpcReply = {id?: number; result?: unknown; error?: unknown};
/** Read-only Streamable HTTP client. Never exposes write tools to an LLM. */
export class NotionMcp {
  private nextId = 0;
  private session?: string;
  private protocol = "2025-03-26";
  constructor(private token: string, private signal?: AbortSignal) {}
  private async request(method: string, params: unknown, notification = false): Promise<unknown> {
    const id = ++this.nextId;
    const response = await fetch(`${NOTION_MCP_ORIGIN}/mcp`, {
      method: "POST", cache: "no-store", redirect: "error",
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
      headers: {Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": this.protocol, ...(this.session ? {"Mcp-Session-Id": this.session} : {})},
      body: JSON.stringify({jsonrpc: "2.0", ...(notification ? {} : {id}), method, params})
    });
    if (response.status === 401 || response.status === 403) throw new NotionConnectionError("reconnect", "노션 연결이 만료되었거나 권한이 없습니다. 다시 연결해 주세요.");
    if (!response.ok) throw new NotionConnectionError("unavailable", "노션 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.");
    this.session = response.headers.get("mcp-session-id") || this.session;
    if (notification || response.status === 202) { await response.body?.cancel(); return {}; }
    if (response.headers.get("content-type")?.includes("application/json")) return this.reply(await response.json(), id);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty MCP response");
    const decoder = new TextDecoder(); let buffer = "", bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4_000_000) throw new Error("MCP response too large");
        buffer += decoder.decode(chunk.value, {stream: true}).replace(/\r\n/g, "\n");
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const data = event.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
          if (!data) continue;
          const parsed = JSON.parse(data) as RpcReply;
          if (parsed.id === id) return this.reply(parsed, id);
        }
      }
      throw new Error("Missing MCP result");
    } finally { await reader.cancel().catch(() => {}); }
  }
  private reply(value: unknown, id: number) {
    const result = object(value);
    if (result.id !== id || result.error) throw new NotionConnectionError("unavailable", "노션 요청을 완료하지 못했습니다.");
    return result.result;
  }
  async initialize() {
    const result = object(await this.request("initialize", {protocolVersion: this.protocol, capabilities: {}, clientInfo: {name: "apollon-luna", version: "1.0.0"}}));
    if (typeof result.protocolVersion === "string") this.protocol = result.protocolVersion;
    await this.request("notifications/initialized", {}, true);
  }
  async toolNames(): Promise<string[]> {
    const names: string[] = []; let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = object(await this.request("tools/list", cursor ? {cursor} : {}));
      if (Array.isArray(r.tools)) names.push(...r.tools.map(t => object(t).name).filter((n): n is string => typeof n === "string"));
      cursor = typeof r.nextCursor === "string" ? r.nextCursor : undefined;
      if (!cursor) return names;
    }
    throw new Error("Incomplete MCP tool list");
  }
  async call(name: string, args: Record<string, unknown>) {
    if (!["notion-get-tool-access", "notion-get-teams", "notion-ai-search", "notion-search"].includes(name)) throw new Error("Tool is not allowed");
    const result = object(await this.request("tools/call", {name, arguments: args}));
    if (result.isError) throw new NotionConnectionError("unavailable", "노션 검색 권한 또는 요청을 확인해 주세요.");
    if (result.structuredContent) return result.structuredContent;
    const content = Array.isArray(result.content) ? result.content.map(object) : [];
    const text = content.filter(c => c.type === "text").map(c => String(c.text || "")).join("\n");
    try { return JSON.parse(text); } catch { throw new NotionConnectionError("scope_unverified", "노션 응답 형식을 확인하지 못해 결과를 사용하지 않았습니다."); }
  }
}
