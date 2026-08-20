export type LunaDashboard = {
  generated_at: string;
  date_label: string;
  my_turn_count: number;
  knowledge: {
    /** 요약·핵심 층이 준비되면 true — 없으면 세 겹 블록 생략 */
    has_summary_layer: boolean;
    active_count: number;
    week_new: number;
    org_count: number;
    personal_count: number;
    glossary_count: number | null;
    nas_indexed: number;
    nas_last_total: number | null;
    notion_connected: boolean;
    conflict_count: number;
    top_used: { content: string; use_count: number } | null;
    latest_confirmed: { content: string; resolved_at: string | null } | null;
  };
  talk: {
    conversations_today: number;
    conversations_yesterday: number;
    active_users_today: number;
    total_users: number;
    thumbs_up_today: number;
    thumbs_down_today: number;
    clarify_today: number;
    clarify_yesterday: number;
    corrections_today: number;
    corrections_yesterday: number;
    search_zero_today: number;
    requery_today: number;
    assume_today: number;
    /** 구술·문서(원문) 편수 — 집계 불가 시 null */
    sources_count: number | null;
    /** 최근 입력일 라벨 (오늘/어제/MM.DD) */
    sources_latest_label: string | null;
    top_users_yesterday: Array<{
      rank: number;
      user_id: string;
      name: string;
      count: number;
    }>;
  };
  candidates: {
    pending: number;
    confirmed_today: number;
    weekly_inflow: number[];
    trend: "down" | "up" | "flat" | "unknown";
    trend_label: string;
    by_source: {
      chat: number;
      selfstudy: number;
      question: number;
      direct: number;
    };
    avg_confirm_days: number | null;
    my_turn: number;
  };
  selfstudy: {
    yesterday_submitted: number;
    accuracy_pct: number | null;
    stuck_today: number;
    next_run_label: string;
    recent_topic: string | null;
    not_needed_week: number;
  };
  brain: {
    active_prompts: number;
    week_changes_luna: number;
    week_changes_human: number;
    revert_pending: number;
    latest_upgrade: {
      title: string;
      reason: string | null;
      prediction: string | null;
      verify_result: string | null;
    } | null;
    models: { tier: string; label: string }[];
    tokens_week: number;
    tokens_prev_week: number;
    tokens_delta: number | null;
    tokens_delta_pct: number | null;
  };
  failures: {
    open: number;
  };
};
