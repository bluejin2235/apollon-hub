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
    n + (row.text.toLowerCase().includes(t) ? 1 : 0), 0) +
    (/변경|제외|취소|철회|재확인|보류|최종\s*확정|수정안/.test(row.text) ? 4 : 0) }))
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
export type ReadNotionEvidence = NotionSource & {
  evidence_passages?: string[];
  evidence_state?: 'complete' | 'empty' | 'missing' | 'failed';
};
export async function readIndexedNotionEvidence(admin: SupabaseClient, sources: NotionSource[], query: string, allPassages = false): Promise<ReadNotionEvidence[]> {
  const output: ReadNotionEvidence[] = [...sources];
  for (let start = 0; start < sources.length; start += 6) {
    await Promise.all(sources.slice(start, start + 6).map(async (source, offset) => {
      if (!source.id) return;
      try {
        const rows: Passage[] = [];
        for (let offset=0;;offset+=1000) {
          const {data,error}=await admin.from('luna_notion_chunks')
            .select('text, heading, position').eq('page_id', source.id)
            .order('position',{ascending:true}).range(offset,offset+999);
          if (error) throw new Error(error.message);
          rows.push(...(data ?? []));
          if (!data || data.length<1000) break;
        }
        if (!rows.length) {
          if (allPassages) {
            const {data,error}=await admin.from('luna_notion_pages').select('index_health')
              .eq('page_id',source.id).maybeSingle();
            output[start+offset]={...source,excerpt:'',evidence_passages:[],
              evidence_state:!error && data?.index_health?.state==='empty' ? 'empty' : 'missing'};
          }
          return;
        }
        const excerpt = composePageEvidence(rows, query);
        // All passages participate in relevance review, including late sections
        // that use different words from the question. Windows overlap for context.
        const full=rows.map(r=>r.text.trim()).filter(Boolean).join('\n\n');
        const passages: string[]=[];
        if (allPassages) for (let pos=0;pos<full.length;pos+=5600) passages.push(full.slice(pos,pos+6000));
        if (excerpt) output[start + offset] = { ...source, excerpt, ...(allPassages ? {evidence_passages:passages,evidence_state:'complete' as const} : {}) };

      } catch {
        if (allPassages) output[start+offset]={...source,evidence_state:'failed'};
      }
    }));
  }
  return output;
}
