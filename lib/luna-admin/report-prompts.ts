/**
 * 아침 리포트 「내가 해야 할 것」 — Claude 에 그대로 붙여넣을 프롬프트.
 *
 * 규칙으로만 만든다. LLM 을 부르지 않는다 —
 * 07:00 cron 에서 표 이름·cron 경로·수치가 하나라도 틀리면 Claude 가 엉뚱한 곳을 판다.
 * 항목 종류마다 문구를 따로 쓰고, 수치는 검사 결과에서, 단서는 개발노트 「막힌 것」에서 가져온다.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LunaCheckResult } from "@/lib/luna/checks";
import type { StudyRunReportCard } from "@/lib/luna/study-report";
import { iGa } from "@/lib/korean/particles";

export type PromptRoom = "dev" | "interview" | "website";

export const PROMPT_ROOM_LABEL: Record<PromptRoom, string> = {
  dev: "Apollon Hub 개발·운영",
  interview: "LUNA 지식 인터뷰",
  website: "홈페이지"
};

export type TodoPrompt = {
  room: PromptRoom;
  text: string;
};

export type DevnoteBlockerNote = {
  title: string;
  body: string;
  service: string;
};

/** 모바일에서 길게 눌러 한 번에 집을 수 있는 길이 */
const MAX_PROMPT_LINES = 8;
const MAX_CLUE_CHARS = 84;

export async function loadOpenDevnoteBlockers(
  admin: SupabaseClient
): Promise<DevnoteBlockerNote[]> {
  const [blockersRes, servicesRes] = await Promise.all([
    admin
      .from("devnote_blockers")
      .select("title, body, service_id, since")
      .is("resolved_at", null)
      .order("since", { ascending: false }),
    admin.from("devnote_services").select("id, name")
  ]);
  if (blockersRes.error) {
    console.error("[luna-admin/report-prompts] blockers", blockersRes.error);
    return [];
  }
  if (servicesRes.error) {
    console.error("[luna-admin/report-prompts] services", servicesRes.error);
  }
  const names = new Map<string, string>();
  for (const row of servicesRes.data ?? []) {
    if (typeof row.id === "string" && typeof row.name === "string") {
      names.set(row.id, row.name);
    }
  }
  return (blockersRes.data ?? []).map((row) => ({
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    service:
      (typeof row.service_id === "string" ? names.get(row.service_id) : null) ??
      "전체"
  }));
}

function compact(lines: (string | null | undefined)[]): string[] {
  return lines
    .map((l) => (typeof l === "string" ? l.trim() : ""))
    .filter((l) => l.length > 0);
}

/**
 * ask · 빈 줄 · 지금 상태 · 빈 줄 · 단서 · 마무리.
 * 예산을 넘으면 단서 → 상태 순으로 뒤에서 덜어내고, 첫 줄과 마무리 줄은 남긴다.
 */
function composePrompt(
  room: PromptRoom,
  ask: string,
  state: (string | null | undefined)[],
  clue: (string | null | undefined)[]
): TodoPrompt {
  const body = compact(state);
  // 개발노트 단서가 이미 상태 줄에 있는 수치를 되풀이하면 뺀다
  const hint = compact(clue).filter((line) => {
    const bare = line.replace(/[.。]\s*$/, "");
    return !body.some((b) => b.includes(bare));
  });
  const close = hint.pop() ?? null;
  const spare =
    MAX_PROMPT_LINES -
    1 -
    (body.length > 0 ? 1 : 0) -
    (hint.length > 0 || close ? 1 : 0) -
    (close ? 1 : 0);
  while (hint.length > 0 && body.length + hint.length > spare) hint.pop();
  while (body.length > 0 && body.length > spare - hint.length) body.pop();

  const lines = [ask];
  if (body.length > 0) lines.push("", ...body);
  if (hint.length > 0 || close) {
    lines.push("");
    lines.push(...hint);
    if (close) lines.push(close);
  }
  return { room, text: lines.join("\n") };
}

