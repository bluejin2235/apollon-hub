import type { NotionSource } from '@/lib/luna/notion';
import type { ReviewedNotionEvidence } from '@/lib/luna/notion-evidence-review';
import { notionCitationMarker } from '@/lib/luna/source-citations';

const plain=(text:string)=>text.replace(/[\r\n]+/g,' ').replace(/[\\\[\]*_`<>]/g,'\\$&');
function documentType(source:NotionSource):string {
  const title=source.title;
  if(/시험|테스트|test|검증/i.test(title)) return '시험·검증';
  if(/회의|미팅|meeting/i.test(title)) return '회의·협의';
  if(/보고|report/i.test(title)) return '보고서';
  if(/운영|유지보수|operation/i.test(title)) return '운영';
  if(/준공|시공/i.test(title)) return '시공·준공';
  if(/설계|도면|design/i.test(title)) return '설계';
  if(/기획|제안|컨셉|콘셉트|ideation|planning|concept/i.test(title)) return '기획·제안';
  return '관련 기록';
}

/** The reviewed inventory owns a lookup answer. A free-form summary must not
 * replace it with a few examples or ask the user to select the scope again.
 * Explicit analysis requests still use the model answer and inventory supplement.
 */
export function verifiedMaterialAnswer(query:string,review:ReviewedNotionEvidence):string|null {
  if(/비교|분석|평가|요약|차이|추천/.test(query)) return null;
  const blocks:string[]=[],seen=new Set<string>();
  const counts:Record<string,number>={};
  for(const [label,sources] of [['직접 관련 자료',review.direct],['인접 참고 자료',review.adjacent]] as const) {
    const projects=new Map<string,Map<string,string[]>>();
    for(const source of sources) {
      if(seen.has(source.id)) continue;
      let url:URL;
      try {url=new URL(source.url??'');}catch{continue;}
      if(url.protocol!=='https:' || !/(^|\.)(notion\.so|notion\.site|notion\.com)$/.test(url.hostname)) continue;
      seen.add(source.id);
      counts[label]=(counts[label] ?? 0)+1;
      const project=source.project_key || '기타 확인 자료';
      const group=projects.get(project) ?? new Map<string,string[]>();
      projects.set(project,group);
      const type=documentType(source),lines=group.get(type) ?? [];
      group.set(type,lines);
      const proof=review.basis?.[source.id];
      const href=url.href.replace(/\(/g,'%28').replace(/\)/g,'%29');
      lines.push(`- [${plain(source.title)}](${href})${notionCitationMarker(source.id)}${proof?.reason ? ` — ${plain(proof.reason)}` : ''}${proof?.quote ? `\n  - 본문 근거: “${plain(proof.quote)}”` : ''}`);
    }
    if(projects.size) blocks.push(`## ${label}\n\n`+[...projects].map(([project,types])=>`### ${plain(project)}\n\n`+[...types].map(([type,lines])=>`**${type}**\n\n${lines.join('\n')}`).join('\n\n')).join('\n\n'));
  }
  if(!seen.size) return null;
  const direct=counts['직접 관련 자료'] ?? 0,adjacent=counts['인접 참고 자료'] ?? 0;
  const intro=direct ? `직접 관련 문서 ${direct}개${adjacent ? `와 인접 참고 문서 ${adjacent}개` : ''}를 구분했습니다.`
    : `확인 범위에서 요청 조건에 직접 맞는 문서는 찾지 못했습니다. 관련성이 확인된 인접 참고 문서 ${adjacent}개를 구분해 제공합니다.`;
  return `${intro} 자료 유형은 제목에 명시된 표현을 기준으로 묶었습니다.\n\n${blocks.join('\n\n')}\n\n확인된 자료의 목록이며, 접근할 수 없는 원본이나 색인 밖의 자료까지 모두 확인했다는 뜻은 아닙니다.`;
}
