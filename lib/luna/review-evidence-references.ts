import type { NotionSource } from '@/lib/luna/notion';
import { sliceUnicode } from '@/lib/luna/unicode-text';

/** Model selects immutable source spans instead of retyping a quotation.
 * The server still validates the resulting exact quote against the source. */
export function prepareReviewEvidence(sources: (NotionSource & {review_proposal?:{classification:string;quote?:string;reason?:string}})[], verify = false) {
  const spans = sources.map(source => {
    const text = (source.excerpt ?? '').replace(/\s+/g, ' ').trim();
    const result: string[] = [];
    for (let start = 0; start < text.length; start += 120) result.push(sliceUnicode(text, start, start + 160));
    return result;
  });
  return {
    // Verification must make an independent decision from the source. Showing
    // the previous application rationale anchors the verifier on that claim.
    text: sources.map((source, index) => `[${index}] ${source.title}\n확인된 소속: ${source.project_key ?? (source.path_titles ?? []).join(' / ')}${!verify && source.review_proposal ? `\n검증할 이전 판단 (원문이 아니며 사실로 간주하지 말 것): ${JSON.stringify(source.review_proposal)}` : ''}\n본문:\n${spans[index].map((text, span) => `[근거 ${span}] ${text}`).join('\n')}`).join('\n\n'),
    resolve(review: Record<string, unknown> | null): Record<string, unknown> | null {
      if (!review || !Array.isArray(review.evidence)) return review;
      const excluded = new Set<number>();
      const evidence = review.evidence.map(item => {
        if (!item || typeof item !== 'object') return item;
        const value = item as Record<string, unknown>;
        if (!Object.hasOwn(value, 'span')) return verify ? {...value, quote: ''} : value;
        const index = value.index, span = value.span;
        const quote = typeof index === 'number' && Number.isInteger(index) && typeof span === 'number' && Number.isInteger(span)
          ? spans[index]?.[span] : undefined;
        // Never fall back to a generated quote when a supplied reference is invalid.
        const adjacent = Array.isArray(review.adjacent) && review.adjacent.includes(index);
        // A visual motif can answer a visual-reference request directly, but
        // cannot become a transferable implementation fact by adding a caveat.
        if (verify && adjacent && ['visual_motif', 'general_description'].includes(String(value.fact_kind))) {
          if (typeof index === 'number') excluded.add(index);
          return {...value, quote: ''};
        }
        const factSpan = value.fact_span;
        const fact = typeof index === 'number' && Number.isInteger(index) && typeof factSpan === 'number' && Number.isInteger(factSpan)
          ? spans[index]?.[factSpan] : undefined;
        const transferable = value.relation === 'transferable_fact'
          && ['implementation_method','design_constraint','test_result','operation_condition'].includes(String(value.fact_kind))
          && typeof fact === 'string' && fact.length >= 12
          && typeof value.application === 'string' && value.application.trim().length >= 12
          && typeof value.limitation === 'string' && value.limitation.trim().length >= 8;
        // Missing transfer evidence is unresolved, so the normal retry path must
        // inspect it again; it must never silently become a supported reference.
        if (verify && adjacent && !transferable) return {...value, quote: ''};
        return {...value, quote: (verify && adjacent ? fact : quote) ?? '', ...(verify && adjacent ? {
          reason: `${value.application} 적용 한계: ${value.limitation}`
        } : {})};
      });
      return {...review,
        adjacent:Array.isArray(review.adjacent) ? review.adjacent.filter(index=>!excluded.has(index as number)) : review.adjacent,
        unrelated:Array.isArray(review.unrelated) ? [...review.unrelated,...excluded] : review.unrelated,
        evidence};
    }
  };
}

export const REVIEW_EVIDENCE_REFERENCE_RULE = `본문은 [근거 번호]로 나눠 제공한다. 포함하는 문서는 해당 문서의 관련성을 입증하는 근거 번호를 선택하고 이유를 쓴다. 인용문을 새로 쓰지 않는다. evidence 항목은 {"index":문서번호,"span":근거번호,"reason":"질문과 연결되는 구체적 이유"} 형식이다. 근거 번호는 해당 문서 안에서만 유효하다.`;

export const REVIEW_TRANSFER_RULE = `이 검증은 이전 판단 없이 원문에서 독립적으로 수행한다. 인접 여부를 정하기 전에 근거 자체의 종류를 분류한다.
adjacent 항목은 evidence에 fact_kind를 반드시 쓴다: implementation_method(실제로 구현하는 방법), design_constraint(설계 조건·수치·선정기준), test_result(실험·검증 결과), operation_condition(운영 조건), visual_motif(화면 묘사·상징·분위기), general_description(일반 소개·가능성).
화면에서 무엇이 보이는지는 visual_motif이고, 그것을 실제로 어떻게 설치·구현·검증하는지는 implementation_method 등이다. 광선·안개·원근·반사 등의 단어 자체는 구현 방법의 증거가 아니다. 분위기를 참고할 수 있다는 활용 설명이나 실제 설치 조건은 미확인이라는 단서를 붙여도 근거 종류가 바뀌지 않는다. visual_motif와 general_description만 있는 후보는 unrelated로 분류한다. 단, 질문이 그 시각적 소재 자체를 찾거나 특정 프로젝트 기록을 요청하면 직접 관련 기준으로 판단한다.
구체적 사실이 있는 adjacent 항목은 relation:"transferable_fact", fact_span:그 사실이 적힌 근거번호, application:"그 사실이 질문의 어느 작업에 어떻게 적용되는지", limitation:"원래 공간과 질문 공간의 차이 및 확인되지 않은 조건"을 반드시 쓴다.
먼저 실제 설치 공간과 화면 속 묘사 대상을 구분한다. '수풀 사이 빛', '몽환적 분위기', '외부 공간에 세계관 적용'은 시각적 목표나 소재이지 설치·설계 방식이 아니다. 소재를 구현하는 구체적 방법·조건이 없으면 unrelated로 분류한다. 다른 프로젝트의 콘셉트를 질문의 공간에 적용할 수 있다는 상상만으로는 fact_span을 채울 수 없다.
직접 관련은 질문의 실제 대상 환경과 작업이 원문에서 함께 확인되어야 한다. 특정 프로젝트의 실제 기획·테스트 경로 기록은 유지하고, 다른 환경이어도 조명 간섭·방수·수위·선정기준 등 옮겨 쓸 수 있는 구체적 근거는 인접으로 유지한다. 개수를 줄이는 것이 목표가 아니다.`;
