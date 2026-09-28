import type { NotionSource } from '@/lib/luna/notion';
import type { GroundedTarget } from '@/lib/luna/grounded-target';
import { notionCitationMarker } from '@/lib/luna/source-citations';

const compact = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const performed = /(?:기획|연출|제작|개발|설계)(?:했|하였)|(?:produced|created|directed|designed)\s+by/i;
const citation = (s: NotionSource) => `[${s.title.replace(/[\[\]\n]/g, ' ')}](${s.url}) ${notionCitationMarker(s.id)}`;

/** Project a verified identity relation and verbatim role evidence, not an inferred owner. */
export function provenanceResultAnswer(sources: NotionSource[], targets: GroundedTarget[]): string | null {
  const blocks: string[] = [];
  const used = new Set<string>();
  for (const target of targets) {
    if (targets.some(other => compact(other.alias) === compact(target.alias) && compact(other.name) !== compact(target.name))) continue;
    const mentions = (text: string) => [target.name, target.alias].some(name => compact(text).includes(compact(name)));
    const evidence = sources.flatMap(source => (source.excerpt ?? '').split(/(?<=[.!?])\s+|\n/)
      .filter(sentence => compact(sentence).includes(compact(target.name)) && performed.test(sentence))
      .map(quote => ({source, quote})))[0];
    if (!evidence) continue;
    const related = sources.filter(source => source.id !== evidence.source.id && mentions(source.excerpt ?? ''));
    if (!related.length) continue;
    used.add(evidence.source.id);
    related.forEach(source => used.add(source.id));
    blocks.push(`**${target.name} (${target.alias})**\n\n제작·기획 역할을 확인할 수 있는 원문:\n> ${evidence.quote.trim()}\n\n${citation(evidence.source)}\n\n같은 작품을 언급한 자료:\n${related.map(source => `- ${citation(source)}`).join('\n')}\n\n위 자료에서 별칭으로 언급된 작품도 **${target.name}**입니다. 문서에서 참고 사례로 사용됐다는 이유로 별도의 외부 제작물로 나누지 않습니다.`);
  }
  if (!blocks.length) return null;
  const remaining = sources.filter(source => !used.has(source.id));
  return `원문에서 확인된 작품 관계와 제작 역할을 기준으로 정리했습니다.\n\n${blocks.join('\n\n')}\n\n${remaining.length ? `**제작 주체 추가 확인 대상**\n${remaining.map(citation).join('\n')}\n\n` : ''}외부 제작물 분류는 외부 제작 주체가 명시된 근거를 확보한 뒤 확정해야 합니다. 이번 정리는 답변에 사용한 ${sources.length}개 자료의 범위입니다.`;
}
