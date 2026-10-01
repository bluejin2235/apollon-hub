import type { NotionSource } from '@/lib/luna/notion';
import type { ReadNotionEvidence } from '@/lib/luna/notion-page-evidence';
import { reviewAllNotionEvidence, type EvidenceReviewer } from '@/lib/luna/notion-evidence-review';

type Reviewer = EvidenceReviewer;
export async function reviewEvidenceDocuments(sources: ReadNotionEvidence[], reviewer: Reviewer, verifier?: Reviewer) {
  const origins=new Map<string,NotionSource>();
  const windows=sources.flatMap(({evidence_passages,evidence_state,...source})=>(evidence_state==='empty' || evidence_state==='missing' || evidence_state==='failed' ? [] : evidence_passages?.length ? evidence_passages : [source.excerpt??'']).map((excerpt,i)=>{
    const id=`${source.id}#passage:${i}`;
    origins.set(id,source);
    return {...source,id,excerpt};
  }));
  // A cheap positive-only shortlist irreversibly loses valid documents. When a
  // verifier is available, apply that full standard to every source window once.
  // This also avoids anchoring a second decision on the first model's rationale.
  const checked=await reviewAllNotionEvidence(windows,verifier ?? reviewer);
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
  const failures:Record<string,string>={};
  for(const [id,reason] of Object.entries(checked.failures)) failures[origins.get(id)!.id]=reason;
  for(const source of sources) if(source.evidence_state==='failed' || source.evidence_state==='missing') failures[source.id]='body_'+source.evidence_state;
  return {direct:[...direct.values()],adjacent:[...adjacent.values()],basis,failures,
    navigationIds:[...new Set([...checked.navigation??[]].map(s=>origins.get(s.id)!.id))],
    reviewedIds:sources.map(s=>s.id).filter(id=>!unverifiedIds.includes(id)),unverifiedIds};
}
