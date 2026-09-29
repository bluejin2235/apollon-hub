import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotionSource } from '@/lib/luna/notion';
import { readIndexedNotionEvidence, type ReadNotionEvidence } from '@/lib/luna/notion-page-evidence';
import { reviewAllNotionEvidence } from '@/lib/luna/notion-evidence-review';
import { loadNotionRelationGraph, readRelationCandidates } from '@/lib/luna/notion-relation-navigation';
import { readDirectoryMaterials, type NotionDirectoryProject } from '@/lib/luna/notion-project-directory';

type Reviewer = (sources: NotionSource[]) => Promise<Record<string, unknown> | null>;
async function reviewDocuments(sources: ReadNotionEvidence[], reviewer: Reviewer, verifier?: Reviewer) {
  const origins=new Map<string,NotionSource>();
  const windows=sources.flatMap(({evidence_passages,evidence_state,...source})=>(evidence_state==='empty' || evidence_state==='missing' ? [] : evidence_passages?.length ? evidence_passages : [source.excerpt??'']).map((excerpt,i)=>{
    const id=`${source.id}#passage:${i}`;
    origins.set(id,source);
    return {...source,id,excerpt};
  }));
  const first=await reviewAllNotionEvidence(windows,reviewer);
  const final=verifier ? await reviewAllNotionEvidence([...first.direct,...first.adjacent],verifier) : first;
  const checked={...final,unverifiedIds:[...new Set([...first.unverifiedIds,...final.unverifiedIds])]};
  const direct=new Map<string,NotionSource>(), adjacent=new Map<string,NotionSource>();
  const basis:NonNullable<typeof checked.basis>={};
  for (const [items,target] of [[checked.direct,direct],[checked.adjacent,adjacent]] as const) {
    for (const item of items) {
      const original=origins.get(item.id)!;
      if (!target.has(original.id)) target.set(original.id,{...original,excerpt:[checked.basis?.[item.id]?.quote,original.excerpt].filter(Boolean).join("\n\n")});
      const proof=checked.basis?.[item.id];
      if(proof) basis[original.id]??=proof;
    }
  }
  for (const id of direct.keys()) adjacent.delete(id);
  const unverifiedIds=[...new Set([...checked.unverifiedIds.map(id=>origins.get(id)!.id),...sources.filter(s=>s.evidence_state==='failed' || s.evidence_state==='missing').map(s=>s.id)])];
  return {direct:[...direct.values()],adjacent:[...adjacent.values()],basis,
    reviewedIds:sources.map(s=>s.id).filter(id=>!unverifiedIds.includes(id)),unverifiedIds};
}

/** Only complete, identical bodies can share a review. Never merge by title alone. */
function duplicateKey(source: ReadNotionEvidence): string | null {
  if (source.evidence_state !== 'complete') return null;
  const body=(source.evidence_passages ?? []).join('\n').replace(/\s+/g,' ').trim();
  if(body.length<120) return null;
  return source.title.replace(/\s*\(\d+\)$/, '').trim().toLowerCase()+'\n'+body;
}
function canonicalPreference(source: NotionSource): number {
  const path=(source.path_titles ?? []).join('/');
  return (/backup|백업|사본/i.test(path) ? -10 : 0)+(/사업개발/.test(path) ? 1 : 0);
}

/** Traverse grounded project memberships and explicit relations to a fixed point.
 * Empty relation pages are navigation only; failed/missing bodies remain visible
 * in coverage. Neither summary length nor citations decide inventory membership. */
