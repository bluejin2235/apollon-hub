/**
 * 서버 환경변수 — 같은 키의 옛 이름·새 이름을 함께 읽는다.
 * 하나라도 있으면 통과. 둘 다 없으면 로그·체크리스트에 남긴다.
 */

export type EnvAliasGroup = {
  id: string;
  label: string;
  /** 이 중 하나라도 있으면 됨 */
  names: string[];
  /** vercel.json cron path. 비면 공통 */
  crons: string[];
  /** true 면 없어도 체크리스트를 빨강으로 만들지 않음 */
  optional?: boolean;
  /** true 면 Vercel 배포에서만 필수 — 로컬 .env 에는 없을 수 있다 */
  vercelOnly?: boolean;
};

export const ENV_ALIAS_GROUPS: EnvAliasGroup[] = [
  {
    id: "cron_secret",
    label: "CRON_SECRET",
    names: ["CRON_SECRET"],
    crons: []
  },
  {
    id: "supabase_url",
    label: "Supabase URL",
    names: ["NEXT_PUBLIC_SUPABASE_URL"],
    crons: []
  },
  {
    id: "supabase_secret",
    label: "Supabase secret",
    names: ["SUPABASE_SECRET_KEY"],
    crons: []
  },
  {
    id: "anthropic",
    label: "Claude",
    names: ["hubtrendchat_claude", "ANTHROPIC_API_KEY"],
    crons: [
      "/api/cron/luna-eval",
      "/api/cron/luna-consolidate",
      "/api/cron/luna-selfstudy",
      "/api/cron/luna-self-upgrade",
      "/api/cron/luna-links",
      "/api/cron/luna-signals"
    ]
  },
  {
    id: "openai",
    label: "OpenAI",
    names: ["LUNA_OPENAI_API_KEY", "OPENAI_API_KEY"],
    crons: [
      "/api/cron/luna-eval",
      "/api/cron/luna-model-inspect",
      "/api/cron/notion-index",
      "/api/cron/luna-consolidate"
    ]
  },
  {
    id: "google",
    label: "Gemini",
    names: ["LUNA_GOOGLE_API_KEY", "hubtrendchat_geminai"],
    crons: ["/api/cron/luna-eval", "/api/cron/luna-model-inspect"],
    optional: true
  },
  {
    id: "artificial_analysis",
    label: "Artificial Analysis",
    names: ["LUNA_ARTIFICIAL_ANALYSIS_API_KEY", "ARTIFICIAL_ANALYSIS_API_KEY"],
    crons: ["/api/cron/luna-model-inspect"]
  },
  {
    id: "notion",
    label: "Notion",
    names: ["NOTION_TOKEN"],
    crons: ["/api/cron/notion-index"]
  },
  {
    id: "resend",
    label: "Resend",
    names: ["RESEND_API_KEY"],
    crons: [
      "/api/cron/luna-admin-report",
      "/api/cron/daily-digest",
      "/api/cron/license-digest",
      "/api/cron/license-expiry"
    ],
    vercelOnly: true
  },
  {
    id: "resend_from",
    label: "Resend From",
    names: ["RESEND_FROM_EMAIL"],
    crons: [
      "/api/cron/luna-admin-report",
      "/api/cron/daily-digest",
      "/api/cron/license-digest",
      "/api/cron/license-expiry"
    ],
    vercelOnly: true
  },
  {
    id: "admin_report_to",
    label: "아침 리포트 수신자",
    names: ["LUNA_ADMIN_REPORT_TO"],
    crons: ["/api/cron/luna-admin-report"],
    vercelOnly: true
  },
  {
    id: "tavily",
    label: "Tavily",
    names: ["TAVILY_API_KEY"],
    crons: ["/api/cron/luna-selfstudy", "/api/cron/luna-signals"]
  }
];

export function envAny(names: readonly string[]): string {
  for (const name of names) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
}

export function anthropicApiKey(): string {
  return envAny(["hubtrendchat_claude", "ANTHROPIC_API_KEY"]);
}

export function openaiApiKey(): string {
  return envAny(["LUNA_OPENAI_API_KEY", "OPENAI_API_KEY"]);
}

export function googleApiKey(): string {
  return envAny(["LUNA_GOOGLE_API_KEY", "hubtrendchat_geminai"]);
}

export function artificialAnalysisApiKeyFromEnv(): string {
  return envAny([
    "LUNA_ARTIFICIAL_ANALYSIS_API_KEY",
    "ARTIFICIAL_ANALYSIS_API_KEY"
  ]);
}

export type MissingEnvGroup = {
  id: string;
  label: string;
  names: string[];
  message: string;
};

export function missingEnvMessage(names: readonly string[]): string {
  return `${names.join(" / ")} 를 찾을 수 없습니다`;
}

export function missingEnvGroups(): MissingEnvGroup[] {
  const missing: MissingEnvGroup[] = [];
  for (const group of ENV_ALIAS_GROUPS) {
    if (group.optional) continue;
    if (group.vercelOnly && !process.env.VERCEL) continue;
    if (envAny(group.names)) continue;
    missing.push({
      id: group.id,
      label: group.label,
      names: [...group.names],
      message: missingEnvMessage(group.names)
    });
  }
  return missing;
}

/** 이름이 어긋나면 조용히 넘어가지 않는다 — 로그에 남긴다. */
export function logMissingEnvGroups(context: string): MissingEnvGroup[] {
  const missing = missingEnvGroups();
  for (const m of missing) {
    console.error(`[luna/env] ${context}: ${m.message}`);
  }
  return missing;
}
