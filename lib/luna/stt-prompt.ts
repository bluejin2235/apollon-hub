import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const SETTINGS_KEY = "luna_stt_prompt_v2";
const MAX_CHARS = 200;
const SEED_TERMS = [
  "볼팍견적",
  "인스파이어 시즌4",
  "아폴론이머시브웍스",
  "미디어파사드",
  "인스파이어",
  "아크메르",
  "스타에비뉴",
  "트윈아이",
  "디지털스트리트",
  "공헌이익률"
];

const DOC_NOISE = new Set([
  "pdf",
  "pptx",
  "xlsx",
  "docx",
  "최종",
  "제안서",
  "콘텐츠",
  "컨텐츠",
  "프로젝트",
  "리뉴얼",
  "제작",
  "구축",
  "사업개발",
  "work",
  "project"
]);

type Cached = { prompt: string; day: string };

let memory: { at: number; day: string; prompt: string } | null = null;

function kstDay(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function cleanToken(raw: string): string {
  return raw
    .replace(/[_\-./\\()[\]{}]/g, " ")
    .replace(/\d{6}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulName(name: string): boolean {
  const t = name.replace(/\s+/g, "");
  if (t.length < 2 || t.length > 24) return false;
  if (/^\d+$/.test(t)) return false;
  if (DOC_NOISE.has(t.toLowerCase())) return false;
  return /[가-힣A-Za-z]/.test(t);
}

function joinBudget(parts: string[], max = MAX_CHARS): string {
  const seen = new Set<string>();
  const out: string[] = [];
  let len = 0;
  for (const raw of parts) {
    const p = raw.replace(/\s+/g, " ").trim();
    if (!p) continue;
    const key = p.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) continue;
    const next = out.length === 0 ? p : `, ${p}`;
    if (len + next.length > max) break;
    seen.add(key);
    out.push(p);
    len += next.length;
  }
  return out.join(", ");
}

async function loadTerms(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from("glossary_terms")
    .select("term_ko, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) {
    console.error("[luna/stt-prompt] glossary", error);
    return [];
  }
  return (data ?? [])
    .map((r) => (typeof r.term_ko === "string" ? r.term_ko.trim() : ""))
    .filter((t) => t && t.length <= 16);
}

async function loadRecentProjects(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from("nas_directory")
    .select("path")
    .eq("type", "dir")
    .order("modified_at", { ascending: false })
    .limit(80);
  if (error) {
    console.error("[luna/stt-prompt] nas", error);
    return [];
  }
  const names: string[] = [];
  for (const row of data ?? []) {
    const path = typeof row.path === "string" ? row.path : "";
    const segs = path.split(/[/\\]/).map(cleanToken).filter(Boolean);
    const cand = segs[segs.length - 1] || segs[segs.length - 2] || "";
    if (isUsefulName(cand)) names.push(cand.replace(/\s+/g, ""));
  }
  return names;
}

async function buildPrompt(admin: SupabaseClient): Promise<string> {
  const [terms, projects] = await Promise.all([
    loadTerms(admin),
    loadRecentProjects(admin)
  ]);
  return joinBudget([...SEED_TERMS, ...terms, ...projects]);
}

export async function getSttHintPrompt(
  admin: SupabaseClient
): Promise<string> {
  const day = kstDay();
  if (memory && memory.day === day) return memory.prompt;

  const { data } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  const raw = data?.value as Cached | null;
  if (raw && raw.day === day && typeof raw.prompt === "string" && raw.prompt) {
    memory = { at: Date.now(), day, prompt: raw.prompt };
    return raw.prompt;
  }

  const prompt = await buildPrompt(admin);
  memory = { at: Date.now(), day, prompt };
  const { error } = await admin.from("luna_settings").upsert(
    {
      key: SETTINGS_KEY,
      value: { prompt, day },
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) console.error("[luna/stt-prompt] save", error);
  return prompt;
}
