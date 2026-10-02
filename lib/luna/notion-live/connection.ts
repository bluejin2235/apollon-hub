import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal, unseal, randomSecret, sha256 } from "./crypto";
import { NOTION_MCP_ORIGIN, NOTION_CALLBACK, LUNA_ORIGIN, NOTION_TEAMSPACE_ID, NotionConnectionError, object } from "./policy";
import { NotionMcp } from "./mcp";
const TABLE = "luna_notion_connections";
const ATTEMPTS = "luna_notion_oauth_attempts";
type Credentials = {client_id: string; client_secret?: string; access_token: string; refresh_token?: string};
type Attempt = {client_id: string; client_secret?: string; verifier: string};
export type ConnectionRow = {user_id: string; notion_user_id: string; workspace_id: string; credentials: string; expires_at: string; revision: string; refresh_until: string | null; refresh_id: string | null};
async function metadata() {
  const response = await fetch(`${NOTION_MCP_ORIGIN}/.well-known/oauth-authorization-server`, {cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error("OAuth discovery failed");
  const data = object(await response.json());
  for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
    if (typeof data[key] !== "string" || new URL(data[key] as string).origin !== NOTION_MCP_ORIGIN) throw new Error("Unexpected OAuth endpoint");
  }
  return data as {authorization_endpoint: string; token_endpoint: string; registration_endpoint: string};
}
export async function connectionRow(admin: SupabaseClient, userId: string): Promise<ConnectionRow | null> {
  const {data, error} = await admin.from(TABLE).select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Connection store unavailable");
  return data as ConnectionRow | null;
}
export async function beginConnection(admin: SupabaseClient, userId: string) {
  const meta = await metadata();
  const existing = await connectionRow(admin, userId);
  let client: {client_id: string; client_secret?: string} | undefined;
  if (existing) { try { client = unseal<Credentials>(existing.credentials, userId); } catch { /* rotated server key */ } }
  if (!client) {
    const response = await fetch(meta.registration_endpoint, {method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000), headers: {"Content-Type": "application/json"}, body: JSON.stringify({client_name: "APOLLON LUNA", client_uri: LUNA_ORIGIN, redirect_uris: [NOTION_CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none"})});
    if (!response.ok) throw new Error("OAuth registration failed");
    const r = object(await response.json());
    if (typeof r.client_id !== "string") throw new Error("Missing OAuth client");
    client = {client_id: r.client_id, ...(typeof r.client_secret === "string" ? {client_secret: r.client_secret} : {})};
  }
  const state = randomSecret(), verifier = randomSecret(), binding = randomSecret();
  const {error} = await admin.from(ATTEMPTS).upsert({user_id: userId, state_hash: sha256(state), binding_hash: sha256(binding), payload: seal({...client, verifier}, userId), expires_at: new Date(Date.now()+600000).toISOString()}, {onConflict: "user_id"});
  if (error) throw new Error("Could not save authorization attempt");
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({response_type: "code", client_id: client.client_id, redirect_uri: NOTION_CALLBACK, scope: "default", state, code_challenge: sha256(verifier), code_challenge_method: "S256", prompt: "consent"}).toString();
  return {url: url.toString(), binding};
}
async function tokenRequest(params: Record<string, string>) {
  const meta = await metadata();
  const response = await fetch(meta.token_endpoint, {method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000), headers: {"Content-Type": "application/x-www-form-urlencoded", Accept: "application/json"}, body: new URLSearchParams(params)});
  if (!response.ok) {
    // Do not log token responses or OAuth codes.
    const data = object(await response.json().catch(() => ({})));
    throw new NotionConnectionError(data.error === "invalid_grant" ? "reconnect" : "unavailable", "노션 연결을 완료하지 못했습니다. 다시 연결해 주세요.");
  }
  const data = object(await response.json());
  if (typeof data.access_token !== "string" || typeof data.expires_in !== "number" || data.expires_in <= 0) throw new Error("Invalid OAuth token response");
  return data;
}
export async function validateTeamspace(mcp: NotionMcp) {
  const teams = object(await mcp.call("notion-get-teams", {query: "아폴론 Working"}));
  if (!Array.isArray(teams.joinedTeams) || !teams.joinedTeams.some(v => {const t=object(v); return t.id === NOTION_TEAMSPACE_ID && t.in_trash !== true && t.role !== "none";})) throw new NotionConnectionError("wrong_workspace", "아폴론 Working 팀스페이스에 참여한 노션 계정으로 연결해 주세요.");
}
export async function finishConnection(admin: SupabaseClient, userId: string, state: string, binding: string, code: string) {
  if (!state || !binding || !code || state.length > 200 || code.length > 4000) throw new Error("Invalid OAuth callback");
  // Atomic single-use consumption binds state, browser, authenticated Luna ID and expiry.
  const {data, error} = await admin.from(ATTEMPTS).delete().eq("user_id", userId).eq("state_hash", sha256(state)).eq("binding_hash", sha256(binding)).gt("expires_at", new Date().toISOString()).select("payload").maybeSingle();
  if (error || !data) throw new NotionConnectionError("expired", "연결 요청이 만료되었습니다. 루나에서 다시 연결해 주세요.");
  const attempt = unseal<Attempt>(data.payload, userId);
  const tokens = await tokenRequest({grant_type: "authorization_code", client_id: attempt.client_id, redirect_uri: NOTION_CALLBACK, code_verifier: attempt.verifier, code, ...(attempt.client_secret ? {client_secret: attempt.client_secret} : {})});
  if (typeof tokens.user_id !== "string" || typeof tokens.workspace_id !== "string") throw new NotionConnectionError("identity_unverified", "노션 계정의 고유 ID를 확인하지 못했습니다.");
  const mcp = new NotionMcp(tokens.access_token as string); await mcp.initialize(); await validateTeamspace(mcp);
  const credentials: Credentials = {client_id: attempt.client_id, client_secret: attempt.client_secret, access_token: tokens.access_token as string, ...(typeof tokens.refresh_token === "string" ? {refresh_token: tokens.refresh_token} : {})};
  const saved = await admin.from(TABLE).upsert({user_id: userId, notion_user_id: tokens.user_id, workspace_id: tokens.workspace_id, credentials: seal(credentials, userId), expires_at: new Date(Date.now()+(tokens.expires_in as number)*1000).toISOString(), revision: randomUUID(), refresh_id: null, refresh_until: null, connected_at: new Date().toISOString()}, {onConflict: "user_id"});
  if (saved.error) throw new NotionConnectionError("identity_conflict", "이 노션 계정이 다른 루나 사용자에게 연결되어 있거나 저장에 실패했습니다.");
}
export async function userMcp(admin: SupabaseClient, userId: string, signal?: AbortSignal) {
  let row = await connectionRow(admin, userId);
  if (!row) throw new NotionConnectionError("connect", "내 노션 계정을 먼저 연결해 주세요.");
  let credentials: Credentials;
  try { credentials = unseal<Credentials>(row.credentials, userId); } catch { throw new NotionConnectionError("reconnect", "노션을 다시 연결해 주세요."); }
  if (Date.parse(row.expires_at) < Date.now()+60000) {
    const lock = randomUUID();
    const acquired = await admin.from(TABLE).update({refresh_id: lock, refresh_until: new Date(Date.now()+60000).toISOString()}).eq("user_id", userId).eq("revision", row.revision).or(`refresh_until.is.null,refresh_until.lt.${new Date().toISOString()}`).select("user_id").maybeSingle();
    if (acquired.error) throw new Error("Refresh lock failed");
    if (!acquired.data) throw new NotionConnectionError("busy", "노션 연결을 갱신 중입니다. 잠시 후 다시 검색해 주세요.");
    try {
      if (!credentials.refresh_token) throw new NotionConnectionError("reconnect", "노션을 다시 연결해 주세요.");
      const tokens = await tokenRequest({grant_type: "refresh_token", client_id: credentials.client_id, refresh_token: credentials.refresh_token, ...(credentials.client_secret ? {client_secret: credentials.client_secret} : {})});
      credentials = {...credentials, access_token: tokens.access_token as string, ...(typeof tokens.refresh_token === "string" ? {refresh_token: tokens.refresh_token} : {})};
      const saved = await admin.from(TABLE).update({credentials: seal(credentials, userId), expires_at: new Date(Date.now()+(tokens.expires_in as number)*1000).toISOString(), revision: randomUUID(), refresh_id: null, refresh_until: null}).eq("user_id", userId).eq("revision", row.revision).eq("refresh_id", lock).select("user_id").maybeSingle();
      if (saved.error || !saved.data) throw new Error("Refresh persistence failed");
    } catch (error) {
      if (error instanceof NotionConnectionError && error.code === "reconnect") await admin.from(TABLE).delete().eq("user_id", userId).eq("revision", row.revision).eq("refresh_id", lock);
      else await admin.from(TABLE).update({refresh_id: null, refresh_until: null}).eq("user_id", userId).eq("revision", row.revision).eq("refresh_id", lock);
      throw error;
    }
    row = await connectionRow(admin, userId);
    if (!row) throw new NotionConnectionError("reconnect", "노션을 다시 연결해 주세요.");
  }
  signal?.throwIfAborted();
  const mcp = new NotionMcp(credentials.access_token, signal); await mcp.initialize();
  return {mcp, revision: row.revision, notionUserId: row.notion_user_id};
}
