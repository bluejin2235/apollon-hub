export type SelfstudySource = "frequency" | "failure" | "manual" | "project";
export type SelfstudyQueueStatus = "pending" | "running" | "done" | "skipped";

export type SelfstudyQueueRow = {
  id: string;
  topic: string;
  source: SelfstudySource;
  score: number;
  evidence: Record<string, unknown>;
  status: SelfstudyQueueStatus;
  project_id: string | null;
  created_at: string;
  processed_at: string | null;
};

export type LunaReportRow = {
  id: string;
  topic: string;
  title: string;
  content: string;
  sources: unknown;
  queue_id: string | null;
  project_id: string | null;
  use_count: number;
  last_used_at: string | null;
  status: string;
  model_label: string | null;
  created_at: string;
};
