import type { TrafficLight } from "@/lib/luna-admin/traffic";
import type { LunaAdminPrimarySource } from "@/lib/luna-admin/nav";
import type { FailureCauseType } from "@/lib/luna/failure-cause";

export type StageView = {
  key: "collect" | "learn" | "confirm" | "apply";
  label: string;
  light: TrafficLight;
  title: string;
  detail: string;
};

export type AdminAlert = {
  title: string;
  detail: string;
  href: string;
};

export type TonightItem = {
  id: string;
  title: string;
  what: string;
  why: string;
  effect: string;
  minutes: number;
  excluded: boolean;
  when: "tonight" | "tomorrow" | "brain";
  failure_ids: string[];
  expected?: string;
  kind?: string;
  verifiable?: boolean;
};

export type TonightState = {
  items: TonightItem[];
  generated_at: string;
  source?: "autonomous" | "failures";
};

export type SentRow = {
  id: string;
  failure_label: string;
  failure_ids: string[];
  sent_at: string;
  topic: string;
  result: string;
  resolved: boolean;
};

export type AdminDashboard = {
  stages: StageView[];
  alerts: AdminAlert[];
  rule_questions: Array<{
    id: string;
    title: string;
    body: string;
    signal_count: number;
  }>;
  cards: {
    primary: number;
    primary_delta_label: string;
    secondary: number;
    secondary_note: string;
    talk_week: number;
    talk_users: number;
    my_turn: number;
    my_turn_note: string;
  };
  tonight: TonightItem[];
  tonight_label: string;
  storage: StorageDashboardView | null;
  response_timing: ResponseTimingDashboardView | null;
  badges: {
    failures: number;
    candidates: number;
    selfstudy_dot: boolean;
  };
};

export type StorageDashboardView = {
  region_label: string;
  plan_label: string;
  supabase_url: string | null;
  used_bytes: number;
  limit_bytes: number;
  limit_gb: number;
  used_pct: number;
  free_bytes: number;
  warn_level: "ok" | "warn" | "bad";
  groups: Array<{
    grp: string;
    bytes: number;
    color: string;
    pct_of_limit: number;
  }>;
  tables: Array<{
    table_name: string;
    bytes: number;
    yesterday_delta_bytes: number | null;
    legacy?: boolean;
  }>;
  forecast: Array<{
    id: string;
    label: string;
    note: string;
    estimated_bytes: number;
    status: "pending" | "running" | "done";
    monthly?: boolean;
  }>;
  forecast_total_bytes: number;
  forecast_pct: number;
  platform: {
    storage_bytes: number | null;
    storage_limit_bytes: number | null;
    egress_bytes: number | null;
    egress_limit_bytes: number | null;
    edge_invocations: number | null;
    edge_limit: number | null;
    source: "unavailable" | "management_api";
    note: string;
  };
  disk_expansions_used: number | null;
  disk_expansions_max: number | null;
  overage_usd_per_gb: number;
  years_to_limit_label: string;
  legacy_embeddings: {
    table_name: string;
    bytes: number;
    after_delete_bytes: number;
  } | null;
  rpc_ms: number;
  rpc_cached: boolean;
  has_yesterday: boolean;
};

export type ResponseTimingDashboardView = {
  avg_total_ms: number;
  avg_search_ms: number;
  avg_link_ms: number;
  avg_llm_ms: number;
  avg_embed_ms: number;
  sample_count: number;
  warn_level: "ok" | "warn" | "bad";
  sparkline: Array<{
    date: string;
    avg_total_ms: number;
    count: number;
  }>;
};

export type PrimarySourceRow = {
  source: LunaAdminPrimarySource;
  label: string;
  size_label: string;
  count: number;
  extra_count?: number;
  unit?: string;
  schedule_label: string;
  last_iso: string | null;
  last_label: string;
  duration_label: string;
  status: TrafficLight;
  status_label: string;
  note: string;
  delta: number | null;
  delta_label: string;
};

export type PrimaryFlowStep = {
  t: string;
  v: number;
  d?: string;
  loss?: boolean;
};

export type PrimaryCheckRow = {
  id: string;
  name: string;
  schedule_label: string;
  last_label: string;
  status: TrafficLight;
  status_label: string;
};

export type PrimaryStorageRow = {
  name: string;
  bytes: number;
  bytes_label: string;
  color: string;
  bar_pct: number;
};

export type PrimaryPayload = {
  work: PrimarySourceRow;
  notion: PrimarySourceRow;
  image: PrimarySourceRow;
  wiki: PrimarySourceRow;
  glossary: PrimarySourceRow;
  rows: PrimarySourceRow[];
  work_flow: PrimaryFlowStep[];
  checks: PrimaryCheckRow[];
  storage: PrimaryStorageRow[];
  query_ms: number;
};

export type AnalysisAction = {
  id: string;
  title: string;
  when: "tonight" | "tomorrow" | "brain";
};

export type AnalysisGroup = {
  cause: FailureCauseType;
  title: string;
  emoji: string;
  count: number;
  common_cause: string;
  samples: string[];
  actions: AnalysisAction[];
  failure_ids: string[];
};

export type AnalysisPayload = {
  total: number;
  inspect_count: number;
  groups: AnalysisGroup[];
};

export type YearProgressRow = {
  year: string;
  projects: number;
  notion: number;
  images: number;
  progress_pct: number;
  status: "done" | "tonight" | "wait";
  status_label: string;
};

export type LinkProgressPayload = {
  overall_pct: number;
  auto: number;
  ask: number;
  hold: number;
  years: YearProgressRow[];
};

export type PairSideView = {
  typeLabel: string;
  title: string;
  path: string;
  facts: string;
};

export type LunaQuestionRow = {
  id: string;
  question: string;
  why: string;
  context: Record<string, unknown>;
  assignee: string | null;
  status: "pending" | "answered" | "skipped";
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  confidence: number | null;
  link_id: string | null;
  created_at: string;
  pair?: {
    left: PairSideView;
    right: PairSideView;
    reason: string;
  } | null;
};

/** 2차 「같은 것」판정 질문 — 지식후보 UI에서는 빼고 「같은 것」으로 보낸다. */
export function isSameLinkQuestion(row: Pick<LunaQuestionRow, "context" | "link_id">): boolean {
  return row.context?.kind === "same" || Boolean(row.link_id);
}