/** 검사 상세에서 약속·마지막 시각을 뺀 나머지 (수치·오류 문구) */
function checkExtra(check: LunaCheckResult): string | null {
  const detail = (check.detail ?? "").trim();
  if (!detail) return null;
  const marker = `마지막 ${check.last_label}`;
  const at = detail.indexOf(marker);
  if (at >= 0) {
    const tail = detail.slice(at + marker.length).replace(/^\s*·\s*/, "").trim();
    return tail || null;
  }
  if (check.promise_label && detail.startsWith(check.promise_label)) {
    const tail = detail
      .slice(check.promise_label.length)
      .replace(/^\s*·\s*/, "")
      .trim();
    return tail || null;
  }
  return detail;
}

function idlePhrase(check: LunaCheckResult): string {
  return check.days_stale == null
    ? "언제 돌았는지 기록이 없어"
    : `${check.days_stale}일째 멈췄어`;
}

function firstSentence(body: string): string | null {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const cut = text.search(/[.!?。]\s/);
  const head = cut > 0 ? text.slice(0, cut + 1) : text;
  return head.length > MAX_CLUE_CHARS
    ? `${head.slice(0, MAX_CLUE_CHARS - 1)}…`
    : head;
}

/** 검사 id → 개발노트 「막힌 것」을 찾을 낱말 */
const CHECK_BLOCKER_KEYS: Record<string, string[]> = {
  model_market: ["모델 시세", "공급사"],
  work_index: ["NAS", "재시도", "파일 본문"],
  work_text: ["파일 본문", "본문을 안 읽"],
  notion_index: ["노션"],
  image_index: ["전체 색인", "psd"],
  links: ["전환된 프로젝트", "follows"],
  selfstudy: ["자습", "모드 A"],
  signals: ["미해결 실패"],
  eval_light: ["모드 A", "채점"],
  consolidate: ["지식후보"],
  response_time: ["응답 시간"],
  llm_failures: ["실패", "공급사"]
};

function matchBlocker(
  keys: string[],
  blockers: DevnoteBlockerNote[]
): DevnoteBlockerNote | null {
  for (const key of keys) {
    const hit = blockers.find((b) => `${b.title} ${b.body}`.includes(key));
    if (hit) return hit;
  }
  return null;
}

function blockerLines(blocker: DevnoteBlockerNote | null): string[] {
  if (!blocker || !blocker.title) return [];
  const head = `개발노트 ${blocker.service} 막힌 것에 「${blocker.title}」${iGa(blocker.title)} 있어.`;
  const gist = firstSentence(blocker.body);
  return gist ? [head, gist] : [head];
}

type CheckPromptSpec = {
  ask: string;
  state: (string | null)[];
  clue: (string | null)[];
};

