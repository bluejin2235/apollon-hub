import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "@/lib/luna/constants";
import {
  KEYWORD_EXTRACT_FALLBACK,
  REQUERY_FALLBACK,
  SELF_EVAL_FALLBACK
} from "@/lib/luna/prompt-fallbacks";
import {
  bumpUsageDaily,
  readUsage,
  type LunaUsageTokens
} from "@/lib/luna/engine";
import { capNotionDisplaySources, formatNotionSourcesForPrompt, type NotionSource } from "@/lib/luna/notion";
import { searchNotionForLuna } from "@/lib/luna/notion-index-search";
import { createQueryEmbedding } from "@/lib/luna/embedding";
import {
  orderCardsWithImagePriority,
  searchMediaForLuna
} from "@/lib/luna/media-index-search";
import { takeTopNotionSourcesForLlm } from "@/lib/luna/source-pack";
import { scheduleConversationTitle } from "@/lib/luna/conversation-title";
import { getPrompts } from "@/lib/luna/prompts";
import { searchTavily, type LunaCard } from "@/lib/luna/tavily";
import { searchYoutube } from "@/lib/luna/youtube";

const SUPERVISOR_FALLBACK =
  "여러 팀의 관점별 분석을 읽고, 공통점·차이·우선 판단을 정리한 통합 리포트를 작성하세요. 마크다운으로 본론 중심으로 쓰세요.";

const SEARCH_REQUEST_KEYWORDS = ["찾아줘", "레퍼런스", "사례", "검색", "알려줘"] as const;
const SEARCH_BUDGET_MS = 45_000;
const MAX_SEARCH_ROUNDS = 3;
const ANALYSIS_TIMEOUT_MS = 180_000;
const MAX_TEAMS = 5;

type NasDirectoryRow = {
  drive: string | null;
  path: string;
  type: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  file_summary: string | null;
};

type AttachmentRow = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
};

type StepStatus = "running" | "done" | "skip";
type StepRecord = { key: string; label: string; status: StepStatus };
type ModelStep = {
  label: string;
  model: string;
  tier: string;
  tokens?: { input: number; output: number };
};

export type AnalysisTeamResult = {
  id: string;
  title: string;
  content: string;
  kind: "perspective" | "role";
};

type SkillRow = {
  id: string;
  title: string;
  content: string;
  sort_order: number;
  is_active: boolean;
  kind: string;
};

type BranchRow = SkillRow & { branchKind: "perspective" | "role" };

function isSearchRequestMessage(message: string): boolean {
  return SEARCH_REQUEST_KEYWORDS.some((kw) => message.includes(kw));
}

