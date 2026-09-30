import { createHash } from 'node:crypto';
import type { NotionSource } from '@/lib/luna/notion';
import { validateNotionEvidenceReview } from '@/lib/luna/notion-evidence-review';

import { EvalReviewPaused } from '@/lib/luna/eval-continuation-control';

export type ReviewCheckpointEntries = Record<string, Record<string, unknown>>;
export type EvalReviewCheckpoint = {
  review: (identity: unknown, batch: NotionSource[], work: () => Promise<Record<string, unknown> | null>) => Promise<Record<string, unknown> | null>;
};

/** Run-local memoization only. Replay still passes through the ordinary body
 * evidence validator. No source text is written outside the private checkpoint. */
export function createEvalReviewCheckpoint(options: {
  entries: ReviewCheckpointEntries;
  deadline: number;
  save: () => Promise<void>;
}): EvalReviewCheckpoint {
  let stopped = false;
  let writes: Promise<void> = Promise.resolve();
  return {
    async review(identity, batch, work) {
      const key = createHash('sha256').update(JSON.stringify({identity, batch})).digest('hex');
      const saved = options.entries[key];
      if (saved) {
        const valid = validateNotionEvidenceReview(batch, saved, true);
        if (valid && !valid.unsupportedIds?.length) return saved;
      }
      if (stopped || Date.now() + 120_000 > options.deadline) throw new EvalReviewPaused();
      const result = await work();
      const valid = validateNotionEvidenceReview(batch, result, true);
      if (result && valid && !valid.unsupportedIds?.length) {
        options.entries[key] = result;
        // Serialize concurrent batch writes, and propagate failures rather than
        // report a saved checkpoint that the next worker cannot actually read.
        writes = writes.then(options.save);
        try { await writes; }
        catch (error) {
          stopped = true;
          throw new EvalReviewPaused(`Checkpoint persistence failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      return result;
    }
  };
}
