import type { LunaCard } from '@/lib/luna/tavily';
import type { NotionSource } from '@/lib/luna/notion';
import { reviewAllNotionEvidence } from '@/lib/luna/notion-evidence-review';

/** A path proves a retrievable location, never the contents of the original. */
export async function reviewNasMaterialCards(cards: LunaCard[], reviewer: (sources:NotionSource[])=>Promise<Record<string,unknown>|null>) {
  const candidates=cards.filter(card=>card.type==='nas' && Boolean(card.raw_path));
  const sources=candidates.map((card,index):NotionSource=>({id:`nas-location:${index}`,title:card.title,url:'',
    excerpt:`원본 내용은 읽지 않음. 파일명과 저장 위치만 확인됨.\n${card.title}\n${card.raw_path}`,nas_path:card.raw_path}));
  const review=await reviewAllNotionEvidence(sources,reviewer);
  const ids=new Set([...review.direct,...review.adjacent].map(source=>source.id));
  const selected=candidates.filter((_,index)=>ids.has(`nas-location:${index}`));
  const escape=(text:string)=>text.replace(/[\r\n]+/g,' ').replace(/[\\\[\]*_`<>]/g,'\\$&');
  const answer=selected.length ? `\n\n## Work서버 자료 위치\n\n파일명과 경로에서 요청 조건을 확인했습니다. 원본 내용을 열어 검증한 것은 아닙니다.\n\n${selected.map(card=>`- **${escape(card.title)}**\n  - 경로: ${escape(card.raw_path!)}`).join('\n')}` : '';
  return {cards:selected,answer,reviewedIds:review.reviewedIds,unverifiedIds:review.unverifiedIds};
}
