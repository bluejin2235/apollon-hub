import type { NotionSource } from '@/lib/luna/notion';
import { sliceUnicode } from '@/lib/luna/unicode-text';

/** Model selects immutable source spans instead of retyping a quotation.
 * The server still validates the resulting exact quote against the source. */
export function prepareReviewEvidence(sources: (NotionSource & {review_proposal?:{classification:string;quote?:string;reason?:string}})[]) {
  const spans = sources.map(source => {
    const text = (source.excerpt ?? '').replace(/\s+/g, ' ').trim();
    const result: string[] = [];
    for (let start = 0; start < text.length; start += 120) result.push(sliceUnicode(text, start, start + 160));
    return result;
  });
  return {
    text: sources.map((source, index) => `[${index}] ${source.title}\n확인된 소속: ${source.project_key ?? (source.path_titles ?? []).join(' / ')}${source.review_proposal ? `\n검증할 이전 판단 (원문이 아니며 사실로 간주하지 말 것): ${JSON.stringify(source.review_proposal)}` : ''}\n본문:\n${spans[index].map((text, span) => `[근거 ${span}] ${text}`).join('\n')}`).join('\n\n'),
    resolve(review: Record<string, unknown> | null): Record<string, unknown> | null {
      if (!review || !Array.isArray(review.evidence)) return review;
      return {...review, evidence: review.evidence.map(item => {
        if (!item || typeof item !== 'object') return item;
        const value = item as Record<string, unknown>;
        if (!Object.hasOwn(value, 'span')) return value;
        const index = value.index, span = value.span;
        const quote = typeof index === 'number' && Number.isInteger(index) && typeof span === 'number' && Number.isInteger(span)
          ? spans[index]?.[span] : undefined;
        // Never fall back to a generated quote when a supplied reference is invalid.
        return {...value, quote: quote ?? ''};
      })};
    }
  };
}

export const REVIEW_EVIDENCE_REFERENCE_RULE = `본문은 [근거 번호]로 나눠 제공한다. 포함하는 문서는 해당 문서의 관련성을 입증하는 근거 번호를 선택하고 이유를 쓴다. 인용문을 새로 쓰지 않는다. evidence 항목은 {"index":문서번호,"span":근거번호,"reason":"질문과 연결되는 구체적 이유"} 형식이다. 근거 번호는 해당 문서 안에서만 유효하다.`;
