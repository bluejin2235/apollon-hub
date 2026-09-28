import type { SupabaseClient } from '@supabase/supabase-js';

export type GroundedTarget = { name: string; alias: string; page_id: string; quote: string };
type Passage = { chunk_id: string; page_id: string; heading: string; text: string };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** Only explicit equivalence in indexed evidence may introduce a new name. */
export function discoverGroundedTargets(rows: Passage[], terms: string[], relatedAliases = false): GroundedTarget[] {
  const found = new Map<string, GroundedTarget>();
  for (const row of rows) {
    const re = /([A-Za-z][A-Za-z0-9 &:'’\-]{2,80}|[「〈『“][^」〉』”\n]{2,80}[」〉』”])\s*\(\s*(?:일명|별칭|aka\.?|also known as)\s*[:：]?\s*([^\)\n]{2,40})\)/gi;
    for (const m of row.text.matchAll(re)) {
      const name = m[1]!.replace(/^[「〈『“]|[」〉』”]$/g, '').trim();
      const alias = m[2]!.replace(/[‘’'"“”]/g, '').trim();
      if (!terms.some(t => norm(t) === norm(alias) ||
        (relatedAliases && norm(t).length >= 2 && norm(alias).includes(norm(t))))) continue;
      found.set(norm(name), { name, alias, page_id: row.page_id, quote: m[0] });
    }
  }
  return [...found.values()].slice(0, 3);
}

export async function resolveGroundedTargets(admin: SupabaseClient, terms: string[], seedIds: string[], relatedAliases = false) {
  const { matchNotionChunksByKeyword } = await import('@/lib/luna/notion-keyword');
  const focus = terms.filter(t => t.length >= 2 && !/^(자료|제작|기획|사례|이미지|문서|프로젝트|콘텐츠|참고|외부|내부|활용한|제작한|우리가|것과|나눠줘|고른|조건)$/.test(t)).slice(0, 3);
  // Search each topic independently so a frequent project name cannot drown it out.
  const focused = await Promise.all(focus.map(async t => {
    if (!relatedAliases) return matchNotionChunksByKeyword(admin, [t], {limit: 40, light: true});
    // Relationship lookup must not lose an explicit alias behind ordinary topic hits.
    const literal = t.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const {data, error} = await admin.from('luna_notion_chunks').select('chunk_id')
      .ilike('text', `%${literal}%`)
      .or('text.ilike.%일명%,text.ilike.%별칭%,text.ilike.%aka%,text.ilike.%also known as%').limit(40);
    if (error) { console.error('[luna/target] relation lookup', error); return []; }
    return (data ?? []).map(row => ({chunk_id: String(row.chunk_id)}));
  }));
  const ids = [...new Set([...seedIds, ...focused.flat().map(h => h.chunk_id)])].slice(0, 160);
  if (!ids.length) return {targets: [] as GroundedTarget[], hits: [] as Array<{chunk_id:string;page_id:string;keyword_score:number}>};
  const {data,error} = await admin.from('luna_notion_chunks').select('chunk_id,page_id,heading,text').in('chunk_id',ids);
  if(error) { console.error('[luna/target] evidence lookup', error); return {targets: [] as GroundedTarget[],hits: []}; }
  const targets = discoverGroundedTargets((data??[]) as Passage[], focus, relatedAliases);
  // A broad provenance topic may cover several works. Pass equivalence evidence
  // without replacing its candidate set with one alias's canonical-name search.
  if (!targets.length || relatedAliases) return {targets,hits: []};
  const groups = await Promise.all(targets.map(t => matchNotionChunksByKeyword(admin,[t.name],{limit:40,light:true})));
  const hits = groups.flat();
  if (!hits.length) return {targets,hits};
  const {data:direct,error:directError} = await admin.from('luna_notion_chunks').select('chunk_id,page_id,heading,text').in('chunk_id',hits.map(h=>h.chunk_id));
  if(directError) return {targets,hits: []};
  const directIds = new Set(((direct??[]) as Passage[]).filter(p=>targets.some(t=>norm(p.heading).includes(norm(t.name)))).map(p=>p.chunk_id));
  // Direct sections about the work outrank incidental mentions and bridge articles.
  return {targets,hits:hits.map(h=>({...h,keyword_score:h.keyword_score+(directIds.has(h.chunk_id)?100:30)}))};
}