function checkSpec(
  check: LunaCheckResult,
  idle: string,
  last: string,
  extra: string | null
): CheckPromptSpec {
  switch (check.id) {
    case "fx_rates":
      return {
        ask: `환율 수집이 ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `fx_daily_rates 마지막 created_at 이 ${last} 야${extra ? ` · ${extra}` : ""}.`,
          "cron 은 /api/cron/fx-rates 15 0 * * * (KST 09:15) 로 걸려 있어."
        ],
        clue: [
          "판정은 수집 시각(created_at)이다. date(환율 영업일)로 보지 마. 리포트는 07:00 이라 어제 09:15 수집이면 정상이야.",
          "호출이 아예 안 온 건지, 돌았는데 행이 안 쌓인 건지부터 갈라 줘."
        ]
      };
    case "model_market":
      return {
        ask: `모델 시세 수집이 ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `luna_model_market 마지막 fetched_at 이 ${last} 야.`,
          extra ? `마지막 오류 — ${extra}` : null,
          "/api/cron/luna-model-inspect 가 */10 으로 돌면서 주 1회 창에서만 실제로 수집해."
        ],
        clue: [
          "luna_settings.model_cost_settings.last_market_error 를 먼저 읽고, 공급사 키 이름이 바뀐 건 아닌지 같이 봐줘."
        ]
      };
    case "work_index":
      return {
        ask: `Work서버 색인이 ${idle}. 왜 안 도는지 봐줘.`,
        state: [
          `nas_scan_settings.last_run_at 이 ${last} 야.`,
          "Vercel cron 이 아니라 사무실 PC 작업 스케줄러 「LUNA NAS Scan」(매일 03:00)이 돌려."
        ],
        clue: [
          "PC 가 꺼져 있던 건지 스캐너가 API 를 못 부른 건지 갈라 주고, 내가 직접 눌러야 하는 거면 그렇게 알려줘."
        ]
      };
    case "work_text":
      return {
        ask: `Work 본문 추출이 ${idle}. 왜 안 도는지 봐줘.`,
        state: [
          `nas_text_runs 마지막 실행이 ${last} 야${extra ? ` · ${extra}` : ""}.`,
          "사무실 PC 작업 스케줄러 「LUNA Work Text Extract」(매일 03:10)가 돌려."
        ],
        clue: [
          "남은 문서가 없어서 끝난 건지 스케줄러가 안 돈 건지 갈라 줘."
        ]
      };
    case "notion_index":
      return {
        ask: `노션 색인이 ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `luna_notion_index_runs 마지막 finished_at 이 ${last} 야.`,
          "/api/cron/notion-index 가 */10 으로 돌고 03:20·13:30 슬롯에서만 실제 색인해."
        ],
        clue: [
          "슬롯 판정(notion_index_schedule)이 틀어진 건지 큐가 비어 바로 끝난 건지 갈라 줘."
        ]
      };
    case "image_index":
      return {
        ask: `이미지 색인이 ${idle}. 왜 안 도는지 봐줘.`,
        state: [
          `luna_media_index_runs 마지막 실행 ${last} · ${extra ?? "진행률 확인 필요"}.`,
          "사무실 PC 작업 스케줄러 「LUNA Media Index」(매일 01:00)가 돌려. Vercel cron 이 아니야."
        ],
        clue: [
          "luna_media_index_runs 마지막 행이 interrupted 인지 보고, 내가 PC 를 봐야 하면 알려줘."
        ]
      };
    case "links":
      return {
        ask: `2차 데이터 만들기가 ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `luna_settings.luna_links_last_cron 이 ${last} 야.`,
          "cron 은 /api/cron/luna-links 30 19 * * * (KST 04:30)."
        ],
        clue: [
          "링크가 0건이어도 크론이 돌았으면 정상이다. 호출 자체가 안 온 건지부터 갈라 줘."
        ]
      };
    case "selfstudy":
      return {
        ask: `자습이 ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `luna_study_runs 마지막 started_at 이 ${last} 야.`,
          "cron 은 /api/cron/luna-selfstudy 0 20 * * * (KST 05:00)."
        ],
        clue: [
          "아젠다를 못 고른 건지 돌다가 죽은 건지, 마지막 행 status·result 로 갈라 줘."
        ]
      };
    case "signals":
      return {
        ask: `신호 분석이 ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `luna_settings.luna_signals_last_cron 이 ${last} 야.`,
          "cron 은 /api/cron/luna-signals 30 20 * * * (KST 05:30)."
        ],
        clue: [
          "05:30 잡은 신호를 새로 넣는 게 아니라 규칙 후보를 만든다. 마지막 luna_signals 행으로 판단하지 마."
        ]
      };
    case "admin_report":
      return {
        ask: `아침 메일이 ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `luna_settings.luna_admin_report_last.sent_at 이 ${last} 야.`,
          "cron 은 /api/cron/luna-admin-report 0 22 * * * (KST 07:00)."
        ],
        clue: [
          "Resend 발송 실패인지 cron 미호출인지 갈라 주고, 실패가 조용히 넘어가는 경로면 그것도 같이 고쳐줘."
        ]
      };
    case "eval_light":
      return {
        ask: `매일 점검이 ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `luna_eval_runs tier=light 마지막 done 이 ${last} 야.`,
          extra,
          "/api/cron/luna-eval 가 */10 으로 돌고 03:40 창에서만 시작해."
        ],
        clue: [
          "중간 상태로 남는 행을 만드는 경로가 있는지 보고, 있으면 다시 시작하는 것까지 붙여줘."
        ]
      };
    case "consolidate":
      return {
        ask: `후보 정리가 ${idle}. 조건이 맞는지 봐줘.`,
        state: [
          `luna_consolidation_runs 마지막 done 이 ${last} 야.`,
          extra,
          "/api/cron/luna-consolidate 30 18 * * * (KST 03:30)가 매일 확인하고 「14일 또는 신규 30건」일 때만 실제로 돌아."
        ],
        clue: [
          "조건 계산이 맞는지 확인하고, 기준을 낮춰야 하면 얼마로 할지 근거와 같이 알려줘."
        ]
      };
    case "disk":
      return {
        ask: "DB 디스크가 약속(70% 미만)을 넘었어. 무엇을 줄이면 되는지 찾아줘.",
        state: [
          extra,
          "매일 쌓이기만 하는 표(luna_response_timings · luna_signals · luna_study_runs)부터 크기를 재 줘."
        ],
        clue: [
          "보관 기간을 정해 지우는 쪽인지 한도(LUNA_DB_DISK_LIMIT_GB)를 올리는 쪽인지 판단해서 알려줘."
        ]
      };
    case "response_time":
      return {
        ask: "루나 응답이 약속보다 느려. 어디가 느린지 찾아서 줄여줘.",
        state: [extra, "기준은 luna_response_timings 7일 평균이야."],
        clue: ["검색·연결·LLM 중 무엇이 늘었는지 갈라서 보여줘."]
      };
    case "llm_failures":
      return {
        ask: "LLM 호출 실패가 약속(하루 5회 미만)을 넘었어. 어느 호출이 깨졌는지 찾아서 고쳐줘.",
        state: [extra, "luna_llm_failures 를 model_id 와 단계로 묶어서 봐줘."],
        clue: [
          "등급 공급사를 바꾼 뒤 한쪽 클라이언트만 부르는 코드가 남아 조용히 실패한 적이 있어. 같은 종류부터 봐줘."
        ]
      };
    case "env_keys":
      return {
        ask: "배포 환경변수 이름이 어긋났어. 맞춰줘.",
        state: [
          extra,
          "lib/luna/env-keys.ts 의 별칭 목록과 Vercel 환경변수를 맞춰 줘."
        ],
        clue: [
          "이름이 어긋나면 작업이 조용히 옛 데이터로 넘어가니, 그 사이 잘못 쓴 곳이 있는지도 같이 봐줘."
        ]
      };
    default:
      return {
        ask: `${check.label}${iGa(check.label)} ${idle}. 원인 찾아서 고쳐줘.`,
        state: [
          `약속 — ${check.promise_label}`,
          `마지막 ${last}`,
          extra
        ],
        clue: [check.meaning_when_stale, "어디서 끊겼는지 찾아서 알려줘."]
      };
  }
}

