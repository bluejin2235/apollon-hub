import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotionSource } from '@/lib/luna/notion';
import { readIndexedNotionEvidence, type ReadNotionEvidence } from '@/lib/luna/notion-page-evidence';
import { reviewAllNotionEvidence } from '@/lib/luna/notion-evidence-review';
import { readDirectoryMaterials, type NotionDirectoryProject } from '@/lib/luna/notion-project-directory';

type Reviewer = (sources: NotionSource[]) => Promise<Record<string, unknown> | null>;
async function reviewDocuments(sources: ReadNotionEvidence[], reviewer: Reviewer) {
  const origins=new Map<string,NotionSource>();
  const windows=sources.flatMap(({evidence_passages,...source})=>(evidence_passages?.length ? evidence_passages : [source.excerpt??'']).map((excerpt,i)=>{
    const id=`${source.id}#passage:${i}`;
    origins.set(id,source);
    return {...source,id,excerpt};
  }));
  const checked=await reviewAllNotionEvidence(windows,reviewer);
  const direct=new Map<string,NotionSource>(), adjacent=new Map<string,NotionSource>();
  const basis:NonNullable<typeof checked.basis>={};
  for (const [items,target] of [[checked.direct,direct],[checked.adjacent,adjacent]] as const) {
    for (const item of items) {
      const original=origins.get(item.id)!;
      if (!target.has(original.id)) target.set(original.id,{...original,excerpt:[checked.basis?.[item.id]?.quote,item.excerpt?.slice(0,1800)].filter(Boolean).join("\n\n")});
      const proof=checked.basis?.[item.id];
      if(proof) basis[original.id]??=proof;
    }
  }
  for (const id of direct.keys()) adjacent.delete(id);
  const unverifiedIds=[...new Set(checked.unverifiedIds.map(id=>origins.get(id)!.id))];
  return {direct:[...direct.values()],adjacent:[...adjacent.values()],basis,
    reviewedIds:sources.map(s=>s.id).filter(id=>!unverifiedIds.includes(id)),unverifiedIds};
}

/** Read every candidate passage, then follow verified project membership.
 * Summary length and citations never determine inventory membership. */
export async function buildDocumentInventory(admin: SupabaseClient, input: {
  query: string; sources: NotionSource[]; directory: NotionDirectoryProject[]; review: Reviewer;
}) {
  const initial = await readIndexedNotionEvidence(admin, input.sources, input.query, true);
  const first = await reviewDocuments(initial, input.review);
  const validated = new Set([...first.direct,...first.adjacent].map(s=>s.id));
  const reached = input.directory.filter(p=>p.pageIds.some(id=>validated.has(id)));
  const seen = new Set(initial.map(s=>s.id));
  const follow = (await readDirectoryMaterials(admin,reached,input.query)).filter(s=>!seen.has(s.id));
  const read = await readIndexedNotionEvidence(admin,follow,input.query,true);
  const next = await reviewDocuments(read,input.review);
  return {
    direct:[...first.direct,...next.direct], adjacent:[...first.adjacent,...next.adjacent],
    basis:{...first.basis,...next.basis}, reviewedIds:[...first.reviewedIds,...next.reviewedIds],
    unverifiedIds:[...first.unverifiedIds,...next.unverifiedIds],
    inspected:[...initial,...read].map(({evidence_passages,...source})=>source), reachedProjects:reached.map(p=>p.key)
  };
}
