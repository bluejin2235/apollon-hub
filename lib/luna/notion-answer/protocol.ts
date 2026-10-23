import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NOTION_TEAMSPACE_ID } from "@/lib/luna/notion-live/policy";

export const ANSWER_PROTOCOL = "luna-notion-browser-answer-v1";
export const MAX_REPLY_BYTES = 2 * 1024 * 1024;
export type AnswerRequest = {
  protocol: typeof ANSWER_PROTOCOL;
  requestId: string;
  userId: string;
  notionUserId: string;
  workspaceId: string;
  connectionRevision: string;
  teamspaceId: string;
  question: string;
  issuedAt: number;
  deadline: number;
};
export type OriginalAnswer = {
  protocol: typeof ANSWER_PROTOCOL;
  requestId: string;
  userId: string;
  notionUserId: string;
  workspaceId: string;
  connectionRevision: string;
  question: string;
  status: "completed";
  source: "notion-personal-ai-browser";
  scope: { teamspaceIds: string[]; externalSources: false; checkedBefore: true; checkedAfter: true };
  chatUrl: string;
  text: string;
  textSha256: string;
  citations: Array<{ title: string; url: string }>;
  completedAt: number;
};

export class AnswerBridgeError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function digest(text: string): string { return createHash("sha256").update(text, "utf8").digest("hex"); }
export function sign(body: string, key: string): string { return createHmac("sha256", key).update(body, "utf8").digest("hex"); }
export function verifySignature(body: string, signature: string | null, key: string): boolean {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(body, key), "hex"));
}
function reject(): never { throw new AnswerBridgeError("invalid_reply", "노션 원본 답변의 계정·완료·범위 검증에 실패했습니다."); }
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return reject();
  return v as Record<string, unknown>;
}
function notionUrl(v: unknown, chat = false): string {
  if (typeof v !== "string" || v.length > 4096) return reject();
  let u: URL; try { u = new URL(v); } catch { return reject(); }
  if (u.protocol !== "https:" || u.username || u.password || u.port ||
      !["app.notion.com", "www.notion.so", "notion.so"].includes(u.hostname)) return reject();
  if (chat && (u.hostname !== "app.notion.com" || u.pathname !== "/chat" || !/^[a-f0-9]{32}$/i.test(u.searchParams.get("t") || ""))) return reject();
  return v;
}
/** Attestation from our trusted worker, NOT a signature or ACL guarantee from Notion. */
export function validateAnswer(value: unknown, request: AnswerRequest, now = Date.now()): OriginalAnswer {
  const r = record(value);
  for (const key of ["protocol", "requestId", "userId", "notionUserId", "workspaceId", "connectionRevision", "question"] as const) {
    if (r[key] !== request[key]) reject();
  }
  if (r.status !== "completed" || r.source !== "notion-personal-ai-browser" ||
      typeof r.completedAt !== "number" || !Number.isFinite(r.completedAt) ||
      r.completedAt < request.issuedAt || r.completedAt > now || now > request.deadline) reject();
  const scope = record(r.scope);
  if (request.teamspaceId !== NOTION_TEAMSPACE_ID || !Array.isArray(scope.teamspaceIds) ||
      scope.teamspaceIds.length !== 1 || scope.teamspaceIds[0] !== NOTION_TEAMSPACE_ID ||
      scope.externalSources !== false || scope.checkedBefore !== true || scope.checkedAfter !== true) reject();
  if (typeof r.text !== "string" || !r.text.trim() || Buffer.byteLength(r.text, "utf8") > MAX_REPLY_BYTES || r.textSha256 !== digest(r.text)) reject();
  notionUrl(r.chatUrl, true);
  if (!Array.isArray(r.citations) || r.citations.length > 1000) reject();
  const citations = r.citations.map(v => {
    const c = record(v); if (typeof c.title !== "string" || c.title.length > 4000) return reject();
    return {title: c.title, url: notionUrl(c.url)};
  });
  // Do not trim, truncate, rewrite citations into the text, or send it to an LLM.
  return {protocol: ANSWER_PROTOCOL, requestId: request.requestId, userId: request.userId,
    notionUserId: request.notionUserId, workspaceId: request.workspaceId,
    connectionRevision: request.connectionRevision, question: request.question,
    status: "completed", source: "notion-personal-ai-browser",
    scope: {teamspaceIds: [NOTION_TEAMSPACE_ID], externalSources: false, checkedBefore: true, checkedAfter: true},
    chatUrl: r.chatUrl as string, text: r.text, textSha256: r.textSha256 as string, citations, completedAt: r.completedAt};
}