export async function buildDocumentInventory(admin: SupabaseClient, input: {
  query: string; sources: NotionSource[]; directory: NotionDirectoryProject[]; review: Reviewer; verify?: Reviewer;
}) {
  const graph=await loadNotionRelationGraph(admin);
  const seen=new Set<string>(), reached=new Set<string>(), walked=new Set<string>();
  const inspected=new Map<string,ReadNotionEvidence>();
  const keys=new Map<string,string>(), aliases:Record<string,string>={};
  const direct=new Map<string,NotionSource>(), adjacent=new Map<string,NotionSource>();
  const basis:Record<string,{quote:string;reason:string}>={};
  const reviewed=new Set<string>(), unverified=new Set<string>(), unavailable=new Set<string>();
  let candidates=input.sources;
  while(candidates.length) {
    const pending=[...new Map(candidates.filter(s=>!seen.has(s.id)).map(s=>[s.id,s])).values()];
    if(!pending.length) break;
    pending.forEach(s=>seen.add(s.id));
    const read=await readIndexedNotionEvidence(admin,pending,input.query,true);
    const unique:ReadNotionEvidence[]=[];
    for(const source of read) {
      inspected.set(source.id,source);
      const key=duplicateKey(source), existing=key ? keys.get(key) : null;
      if(existing) aliases[source.id]=existing;
      else { if(key) keys.set(key,source.id); unique.push(source); }
    }
    const checked=await reviewDocuments(unique,input.review,input.verify);
    checked.direct.forEach(s=>direct.set(s.id,s));checked.adjacent.forEach(s=>adjacent.set(s.id,s));
    Object.assign(basis,checked.basis);
    checked.reviewedIds.forEach(id=>reviewed.add(id));checked.unverifiedIds.forEach(id=>unverified.add(id));
    const navigation=new Set<string>();
    for(const source of read) {
      const canonical=aliases[source.id] ?? source.id;
      if(canonical!==source.id) {
        if(unverified.has(canonical)) unverified.add(source.id); else reviewed.add(source.id);
      }
      if(direct.has(canonical) || adjacent.has(canonical) || source.evidence_state==='empty' || source.evidence_state==='missing') navigation.add(source.id);
    }
    const projects=input.directory.filter(p=>!reached.has(p.key) && p.pageIds.some(id=>navigation.has(id) &&
      (direct.has(aliases[id] ?? id) || adjacent.has(aliases[id] ?? id))));
    projects.forEach(p=>reached.add(p.key));
    const linkedIds=new Set<string>();
    for(const id of navigation) {
      if(walked.has(id)) continue;
      walked.add(id);
      for(const neighbour of graph.neighbours.get(id) ?? []) if(!seen.has(neighbour)) linkedIds.add(neighbour);
    }
    const [members,linked]=await Promise.all([
      projects.length ? readDirectoryMaterials(admin,projects,input.query) : Promise.resolve([]),
      readRelationCandidates(admin,[...linkedIds])
    ]);
    linked.unavailable.forEach(id=>{unavailable.add(id);seen.add(id);});
    candidates=[...members,...linked.sources].filter(s=>!seen.has(s.id));
  }
  // Prefer a current page over an exact backup, retaining every equivalent ID in
  // the audit trail. Changed revisions have different keys and remain separate.
  const replacements=new Map<string,string>();
  for(const [alias,original] of Object.entries(aliases)) {
    const best=replacements.get(original) ?? original;
    if(canonicalPreference(inspected.get(alias)!)>canonicalPreference(inspected.get(best)!)) replacements.set(original,alias);
  }
  const finalAliases:Record<string,string>={};
  for(const [alias,original] of Object.entries(aliases)) {
    const best=replacements.get(original) ?? original;
    if(alias!==best) finalAliases[alias]=best;
    if(original!==best) finalAliases[original]=best;
  }
  const remap=(items:Map<string,NotionSource>)=>[...items.values()].map(source=>{
    const target=replacements.get(source.id);
    if(!target) return source;
    const {evidence_passages,evidence_state,...preferred}=inspected.get(target)!;
    basis[target]=basis[source.id];delete basis[source.id];
    return {...preferred,excerpt:source.excerpt};
  });
  return {direct:remap(direct),adjacent:remap(adjacent),basis,
    reviewedIds:[...reviewed],unverifiedIds:[...unverified],aliases:finalAliases,
    navigationComplete:graph.complete,unavailableIds:[...unavailable],
    inspected:[...inspected.values()].map(({evidence_passages,evidence_state,...source})=>source),
    reachedProjects:[...reached]};
}
