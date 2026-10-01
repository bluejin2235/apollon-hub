import { createHash } from 'node:crypto';
import type { NotionSource } from '@/lib/luna/notion';
import { validateNotionEvidenceReview } from '@/lib/luna/notion-evidence-review';
import { EvalReviewPaused } from '@/lib/luna/eval-continuation-control';

export type ReviewCheckpointEntries = Record<string, Record<string, unknown>>;
export type ReviewCheckpointStats = { reused: number; requested: number; model_calls: number };
export type EvalReviewCheckpoint = {
  review: (identity: unknown, batch: NotionSource[], work: (pending: NotionSource[]) => Promise<Record<string, unknown> | null>) => Promise<Record<string, unknown> | null>;
};

/** identity must contain question, full review rules, model and generation options.
 * Decisions are scoped to a single unchanged source window, not its retrieval
 * score, batch position or neighbours. Every replay is body-validated again. */
export function createEvalReviewCheckpoint(options: {
  entries: ReviewCheckpointEntries;
  deadline: number;
  save: () => Promise<void>;
  stats?: ReviewCheckpointStats;
}): EvalReviewCheckpoint {
  let stopped = false;
  let writes: Promise<void> = Promise.resolve();
  return {
    async review(identity, batch, work) {
      const keys=batch.map(source=>createHash('sha256').update(JSON.stringify({
        version:2, identity, source:{id:source.id,title:source.title,excerpt:source.excerpt,
          scope:source.project_key,path_titles:source.path_titles,memberships:source.project_memberships,ancestry:source.project_ancestry}
      })).digest('hex'));
      const decisions:Array<Record<string,unknown>|undefined>=batch.map((source,i)=>{
        const saved=options.entries[keys[i]];
        const valid=saved && validateNotionEvidenceReview([source],saved,true);
        return valid && !valid.unsupportedIds?.length ? saved : undefined;
      });
      const pendingIndexes=batch.map((_,i)=>i).filter(i=>!decisions[i]);
      if(options.stats) options.stats.reused += batch.length-pendingIndexes.length;
      if(pendingIndexes.length) {
        if(stopped || Date.now()+120_000>options.deadline) throw new EvalReviewPaused();
        const pending=pendingIndexes.map(i=>batch[i]);
        if(options.stats) { options.stats.requested += pending.length; options.stats.model_calls++; }
        const result=await work(pending);
        const valid=validateNotionEvidenceReview(pending,result,true);
        // Let the ordinary retry path handle malformed outputs. Previously
        // cached documents remain cached, so retries cannot cause duplicate work.
        if(!result || !valid) return null;
        let savedAny=false;
        for(let j=0;j<pending.length;j++) {
          const index=pendingIndexes[j],source=pending[j];
          const kind=['direct','adjacent','navigation','unrelated'].find(k=>Array.isArray(result[k]) && (result[k] as number[]).includes(j))!;
          const proof=valid.basis?.[source.id];
          const decision:Record<string,unknown>={direct:[],adjacent:[],navigation:[],unrelated:[],
            evidence:proof ? [{index:0,quote:proof.quote,reason:proof.reason}] : []};
          const issue=(result.review_issues as Record<string,string>|undefined)?.[String(j)];
          if(issue) decision.review_issues={'0':issue};
          decision[kind]=[0];
          decisions[index]=decision;
          if(!valid.unsupportedIds?.includes(source.id)) {
            options.entries[keys[index]]=decision;
            savedAny=true;
          }
        }
        if(savedAny) {
          writes=writes.then(options.save);
          try { await writes; }
          catch(error) {
            stopped=true;
            throw new EvalReviewPaused(`Checkpoint persistence failed: ${error instanceof Error ? error.message : 'unknown error'}`);
          }
        }
      }
      const combined:Record<string,unknown[]>={direct:[],adjacent:[],navigation:[],unrelated:[],evidence:[]};
      const issues:Record<string,string>={};
      decisions.forEach((decision,index)=>{
        for(const kind of ['direct','adjacent','navigation','unrelated']) {
          if((decision![kind] as number[]).includes(0)) combined[kind].push(index);
        }
        for(const item of (decision!.evidence ?? []) as Record<string,unknown>[]) combined.evidence.push({...item,index});
        const issue=(decision!.review_issues as Record<string,string>|undefined)?.['0'];
        if(issue) issues[String(index)]=issue;
      });
      return {...combined,review_issues:issues};
    }
  };
}
