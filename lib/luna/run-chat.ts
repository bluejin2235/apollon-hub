import "server-only";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LunaCard } from "@/lib/luna/tavily";
import type { NotionSource } from "@/lib/luna/notion";
import type { WikiSourceRef } from "@/lib/luna/wiki-match";
import { executeLunaChat } from "@/lib/luna/chat-handler";
import { inspectSearchStream } from "@/lib/luna/search-quality";

export const LUNA_MODEL_LABEL = "운영 대화 엔진";
export type LunaConnectors = { notion?: boolean; web?: boolean; nas?: boolean };
export type LunaRunResult = {
  answer: string;
  sources: LunaCard[];
  notionSources: NotionSource[];
  wikiSources?: WikiSourceRef[];
  privateWikiRefs?: WikiSourceRef[];
  durationMs: number;
  modelLabel: string;
  injected_knowledge_ids?: string[];
  injected_terms?: string[];
  web_augmented?: boolean;
  stageMs?: Record<string, number>;
  metadata: Record<string, unknown>;
  streamAudit: ReturnType<typeof inspectSearchStream>;
};

/** Evaluations and self-study execute the production handler. The internal
 * evaluation option only disables conversation/learning writes, not retrieval.
 * Access is checked by the same handler; no HTTP auth bypass is introduced.
 */
export async function runLunaTurn(admin: SupabaseClient, message: string,
  connectors: LunaConnectors = {}, actorId?: string): Promise<LunaRunResult> {
  if (!actorId) {
    const {data,error} = await admin.from("profiles").select("id").eq("role","슈퍼관리자").order("id").limit(1).maybeSingle();
    if (error || !data?.id) throw new Error("평가 실행 권한이 있는 계정을 확인하지 못했습니다.");
    actorId = data.id as string;
  }
  const captured: { row?: {content:string;metadata:Record<string,unknown>} } = {};
  const started = Date.now();
  const response = await executeLunaChat(new NextRequest("https://luna.internal/api/luna/chat", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({conversation_id:crypto.randomUUID(), message, connectors})
  }), {admin,userId:actorId,evaluation:true,onResult:row=>{captured.row=row;}});
  const wire = await response.text();
  if (!response.ok) throw new Error(`운영 엔진 평가 실패 (${response.status})`);
  if (!captured.row) throw new Error("운영 엔진이 최종 결과를 완료하지 못했습니다.");
  const {content:answer,metadata} = captured.row;
  const notionSources = (metadata.notion_sources ?? []) as NotionSource[];
  return {
    answer, sources:(metadata.cards ?? []) as LunaCard[], notionSources,
    wikiSources:(metadata.wiki_sources ?? []) as WikiSourceRef[],
    privateWikiRefs:(metadata.private_wiki_refs ?? []) as WikiSourceRef[],
    durationMs:Date.now()-started,modelLabel:String(metadata.model_label ?? ""),
    injected_knowledge_ids:metadata.injected_knowledge_ids as string[]|undefined,
    injected_terms:metadata.injected_terms as string[]|undefined,
    web_augmented:metadata.web_augmented===true,
    stageMs:metadata.retrieval_timings as Record<string,number>|undefined,
    metadata, streamAudit:inspectSearchStream(wire, notionSources.map(s=>s.id), (metadata.cards ?? []) as LunaCard[])
  };
}
