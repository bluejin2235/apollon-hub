import type { SupabaseClient } from "@supabase/supabase-js";
import { createQueryEmbedding } from "@/lib/luna/embedding";
import { parseAskedWhat } from "@/lib/luna/ask-what";
import { searchMediaForLuna } from "@/lib/luna/media-index-search";
import { exploreWorkserverFallback } from "@/lib/luna/workserver-explore";
import type { LunaCard } from "@/lib/luna/tavily";
import { runSearchTask } from "@/lib/luna/search-task";

/** Called only after Luna access and conversation ownership have been checked.
 * No Notion/wiki fallback is permitted for an explicitly selected source type.
 */
export function executeFocusedSearch({ admin, signal, conversationId, message, query = message, mode, persist, evaluation = false }: {
  admin: SupabaseClient;
  signal: AbortSignal;
  conversationId: string;
  message: string;
  query?: string;
  mode: "images" | "files";
  evaluation?: boolean;
  persist: (rows: Array<{role: string; content: string; metadata: Record<string, unknown>; [key: string]: unknown}>) => PromiseLike<{error: unknown}>;
}) {
  const startedAt = Date.now();
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
    async start(controller) {
      const check = () => { signal.throwIfAborted(); if (cancelled) throw new DOMException("Cancelled", "AbortError"); };
      const event = (value: Record<string, unknown>) => { check(); controller.enqueue(encoder.encode(JSON.stringify(value) + "\r\n")); };
      const userId = crypto.randomUUID(), assistantId = crypto.randomUUID();
      const key = mode === "images" ? "ui_image" : "ui_work";
      const label = mode === "images" ? "이미지 색인에서 찾고 있어요" : "Work에서 파일과 폴더를 찾고 있어요";
      let publicError = "검색에 실패했습니다. 다시 시도해 주세요.";
      try {
        event({ type: "ids", user_message_id: userId, assistant_message_id: assistantId });
        event({ type: "step", key, status: "running", label });
        let cards: LunaCard[];
        if (mode === "images") {
          const embedding = await runSearchTask(signal, 15000, () => createQueryEmbedding(query));
          check();
          if (!embedding) { publicError = "이미지 검색을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요."; throw new Error(publicError); }
          const result = await runSearchTask(signal, 30000, () => searchMediaForLuna(admin, embedding, query, { asked: parseAskedWhat(query) }));
          cards = result.cards;
        } else {
          const rows = await runSearchTask(signal, 30000, () => exploreWorkserverFallback(admin, query, query));
          cards = rows.map(row => {
            const title = row.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || row.path;
            const type = (row.type ?? "").toLowerCase();
            return { type: "nas", title, url: null, thumbnail: null, description: row.file_summary || row.path,
              drive: row.drive || undefined, raw_path: row.path,
              is_file: type === "file" || (!/^(folder|directory|dir)$/.test(type) && /\.[a-z0-9]{1,8}$/i.test(title)) };
          });
        }
        check();
        const durationMs = Date.now() - startedAt;
        const content = cards.length
          ? mode === "images" ? `관련 이미지 ${cards.length}개를 찾았습니다.` : `관련 파일·폴더 ${cards.length}개를 찾았습니다. Work 또는 Rai를 눌러 폴더 경로를 복사하세요.`
          : mode === "images" ? "조건에 맞는 이미지를 찾지 못했습니다. 프로젝트명이나 장면 설명을 바꿔 검색해 주세요." : "조건에 맞는 파일·폴더를 찾지 못했습니다. 파일명이나 프로젝트명으로 다시 검색해 주세요.";
        const steps = [{ key, status: "done", label: "검색 완료", ms: durationMs }];
        const metadata = { search_mode: mode, cards, steps, duration_ms: durationMs, notion_sources: [], wiki_sources: [], search_rounds: 1 };
        const saved = await persist([
          {id: userId, conversation_id: conversationId, role: "user", content: message, engine: null, metadata: {search_mode: mode}, created_at: new Date(startedAt).toISOString()},
          {id: assistantId, conversation_id: conversationId, role: "assistant", content, engine: null, metadata, created_at: new Date().toISOString()}
        ]);
        if (saved.error) { publicError = "검색 결과를 저장하지 못했습니다. 다시 시도해 주세요."; throw new Error(publicError); }
        check();
        if (!evaluation) await admin.from("luna_conversations").update({updated_at: new Date().toISOString()}).eq("id", conversationId);
        event({ type: "step", ...steps[0] });
        event({ type: "meta", ...metadata });
        check();
        controller.enqueue(encoder.encode(content));
        controller.close();
      } catch (error) {
        if (cancelled || signal.aborted) { try { controller.close(); } catch {} return; }
        // Preserve the wire protocol even when retrieval fails before meta.
        event({type: "meta", cards: [], steps: [{key: "error", status: "done", label: "검색 실패"}]});
        controller.enqueue(encoder.encode(publicError));
        controller.close();
      }
    }
  });
  return new Response(stream, {headers: {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}});
}
