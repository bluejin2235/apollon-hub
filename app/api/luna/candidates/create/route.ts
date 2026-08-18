import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  createCandidate,
  makeTurn,
  normalizeThread,
  runDialogueTurn,
  understoodAsk,
  type CandidateSource,
  type ScopeSuggestion
} from "@/lib/luna/candidates";

export const runtime = "nodejs";

type CreateBody = {
  content?: string;
  evidence?: string | null;
  scope_suggestion?: string | null;
  category?: string;
  source?: string;
  author_id?: string | null;
  assigned_to?: string | null;
  source_conversation_id?: string | null;
  raw_input?: string | null;
  with_first_turn?: boolean;
};

function parseSource(raw: unknown): CandidateSource | null {
  if (
    raw === "chat" ||
    raw === "selfstudy" ||
    raw === "question" ||
    raw === "direct" ||
    raw === "interview"
  ) {
    return raw;
  }
  return null;
}

function parseScope(raw: unknown): ScopeSuggestion | null {
  if (raw === "org" || raw === "personal") return raw;
  return null;
}

/**
 * 내부용 후보 생성. chat reflect / learn.capture 경로에서 호출.
 * with_first_turn=true 이면 learn.dialogue 첫 턴을 thread 에 넣음.
 */
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const source = parseSource(body.source) ?? "chat";
  const scope = parseScope(body.scope_suggestion);
  const withFirstTurn = body.with_first_turn !== false;

  let thread = normalizeThread([]);
  if (withFirstTurn) {
    const lunaText = understoodAsk(
      (await runDialogueTurn(admin, {
        mode: "first",
        content,
        evidence: body.evidence
      })) || content
    );
    thread = [makeTurn("luna", lunaText)];
  }

  const created = await createCandidate(admin, {
    content,
    evidence: typeof body.evidence === "string" ? body.evidence : null,
    scope_suggestion: scope,
    category: typeof body.category === "string" ? body.category : "general",
    source,
    author_id:
      typeof body.author_id === "string" ? body.author_id : user.id,
    assigned_to:
      typeof body.assigned_to === "string" ? body.assigned_to : user.id,
    source_conversation_id:
      typeof body.source_conversation_id === "string"
        ? body.source_conversation_id
        : null,
    raw_input: typeof body.raw_input === "string" ? body.raw_input : null,
    thread
  });

  if (!created) {
    return NextResponse.json({ error: "Failed to create candidate" }, { status: 500 });
  }

  return NextResponse.json({
    id: created.id,
    content: created.content,
    thread: created.thread
  });
}
