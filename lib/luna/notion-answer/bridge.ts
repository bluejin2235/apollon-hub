import "server-only";
import { randomUUID } from "node:crypto";
import { NOTION_TEAMSPACE_ID } from "@/lib/luna/notion-live/policy";
import { ANSWER_PROTOCOL, MAX_REPLY_BYTES, AnswerBridgeError, sign, verifySignature, validateAnswer, type AnswerRequest } from "./protocol";

type Identity = { userId: string; notionUserId: string; workspaceId: string; connectionRevision: string };
export function bridgeConfig(userId: string) {
  const users = (process.env.LUNA_NOTION_ANSWER_PILOT_USERS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (process.env.LUNA_NOTION_ANSWER_PILOT !== "1" || !users.includes(userId)) {
    throw new AnswerBridgeError("not_ready", "노션 AI 원본 연결은 아직 운영 검증 중입니다. 기존 검색으로 대체하지 않습니다.");
  }
  const endpoint = process.env.LUNA_NOTION_ANSWER_WORKER_URL;
  const key = process.env.LUNA_NOTION_ANSWER_WORKER_KEY;
  if (!endpoint || !key || key.length < 32) throw new AnswerBridgeError("not_ready", "노션 브라우저 실행 서버가 연결되지 않았습니다.");
  let url: URL; try { url = new URL(endpoint); } catch { throw new AnswerBridgeError("not_ready", "실행 서버 주소를 확인해 주세요."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new AnswerBridgeError("not_ready", "실행 서버 주소를 확인해 주세요.");
  }
  return {endpoint, key};
}
async function readBounded(response: Response): Promise<string> {
  if (!response.body) throw new AnswerBridgeError("invalid_reply", "노션 응답이 비어 있습니다.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_REPLY_BYTES) { await reader.cancel(); throw new AnswerBridgeError("too_large", "노션 답변이 수신 한도를 초과했습니다. 잘린 답변은 표시하지 않습니다."); }
      parts.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(parts));
}
export async function getOriginalNotionAnswer(identity: Identity, question: string, signal: AbortSignal) {
  const config = bridgeConfig(identity.userId);
  signal.throwIfAborted();
  const issuedAt = Date.now();
  const request: AnswerRequest = {protocol: ANSWER_PROTOCOL, ...identity, requestId: randomUUID(),
    teamspaceId: NOTION_TEAMSPACE_ID, question, issuedAt, deadline: issuedAt + 240000};
  const body = JSON.stringify(request);
  // This is OUR worker protocol, not an undocumented Notion endpoint.
  // Never forward the existing MCP token, a browser cookie, or a password.
  const response = await fetch(config.endpoint, {method: "POST", redirect: "error", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
    headers: {"Content-Type": "application/json", "X-Luna-Signature": sign(body, config.key)}, body});
  if (!response.ok) throw new AnswerBridgeError("worker_failed", "노션 브라우저 검색을 완료하지 못했습니다. 대체 답변은 생성하지 않습니다.");
  const raw = await readBounded(response);
  signal.throwIfAborted();
  if (!verifySignature(raw, response.headers.get("X-Luna-Signature"), config.key)) {
    throw new AnswerBridgeError("invalid_signature", "노션 답변 수신 경로를 검증하지 못했습니다.");
  }
  let payload: unknown; try { payload = JSON.parse(raw); } catch { throw new AnswerBridgeError("invalid_reply", "노션 답변 형식을 확인하지 못했습니다."); }
  return validateAnswer(payload, request);
}
