/** API 사용량 CSV 업로드 · 대시보드 공용 타입/유틸 */

export type ApiUsageProvider = "anthropic" | "openai";

export type ApiUsageRow = {
  provider: ApiUsageProvider;
  date: string;
  model: string;
  api_key_label: string;
  input_tokens: number;
  output_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  cost_usd: number;
  num_requests: number;
};

export type ApiUsageDbRow = Omit<ApiUsageRow, "num_requests"> & {
  num_requests: number | null;
  id?: string;
  created_at?: string;
  uploaded_by?: string | null;
  profiles?: { name: string | null } | null;
};

export type ProviderUploadMeta = {
  provider: ApiUsageProvider;
  created_at: string | null;
  uploader_name: string | null;
  data_start: string | null;
  data_end: string | null;
};

export function formatUploadTimestamp(iso: string | null): string {
  if (!iso) return "업데이트 기록 없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "업데이트 기록 없음";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = d.getHours();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 || 12;
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}. ${mo}. ${da}. ${ampm} ${String(h12).padStart(2, "0")}:${mi}`;
}

/** 예: "2026. 05. 19. 오후 06:09 · 이택진" (이름 없으면 일시만) */
export function formatProviderUploadMeta(meta: ProviderUploadMeta): string {
  if (!meta.created_at) return "업데이트 기록 없음";
  const ts = formatUploadTimestamp(meta.created_at);
  return meta.uploader_name ? `${ts} · ${meta.uploader_name}` : ts;
}

export type UsagePeriodPreset =
  | "last_30days"
  | "this_month"
  | "last_month"
  | "last_3m"
  | "custom";

export type ProviderFilter = "all" | ApiUsageProvider;

const ANTHROPIC_INPUT_TYPES = new Set([
  "input_no_cache",
  "input_cache_read",
  "input_cache_write"
]);

const OPENAI_PRICING_PER_M: Record<string, { input: number; output: number }> = {
  "gpt-4o-2024-08-06": { input: 2.5, output: 10.0 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6 },
  "gpt-5.5-2026-04-23": { input: 2.0, output: 8.0 }
};

const OPENAI_DEFAULT_PRICING = { input: 2.5, output: 10.0 };

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function resolveUsageDateRange(
  preset: UsagePeriodPreset,
  customStart: string,
  customEnd: string,
  today = new Date()
): { start: string; end: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const toIso = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (preset === "custom") return { start: customStart, end: customEnd };
  if (preset === "last_30days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    return { start: toIso(start), end: toIso(today) };
  }
  if (preset === "this_month") return { start: toIso(new Date(y, m, 1)), end: toIso(today) };
  if (preset === "last_month") {
    return { start: toIso(new Date(y, m - 1, 1)), end: toIso(new Date(y, m, 0)) };
  }
  const start = new Date(today);
  start.setMonth(start.getMonth() - 2);
  start.setDate(1);
  return { start: toIso(start), end: toIso(today) };
}

/** RFC4180-ish CSV 파서 */
export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      if (cur.length > 0 || lines.length === 0) lines.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) lines.push(cur);

  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else q = !q;
      } else if (c === "," && !q) {
        cells.push(cell.trim());
        cell = "";
      } else cell += c;
    }
    cells.push(cell.trim());
    return cells;
  };

  const headers = splitRow(nonEmpty[0]).map((h) => h.replace(/^\uFEFF/, ""));
  const rows = nonEmpty.slice(1).map((line) => {
    const vals = splitRow(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = vals[idx] ?? "";
    });
    return rec;
  });

  return { headers, rows };
}

function toNum(v: string | undefined): number {
  if (v == null || v.trim() === "") return 0;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeDateFromAnthropic(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeDateFromOpenAi(iso: string): string | null {
  const s = iso.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function openAiPricing(model: string): { input: number; output: number } {
  return OPENAI_PRICING_PER_M[model] ?? OPENAI_DEFAULT_PRICING;
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

type Agg = ApiUsageRow;

function aggKey(date: string, model: string, apiKey: string): string {
  return `${date}\0${model}\0${apiKey}`;
}

export function parseAnthropicCsv(text: string): ApiUsageRow[] {
  const { headers, rows } = parseCsvText(text);
  if (!headers.includes("usage_date_utc") || !headers.includes("model")) {
    throw new Error("Anthropic CSV 형식이 아닙니다. usage_date_utc, model 컬럼이 필요합니다.");
  }

  const map = new Map<string, Agg>();

  for (const row of rows) {
    const date = normalizeDateFromAnthropic(row.usage_date_utc ?? "");
    const model = (row.model ?? "").trim();
    if (!date || !model) continue;

    const apiKey = (row.api_key ?? "").trim() || "—";
    const tokenType = (row.token_type ?? "").trim();
    const cost = toNum(row.cost_usd);

    const key = aggKey(date, model, apiKey);
    const prev =
      map.get(key) ??
      ({
        provider: "anthropic",
        date,
        model,
        api_key_label: apiKey,
        input_tokens: 0,
        output_tokens: 0,
        input_cost_usd: 0,
        output_cost_usd: 0,
        cost_usd: 0,
        num_requests: 0
      } satisfies Agg);

    if (tokenType === "input_no_cache" || tokenType === "input") {
      prev.num_requests += 1;
    }

    if (tokenType === "output") {
      prev.output_cost_usd += cost;
    } else if (ANTHROPIC_INPUT_TYPES.has(tokenType)) {
      prev.input_cost_usd += cost;
    } else if (tokenType) {
      prev.input_cost_usd += cost;
    }

    prev.cost_usd = roundUsd(prev.input_cost_usd + prev.output_cost_usd);
    map.set(key, prev);
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model));
}

export function parseOpenAiCsv(text: string): ApiUsageRow[] {
  const { headers, rows } = parseCsvText(text);
  if (!headers.includes("start_time_iso") && !headers.includes("end_time_iso")) {
    throw new Error("OpenAI CSV 형식이 아닙니다. start_time_iso(또는 end_time_iso) 컬럼이 필요합니다.");
  }

  const map = new Map<string, Agg>();

  for (const row of rows) {
    const model = (row.model ?? "").trim();
    if (!model) continue;

    const date = normalizeDateFromOpenAi(row.start_time_iso ?? row.start_time ?? "");
    if (!date) continue;

    const apiKey = (row.api_key_id ?? "").trim() || "—";
    const inputTokens = Math.round(toNum(row.input_tokens));
    const outputTokens = Math.round(toNum(row.output_tokens));

    const key = aggKey(date, model, apiKey);
    const prev =
      map.get(key) ??
      ({
        provider: "openai",
        date,
        model,
        api_key_label: apiKey,
        input_tokens: 0,
        output_tokens: 0,
        input_cost_usd: 0,
        output_cost_usd: 0,
        cost_usd: 0,
        num_requests: 0
      } satisfies Agg);

    prev.num_requests += Math.round(toNum(row.num_model_requests));
    prev.input_tokens += inputTokens;
    prev.output_tokens += outputTokens;

    const { input, output } = openAiPricing(model);
    prev.input_cost_usd = roundUsd((prev.input_tokens * input) / 1_000_000);
    prev.output_cost_usd = roundUsd((prev.output_tokens * output) / 1_000_000);
    prev.cost_usd = roundUsd(prev.input_cost_usd + prev.output_cost_usd);
    map.set(key, prev);
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model));
}

export function parseUsageCsv(provider: ApiUsageProvider, text: string): ApiUsageRow[] {
  return provider === "anthropic" ? parseAnthropicCsv(text) : parseOpenAiCsv(text);
}

/** CSV 파싱 결과 → api_usage upsert payload */
export function buildApiUsageUpsertPayload(
  row: ApiUsageRow,
  meta: { uploaded_by: string | null; created_at: string }
) {
  return {
    provider: row.provider,
    date: row.date,
    model: row.model,
    api_key_label: row.api_key_label,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    input_cost_usd: row.input_cost_usd,
    output_cost_usd: row.output_cost_usd,
    cost_usd: row.cost_usd,
    num_requests: row.num_requests,
    uploaded_by: meta.uploaded_by,
    created_at: meta.created_at
  };
}

/** CSV 전체 행에서 날짜 범위 추출 (모델 유무와 무관, 빈 사용량 파일용) */
export function extractCsvDateRange(
  provider: ApiUsageProvider,
  text: string
): { min: string; max: string } | null {
  const { headers, rows } = parseCsvText(text);

  if (provider === "openai") {
    if (!headers.includes("start_time_iso") && !headers.includes("end_time_iso")) {
      return null;
    }
    const dates: string[] = [];
    for (const row of rows) {
      const candidates = [row.start_time_iso, row.end_time_iso, row.start_time, row.end_time];
      for (const raw of candidates) {
        const d = normalizeDateFromOpenAi(raw ?? "");
        if (d) dates.push(d);
      }
    }
    if (dates.length === 0) return null;
    dates.sort();
    return { min: dates[0], max: dates[dates.length - 1] };
  }

  if (!headers.includes("usage_date_utc")) return null;
  const dates: string[] = [];
  for (const row of rows) {
    const d = normalizeDateFromAnthropic(row.usage_date_utc ?? "");
    if (d) dates.push(d);
  }
  if (dates.length === 0) return null;
  dates.sort();
  return { min: dates[0], max: dates[dates.length - 1] };
}

export function formatCsvEmptyRangeMessage(range: { min: string; max: string }): string {
  return `${range.min} ~ ${range.max} 기간: 사용 내역 없음`;
}

/** 대시보드 집계 */
export type DailyCostPoint = {
  date: string;
  label: string;
  anthropic: number;
  openai: number;
  total: number;
};

export type ModelCostRow = {
  model: string;
  provider: ApiUsageProvider;
  input_cost_usd: number;
  output_cost_usd: number;
  cost_usd: number;
  share_pct: number;
};

export type DashboardAggregate = {
  rows: ApiUsageDbRow[];
  total_cost_usd: number;
  total_tokens: number | null;
  total_requests: number | null;
  date_min: string | null;
  date_max: string | null;
  daily: DailyCostPoint[];
  byModel: ModelCostRow[];
};

export function aggregateUsageDashboard(
  rows: ApiUsageDbRow[],
  range: { start: string; end: string }
): DashboardAggregate {
  const filtered = rows.filter((r) => r.date >= range.start && r.date <= range.end);

  const total_cost_usd = filtered.reduce((s, r) => s + Number(r.cost_usd), 0);
  const openaiRows = filtered.filter((r) => r.provider === "openai");
  const total_tokens =
    openaiRows.length > 0
      ? openaiRows.reduce((s, r) => s + Number(r.input_tokens) + Number(r.output_tokens), 0)
      : filtered.some((r) => r.provider === "anthropic")
        ? null
        : 0;

  const total_requests =
    filtered.length === 0
      ? null
      : filtered.reduce((sum, r) => sum + (r.num_requests ?? 0), 0);

  const dates = filtered.map((r) => r.date).sort();
  const date_min = dates[0] ?? null;
  const date_max = dates[dates.length - 1] ?? null;

  const dailyMap = new Map<string, { anthropic: number; openai: number }>();
  for (const r of filtered) {
    const d = dailyMap.get(r.date) ?? { anthropic: 0, openai: 0 };
    if (r.provider === "anthropic") d.anthropic += Number(r.cost_usd);
    else d.openai += Number(r.cost_usd);
    dailyMap.set(r.date, d);
  }

  const daily: DailyCostPoint[] = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const [, m, day] = date.split("-");
      return {
        date,
        label: `${Number(m)}/${Number(day)}`,
        anthropic: roundUsd(v.anthropic),
        openai: roundUsd(v.openai),
        total: roundUsd(v.anthropic + v.openai)
      };
    });

  const modelMap = new Map<string, ModelCostRow>();
  for (const r of filtered) {
    const key = `${r.provider}\0${r.model}`;
    const prev = modelMap.get(key) ?? {
      model: r.model,
      provider: r.provider,
      input_cost_usd: 0,
      output_cost_usd: 0,
      cost_usd: 0,
      share_pct: 0
    };
    prev.input_cost_usd += Number(r.input_cost_usd);
    prev.output_cost_usd += Number(r.output_cost_usd);
    prev.cost_usd += Number(r.cost_usd);
    modelMap.set(key, prev);
  }

  const byModel = [...modelMap.values()]
    .map((m) => ({
      ...m,
      input_cost_usd: roundUsd(m.input_cost_usd),
      output_cost_usd: roundUsd(m.output_cost_usd),
      cost_usd: roundUsd(m.cost_usd),
      share_pct: total_cost_usd > 0 ? (m.cost_usd / total_cost_usd) * 100 : 0
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  return {
    rows: filtered,
    total_cost_usd: roundUsd(total_cost_usd),
    total_tokens,
    total_requests,
    date_min,
    date_max,
    daily,
    byModel
  };
}