/** 약속 점검에서 어긋난 항목 — 원인 조사·코드 수정·DB 확인은 Claude 몫 */
export function buildCheckPrompt(
  check: LunaCheckResult,
  blockers: DevnoteBlockerNote[]
): TodoPrompt {
  const spec = checkSpec(
    check,
    idlePhrase(check),
    check.last_label,
    checkExtra(check)
  );
  const blocker = matchBlocker(CHECK_BLOCKER_KEYS[check.id] ?? [], blockers);
  const clue = [...blockerLines(blocker), ...spec.clue];
  return composePrompt("dev", spec.ask, spec.state, clue);
}

const INTERVIEW_KEYS = ["용어사전", "고유명사", "발주처", "업무 지식", "아폴론 지식"];
const WEBSITE_KEYS = ["홈페이지", "website", "웹사이트"];

function roomFor(text: string): PromptRoom {
  const lower = text.toLowerCase();
  if (WEBSITE_KEYS.some((k) => lower.includes(k.toLowerCase()))) return "website";
  if (INTERVIEW_KEYS.some((k) => text.includes(k))) return "interview";
  return "dev";
}

/** 자습이 사람 손을 기다리는 것 — 무엇을 만들면 풀리는지부터 Claude 와 정한다 */
export function buildStudyBlockedPrompt(
  card: StudyRunReportCard,
  blockers: DevnoteBlockerNote[]
): TodoPrompt {
  const agenda = card.agenda.trim();
  const room = roomFor(`${agenda} ${card.blocked ?? ""}`);
  const blocker = matchBlocker(
    agenda.split(/[\s·,]+/).filter((w) => w.length >= 2),
    blockers
  );
  return composePrompt(
    room,
    `자습 「${agenda}」${iGa(agenda)} 사람 손을 기다려. 무엇을 만들면 풀리는지 같이 정하자.`,
    [
      card.blocked ? `막힌 것 — ${card.blocked}` : null,
      `어젯밤 결과 — ${card.result}`
    ],
    [
      ...blockerLines(blocker),
      "코드로 되는 건 네가 하고, 내가 눌러야 하는 건 따로 알려줘."
    ]
  );
}