function pathLastSegment(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function isNasFileRow(row: NasDirectoryRow): boolean {
  const t = (row.type ?? "").toLowerCase();
  if (t === "file") return true;
  if (t === "folder" || t === "directory" || t === "dir") return false;
  return /\.[a-z0-9]{1,8}$/i.test(pathLastSegment(row.path));
}

function toNasCard(row: NasDirectoryRow): LunaCard {
  const title = pathLastSegment(row.path);
  const summary = row.file_summary?.trim();
  return {
    type: "nas",
    title,
    url: null,
    thumbnail: null,
    description: summary ? `${row.path} · ${summary}` : row.path,
    drive: row.drive?.trim() || undefined,
    raw_path: row.path,
    is_file: isNasFileRow(row)
  };
}

function cardDedupeKey(card: LunaCard): string {
  if (card.url) return `url:${card.url}`;
  if (card.type === "nas" || card.type === "image") {
    if (card.raw_path) return `${card.type}:${card.raw_path}`;
    const pathPart = card.description?.split(" · ")[0] || card.title;
    return `${card.type}:${pathPart}`;
  }
  return `${card.type}:${card.title}`;
}

function mergeCards(existing: LunaCard[], incoming: LunaCard[]): LunaCard[] {
  const map = new Map<string, LunaCard>();
  for (const c of existing) map.set(cardDedupeKey(c), c);
  for (const c of incoming) map.set(cardDedupeKey(c), c);
  return Array.from(map.values());
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(trimmed.slice(start, end + 1));
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushModelStep(
  modelSteps: ModelStep[],
  admin: SupabaseClient,
  opts: {
    label: string;
    model: string;
    tier: string;
    model_id: string;
    usage?: LunaUsageTokens;
  }
) {
  const step: ModelStep = {
    label: opts.label,
    model: opts.model,
    tier: opts.tier
  };
  if (opts.usage) {
    step.tokens = {
      input: opts.usage.input_tokens,
      output: opts.usage.output_tokens
    };
    bumpUsageDaily(admin, {
      tier: opts.tier,
      model_id: opts.model_id,
      usage: opts.usage
    });
  }
  modelSteps.push(step);
}

function formatMaterialsList(cards: LunaCard[], notionSources: NotionSource[]): string {
  const lines: string[] = [];
  const topNotion = takeTopNotionSourcesForLlm(notionSources);
  if (topNotion.length > 0) {
    lines.push(formatNotionSourcesForPrompt(topNotion));
  }
  for (const c of cards.slice(0, 3)) {
    if (c.type === "notion") continue;
    lines.push(
      c.url
        ? `- [${c.type}] ${c.title}: ${c.url}`
        : `- [${c.type}] ${c.title}: ${c.description}`
    );
  }
  return lines.length > 0 ? lines.join("\n") : "(자료 없음)";
}

export type RunAnalysisParams = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  client: Anthropic;
  admin: SupabaseClient;
  startedAt: number;
  conversationId: string;
  userId: string;
  userText: string;
  usedEngine: string;
  identity: string;
  keywordExtractPrompt: string;
  selfEvalPrompt: string;
  requeryPrompt: string;
  tierA: { model_id: string; model_label: string };
  tierB: { model_id: string; model_label: string };
  perspectiveIds: string[];
  roleIds: string[];
  taskIds: string[];
  notionEnabled: boolean;
  webEnabled: boolean;
  nasEnabled: boolean;
  hasAttachments: boolean;
  attachments: AttachmentRow[];
  attachmentMeta: { id: string; file_name: string; mime_type: string }[];
  userMessageId?: string;
  assistantMessageId?: string;
};

export async function runAnalysisPipeline(params: RunAnalysisParams): Promise<void> {
  const {
    controller,
    encoder,
    client,
    admin,
    startedAt,
    conversationId,
    userId,
    userText,
    usedEngine,
    identity,
    keywordExtractPrompt,
    selfEvalPrompt,
    requeryPrompt,
    tierA,
    tierB,
    perspectiveIds,
    roleIds,
    taskIds,
    notionEnabled,
    webEnabled,
    nasEnabled,
    hasAttachments,
    attachments,
    attachmentMeta,
    userMessageId,
    assistantMessageId
  } = params;

  const emit = (event: Record<string, unknown>) => {
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
  };

  const steps: StepRecord[] = [];
  const modelSteps: ModelStep[] = [];
  let searchRounds = 0;

  const pushStep = (key: string, status: StepStatus, label: string) => {
    const idx = steps.findIndex((s) => s.key === key);
    const rec = { key, status, label };
    if (idx >= 0) steps[idx] = rec;
    else steps.push(rec);
    emit({ type: "step", key, status, label });
  };

  const touchConversation = async () => {
    const { error: updateError } = await admin
      .from("luna_conversations")
      .update({
        updated_at: new Date().toISOString(),
        engine: usedEngine
      })
      .eq("id", conversationId)
      .eq("user_id", userId);
    if (updateError) {
      console.error("[luna/analysis] update conversation", updateError);
    }
  };

  const { data: skillData, error: skillError } = await admin
    .from("luna_prompts")
    .select("id, title, kind, content, is_active, sort_order")
    .in("id", Array.from(new Set([...perspectiveIds, ...roleIds, ...taskIds])))
    .eq("level", "L2");

  if (skillError) {
    throw new Error(skillError.message);
  }

  const rows = (skillData ?? []) as SkillRow[];
  const byId = new Map(rows.filter((r) => r.is_active).map((r) => [r.id, r]));

  const perspectiveRows = perspectiveIds
    .map((id) => byId.get(id))
    .filter(
      (r): r is SkillRow =>
        Boolean(r) && r!.kind === "perspective" && Boolean(r!.content)
    )
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const roleRows = roleIds
    .map((id) => byId.get(id))
    .filter(
      (r): r is SkillRow =>
        Boolean(r) && r!.kind === "role" && Boolean(r!.content)
    )
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  // 관점 우선, 남는 자리를 역할로. 최대 5개
  const branches: BranchRow[] = [];
  for (const p of perspectiveRows) {
    if (branches.length >= MAX_TEAMS) break;
    branches.push({ ...p, branchKind: "perspective" });
  }
  for (const r of roleRows) {
    if (branches.length >= MAX_TEAMS) break;
    branches.push({ ...r, branchKind: "role" });
  }

  if (branches.length < 2) {
    throw new Error("분석 모드에는 활성 관점·역할이 합쳐 2개 이상 필요합니다.");
  }

  const taskContents = taskIds
    .map((id) => byId.get(id))
    .filter((r): r is SkillRow => Boolean(r) && r!.kind === "task")
    .map((r) => `[작업 · ${r.title}]\n${r.content.trim()}`)
    .filter(Boolean);

  const loaded = await getPrompts(admin, ["analysis.supervisor"]);
  const supervisorPrompt =
    loaded["analysis.supervisor"]?.trim() || SUPERVISOR_FALLBACK;

  let notionSources: NotionSource[] = [];
  let cards: LunaCard[] = [];
  let nasResults: NasDirectoryRow[] = [];
  let materialsText = "";

  // ——— 단계 1: 자료 수집 ———
  pushStep("collect", "running", "자료 수집 중");

  if (hasAttachments) {
    materialsText = attachments
      .map((a) => `- [첨부] ${a.file_name} (${a.mime_type})`)
      .join("\n");
    pushStep(
      "collect",
      "done",
      `첨부 ${attachments.length}건 정리`
    );
  } else {
    const isSearchRequest = isSearchRequestMessage(userText);
    const anySearch =
      notionEnabled || webEnabled || nasEnabled || isSearchRequest;

    const runConnectorSearch = async (kw: string) => {
      const [notionRes, webRes, youtubeRes, nasRes, mediaRes] =
        await Promise.all([
        notionEnabled && kw
          ? searchNotionForLuna(admin, kw, userText).then((o) => o.sources)
          : Promise.resolve([] as NotionSource[]),
        webEnabled
          ? searchTavily(kw || userText)
          : Promise.resolve([] as LunaCard[]),
        isSearchRequest && kw
          ? searchYoutube(kw)
          : Promise.resolve([] as LunaCard[]),
        (async () => {
          if (!nasEnabled || !kw) return [] as NasDirectoryRow[];
          const terms = kw
            .split(/\s+/)
            .filter((t) => t.length > 1)
            .slice(0, 3);
          if (terms.length === 0) return [];
          const orFilter = terms.map((t) => `path.ilike.%${t}%`).join(",");
          const { data: nasData, error: nasError } = await admin
            .from("nas_directory")
            .select("drive, path, type, size_bytes, modified_at, file_summary")
            .or(orFilter)
            .limit(6);
          if (nasError) {
            console.error("[luna/analysis] nas_directory", nasError);
            return [];
          }
          return (nasData ?? []) as NasDirectoryRow[];
        })(),
        (async () => {
          const emb = await createQueryEmbedding(kw || userText);
          return searchMediaForLuna(admin, emb, userText).then((r) => r.cards);
        })()
      ]);

      const notionCards: LunaCard[] = notionRes.map((s) => ({
        type: "notion" as const,
        title: s.title,
        url: s.url,
        thumbnail: null,
        description: ""
      }));
      const nasCards = nasRes.map(toNasCard);
      return {
        notionSources: notionRes,
        nasResults: nasRes,
        cards: orderCardsWithImagePriority(
          [...notionCards, ...nasCards, ...mediaRes, ...webRes, ...youtubeRes],
          userText
        ),
        counts: {
          notion: notionRes.length,
          nas: nasRes.length,
          web: webRes.length,
          image: mediaRes.length
        }
      };
    };

    if (anySearch) {
      let keywords = "";
      const previousKeywords: string[] = [];

      try {
        const kwRes = await client.messages.create({
          model: tierB.model_id,
          max_tokens: 64,
          system: keywordExtractPrompt || KEYWORD_EXTRACT_FALLBACK,
          messages: [{ role: "user", content: userText || "문서" }]
        });
        pushModelStep(modelSteps, admin, {
          label: "검색어 추출",
          model: tierB.model_label,
          tier: "B",
          model_id: tierB.model_id,
          usage: readUsage(kwRes.usage)
        });
        const kwText =
          kwRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
        keywords =
          kwText.replace(/^["']|["']$/g, "").trim() || userText.slice(0, 80);
      } catch (err) {
        console.error("[luna/analysis] keyword extract", err);
        keywords = userText.slice(0, 80);
      }

      previousKeywords.push(keywords);
      searchRounds = 1;
      let batch = await runConnectorSearch(keywords);
      notionSources = batch.notionSources;
      nasResults = batch.nasResults;
      cards = batch.cards;

      let sufficient = true;
      let missing = "";
      for (let round = 1; round <= MAX_SEARCH_ROUNDS; round += 1) {
        if (Date.now() - startedAt > SEARCH_BUDGET_MS) break;

        try {
          const titles = cards.map((c) => c.title).filter(Boolean).slice(0, 40);
          const evalRes = await client.messages.create({
            model: tierB.model_id,
            max_tokens: 256,
            system: selfEvalPrompt || SELF_EVAL_FALLBACK,
            messages: [
              {
                role: "user",
                content: `질문:\n${userText}\n\n찾은 자료 제목:\n${
                  titles.length > 0
                    ? titles.map((t) => `- ${t}`).join("\n")
                    : "(없음)"
                }`
              }
            ]
          });
          pushModelStep(modelSteps, admin, {
            label: "자체 평가",
            model: tierB.model_label,
            tier: "B",
            model_id: tierB.model_id,
            usage: readUsage(evalRes.usage)
          });
          const evalRaw =
            evalRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
          const evalParsed = parseJsonObject(evalRaw);
          sufficient = evalParsed?.sufficient !== false;
          missing =
            typeof evalParsed?.missing === "string"
              ? evalParsed.missing.trim()
              : "";
        } catch (err) {
          console.error("[luna/analysis] self_eval", err);
          sufficient = true;
        }

        if (sufficient) break;
        if (round >= MAX_SEARCH_ROUNDS) break;
        if (Date.now() - startedAt > SEARCH_BUDGET_MS) break;

        let newKeywords = "";
        try {
          const reqRes = await client.messages.create({
            model: tierB.model_id,
            max_tokens: 64,
            system: requeryPrompt || REQUERY_FALLBACK,
            messages: [
              {
                role: "user",
                content: `원 질문:\n${userText}\n\n이전 검색어:\n${previousKeywords.join(
                  ", "
                )}\n\n부족한 점:\n${missing || "관련 자료가 부족함"}`
              }
            ]
          });
          pushModelStep(modelSteps, admin, {
            label: "재검색어 생성",
            model: tierB.model_label,
            tier: "B",
            model_id: tierB.model_id,
            usage: readUsage(reqRes.usage)
          });
          const reqText =
            reqRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
          newKeywords = reqText.replace(/^["']|["']$/g, "").trim();
        } catch (err) {
          console.error("[luna/analysis] requery", err);
          break;
        }

        if (
          !newKeywords ||
          previousKeywords.some(
            (k) => k.toLowerCase() === newKeywords.toLowerCase()
          )
        ) {
          break;
        }

        previousKeywords.push(newKeywords);
        keywords = newKeywords;
        searchRounds += 1;
        batch = await runConnectorSearch(keywords);
        notionSources = capNotionDisplaySources([
          ...notionSources,
          ...batch.notionSources
        ]);
        nasResults = [
          ...nasResults,
          ...batch.nasResults.filter(
            (r) => !nasResults.some((x) => x.path === r.path)
          )
        ];
        cards = mergeCards(cards, batch.cards);
      }
    }

    materialsText = formatMaterialsList(cards, notionSources);
    if (nasResults.length > 0) {
      const nasBlock = nasResults
        .map((row) => {
          const name = pathLastSegment(row.path);
          return `- ${name} → T:\\${row.path.replace(/\//g, "\\")}`;
        })
        .join("\n");
      const notionHasPath = notionSources.some((s) => (s.paths?.length ?? 0) > 0);
      materialsText +=
        `\n[Work서버]\n` +
        (notionHasPath
          ? "(노션에 기록된 경로가 있으면 그것을 우선한다)\n"
          : "") +
        nasBlock;
    }

    const materialCount = cards.length || notionSources.length;
    pushStep("collect", "done", `자료 ${materialCount}건 정리`);
  }

  // ——— 단계 2: 팀별 병렬 분석 ———
  let attachmentBlocks: Anthropic.ContentBlockParam[] | null = null;
  if (hasAttachments) {
    attachmentBlocks = [];
    for (const att of attachments) {
      const { data: fileData, error: downloadError } = await admin.storage
        .from("luna-files")
        .download(att.storage_path);
      if (downloadError || !fileData) {
        console.error("[luna/analysis] download", att.id, downloadError);
        continue;
      }
      const bytes = Buffer.from(await fileData.arrayBuffer());
      const base64 = bytes.toString("base64");
      if (att.mime_type === "application/pdf") {
        attachmentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64
          }
        } as Anthropic.ContentBlockParam);
      } else {
        attachmentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: att.mime_type as
              | "image/png"
              | "image/jpeg"
              | "image/gif"
              | "image/webp",
            data: base64
          }
        });
      }
    }
  }

  const teamResults: AnalysisTeamResult[] = branches.map((p) => ({
    id: p.id,
    title: p.title,
    content: "",
    kind: p.branchKind
  }));
  const teamDone = branches.map(() => false);
  let analysisTimedOut = false;
  const deadline = startedAt + ANALYSIS_TIMEOUT_MS;

  const analyzeTeam = async (index: number) => {
    const p = branches[index]!;
    emit({
      type: "team",
      id: p.id,
      title: p.title,
      kind: p.branchKind,
      status: "running"
    });

    if (analysisTimedOut || Date.now() > deadline) {
      teamResults[index] = {
        id: p.id,
        title: p.title,
        content: "분석 실패",
        kind: p.branchKind
      };
      teamDone[index] = true;
      emit({
        type: "team",
        id: p.id,
        title: p.title,
        kind: p.branchKind,
        status: "done",
        content: "분석 실패"
      });
      return;
    }

    const labelPrefix = p.branchKind === "role" ? "역할" : "관점";
    const skillBlock = `[${labelPrefix} · ${p.title}]\n${p.content.trim()}`;
    const taskBlock =
      taskContents.length > 0 ? `\n\n${taskContents.join("\n\n")}` : "";
    const systemPrompt = [
      identity.trim() || LUNA_DEFAULT_IDENTITY_PROMPT,
      skillBlock,
      taskBlock,
      `[수집된 자료]\n${materialsText}`,
      `당신은 ${p.title} ${labelPrefix}으로만 분석합니다. 다른 팀 관점·역할을 대신 말하지 마세요.\n이 ${labelPrefix}에서 가장 중요한 판단 두세 가지를 근거와 함께 쓰세요.\n서론과 맺음말 없이 본론만 쓰세요. 400자 이내.`
    ]
      .filter(Boolean)
      .join("\n\n");

    const userContent: string | Anthropic.ContentBlockParam[] =
      attachmentBlocks && attachmentBlocks.length > 0
        ? [...attachmentBlocks, { type: "text", text: userText }]
        : userText;

    try {
      const res = await client.messages.create({
        model: tierA.model_id,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }]
      });

      if (analysisTimedOut) return;

      const text =
        res.content.find((part) => part.type === "text")?.text?.trim() ||
        "분석 실패";
      teamResults[index] = {
        id: p.id,
        title: p.title,
        content: text,
        kind: p.branchKind
      };
      teamDone[index] = true;
      pushModelStep(modelSteps, admin, {
        label: `${p.title} 분석`,
        model: tierA.model_label,
        tier: "A",
        model_id: tierA.model_id,
        usage: readUsage(res.usage)
      });
      emit({
        type: "team",
        id: p.id,
        title: p.title,
        kind: p.branchKind,
        status: "done",
        content: text
      });
    } catch (err) {
      console.error("[luna/analysis] team", p.title, err);
      if (analysisTimedOut) return;
      teamResults[index] = {
        id: p.id,
        title: p.title,
        content: "분석 실패",
        kind: p.branchKind
      };
      teamDone[index] = true;
      pushModelStep(modelSteps, admin, {
        label: `${p.title} 분석`,
        model: tierA.model_label,
        tier: "A",
        model_id: tierA.model_id
      });
      emit({
        type: "team",
        id: p.id,
        title: p.title,
        kind: p.branchKind,
        status: "done",
        content: "분석 실패"
      });
    }
  };

  await Promise.race([
    Promise.all(branches.map((_, i) => analyzeTeam(i))),
    sleep(Math.max(0, deadline - Date.now())).then(() => {
      analysisTimedOut = true;
    })
  ]);

  for (let i = 0; i < teamResults.length; i += 1) {
    if (!teamDone[i]) {
      const p = branches[i]!;
      teamResults[i] = {
        id: p.id,
        title: p.title,
        content: "분석 실패",
        kind: p.branchKind
      };
      teamDone[i] = true;
      emit({
        type: "team",
        id: p.id,
        title: p.title,
        kind: p.branchKind,
        status: "done",
        content: "분석 실패"
      });
    }
  }

  const teamsForSupervisor = teamResults.filter(
    (t) => t.content && t.content !== "분석 실패"
  );
  const teamsForMeta = teamResults.map((t) => ({
    id: t.id,
    title: t.title,
    content: t.content || "분석 실패",
    kind: t.kind
  }));

  // ——— 단계 3: 슈퍼바이저 통합 ———
  pushStep("supervise", "running", "슈퍼바이저 통합 중");

  const supervisorSystem = [
    identity.trim() || LUNA_DEFAULT_IDENTITY_PROMPT,
    supervisorPrompt
  ].join("\n\n");

  const teamBlock =
    teamsForSupervisor.length > 0
      ? teamsForSupervisor
          .map((t) => `### ${t.title}\n${t.content}`)
          .join("\n\n")
      : "(완료된 팀 분석 없음)";

  const supervisorUser = `원 질문:\n${userText}\n\n팀별 분석 결과:\n\n${teamBlock}`;

  emit({
    type: "meta",
    cards,
    notion_sources: notionSources,
    mode: "analysis",
    teams: teamsForMeta
  });

  let assistantText = "";
  const anthropicStream = client.messages.stream({
    model: tierA.model_id,
    max_tokens: 4096,
    system: supervisorSystem,
    messages: [{ role: "user", content: supervisorUser }]
  });

  anthropicStream.on("text", (textDelta) => {
    assistantText += textDelta;
    controller.enqueue(encoder.encode(textDelta));
  });

  const finalMsg = await anthropicStream.finalMessage();
  const answerUsage = readUsage(finalMsg.usage);
  pushModelStep(modelSteps, admin, {
    label: "슈퍼바이저 통합",
    model: tierA.model_label,
    tier: "A",
    model_id: tierA.model_id,
    usage: answerUsage
  });
  if (searchRounds > 0) {
    modelSteps.push({
      label: "검색 횟수",
      model: `${searchRounds}회`,
      tier: ""
    });
  }

  pushStep("supervise", "done", "슈퍼바이저 통합");

  const durationMs = Date.now() - startedAt;
  const userMeta: Record<string, unknown> = {
    skills: {
      perspective_ids: perspectiveIds,
      role_ids: roleIds,
      task_ids: taskIds
    }
  };
  const assistantMeta: Record<string, unknown> = {
    mode: "analysis",
    teams: teamsForMeta,
    model_label: tierA.model_label,
    duration_ms: durationMs,
    model_steps: modelSteps,
    steps,
    search_rounds: searchRounds,
    usage: {
      input_tokens: answerUsage.input_tokens,
      output_tokens: answerUsage.output_tokens,
      cache_creation_input_tokens: answerUsage.cache_creation_input_tokens,
      cache_read_input_tokens: answerUsage.cache_read_input_tokens
    },
    skills: {
      perspective_ids: perspectiveIds,
      role_ids: roleIds,
      task_ids: taskIds
    }
  };
  if (notionSources.length > 0) {
    assistantMeta.notion_sources = notionSources;
  }
  if (cards.length > 0) {
    assistantMeta.cards = cards;
  }
  if (attachmentMeta.length > 0) {
    userMeta.attachments = attachmentMeta;
    assistantMeta.attachments = attachmentMeta;
  }

  const insertNow = Date.now();
  const { error: insertError } = await admin.from("luna_messages").insert([
    {
      ...(userMessageId ? { id: userMessageId } : {}),
      conversation_id: conversationId,
      role: "user",
      content: userText,
      engine: usedEngine,
      metadata: userMeta,
      created_at: new Date(insertNow - 1000).toISOString()
    },
    {
      ...(assistantMessageId ? { id: assistantMessageId } : {}),
      conversation_id: conversationId,
      role: "assistant",
      content: assistantText,
      engine: usedEngine,
      metadata: assistantMeta,
      created_at: new Date(insertNow).toISOString()
    }
  ]);

  if (insertError) {
    console.error("[luna/analysis] insert messages", insertError);
  }

  await touchConversation();
  scheduleConversationTitle(admin, conversationId);
  controller.close();
}
