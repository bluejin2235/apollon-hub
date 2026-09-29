import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotionSource } from '@/lib/luna/notion';
import { isSearchToken } from '@/lib/luna/keyword-token';

type Passage = { text: string; heading?: string; position: number };

/** Read a small page in full; retain matching sections and their neighbours on long pages. */
export function composePageEvidence(rows: Passage[], query: string, limit = 2400): string {
  const ordered = [...rows].sort((a, b) => a.position - b.position);
  const full = ordered.map(r => r.text.trim()).filter(Boolean).join('\n\n');
  if (full.length <= limit) return full;
  const terms = [...new Set((query.toLowerCase().match(/[가-힣a-z0-9]+/g) ?? [])
    .filter(isSearchToken).filter(t => !/^(자료|문서|관련|모두|전체|전부|찾아줘|보여줘)$/.test(t)))];
  const ranked = ordered.map((row, index) => ({ index, score: terms.reduce((n, t) =>
    n + (row.text.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = new Map<number, string>();
  let remaining = limit;
  const add = (index: number) => {
    if (chosen.has(index) || !ordered[index] || remaining < 80) return;
    const text = ordered[index].text.trim();
    const snippet = text.slice(0, Math.min(1000, remaining - 2));
    if (!snippet) return;
    chosen.set(index, snippet + (snippet.length < text.length ? '…' : ''));
    remaining -= snippet.length + 2;
  };
  // Neighbour sections often hold dates, changed scope and constraints without query terms.
  for (const row of ranked) {
    add(row.index); add(row.index + 1); add(row.index - 1);
    if (remaining < 80) break;
  }
  return [...chosen].sort(([a], [b]) => a - b).map(([, text]) => text).join('\n\n').slice(0, limit);
}

/** Page-scoped reads prevent a large page from exhausting another page's row budget. */
export async function readIndexedNotionEvidence(admin: SupabaseClient, sources: NotionSource[], query: string): Promise<NotionSource[]> {
  const output = [...sources];
  for (let start = 0; start < Math.min(sources.length, 32); start += 6) {
    await Promise.all(sources.slice(start, Math.min(start + 6, 32)).map(async (source, offset) => {
      if (!source.id) return;
      try {
        const { data, error } = await admin.from('luna_notion_chunks')
          .select('text, heading, position').eq('page_id', source.id)
          .order('position', { ascending: true }).limit(80);
        if (error || !data?.length) return;
        const excerpt = composePageEvidence(data, query);
        if (excerpt) output[start + offset] = { ...source, excerpt };
      } catch { /* Retain verified search passages if the supplementary read fails. */ }
    }));
  }
  return output;
}
