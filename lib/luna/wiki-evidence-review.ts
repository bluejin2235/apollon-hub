import type { WikiDoc } from '@/lib/wiki/types';
import type { WikiSourceRef } from '@/lib/luna/wiki-match';
import type { NotionSource } from '@/lib/luna/notion';
import type { ReadNotionEvidence } from '@/lib/luna/notion-page-evidence';
import { reviewEvidenceDocuments } from '@/lib/luna/evidence-document-review';

type Reviewer = (sources: NotionSource[]) => Promise<Record<string, unknown> | null>;

/** Wiki retrieval scores are candidates, not a relevance approval. Read complete
 * sections before allowing either prompt injection or a visible citation. */
export async function reviewWikiEvidence(
  sources: WikiSourceRef[], docs: WikiDoc[], review: Reviewer, verify?: Reviewer
) {
  const originals = new Map<string, WikiSourceRef>();
  const evidence: ReadNotionEvidence[] = sources.map(source => {
    const id = `wiki:${source.slug}:${source.section_id}`;
    originals.set(id, source);
    const doc = docs.find(d => d.slug === source.slug);
    const body = doc?.sections.find(s => s.id === source.section_id)?.body;
    const passages: string[] = [];
    if (body) for (let start = 0; start < body.length; start += 5600) passages.push(body.slice(start, start + 6000));
    return {id, title: `${source.title} / ${source.section_title}`, url: source.path,
      excerpt: body?.slice(0, 2400) ?? '', evidence_passages: passages,
      evidence_state: body?.trim() ? 'complete' : 'missing'};
  });
  const checked = await reviewEvidenceDocuments(evidence, review, verify);
  return {...checked, sources: [...checked.direct, ...checked.adjacent].map(source => ({
    ...originals.get(source.id)!, excerpt: source.excerpt ?? ''
  }))};
}
