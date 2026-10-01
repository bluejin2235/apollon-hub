/** Only the deterministic inventory format is rearranged. No source is deleted. */
export function splitMaterialInventoryDisplay(body:string) {
  if(!/^(?:관련성을 확인한 문서 \d+개|직접 관련 문서 \d+개|확인 범위에서 요청 조건에 직접 맞는 문서는)/.test(body.trim())) return null;
  const start=body.indexOf('\n## 인접 참고 자료\n');
  if(start<0) return body.includes('## 직접 관련 자료')
    ? {before:body,adjacent:'',after:'',count:0,initiallyOpen:false} : null;
  const from=start+1;
  const ends=[body.indexOf('\n## ',from+3),body.indexOf('\n확인된 자료의 목록이며',from)].filter(index=>index>=0);
  const end=ends.length ? Math.min(...ends) : body.length;
  const adjacent=body.slice(from,end).trim();
  const count=(adjacent.match(/^- \[/gm) ?? []).length;
  if(!count) return null;
  return {before:body.slice(0,start).trim(),adjacent,after:body.slice(end).trim(),count,
    // When there are no direct matches, keep the only available results visible.
    initiallyOpen:!body.slice(0,start).includes('## 직접 관련 자료')};
}

/** Long inventories stay complete while each project becomes independently
 * expandable. Small results remain ordinary text. Never split model prose. */
export function splitMaterialProjectGroups(text:string) {
  const headings=[...text.matchAll(/^### (.+)$/gm)];
  if(headings.length<2 || (text.match(/^- \[/gm) ?? []).length<=12) return null;
  const tail=text.indexOf('\n확인된 자료의 목록이며');
  const end=tail<0 ? text.length : tail;
  const groups=headings.filter(match=>match.index! < end).map((match,index,array)=>{
    const body=text.slice(match.index!+match[0].length,array[index+1]?.index ?? end).trim();
    return {title:match[1],body,count:(body.match(/^- \[/gm) ?? []).length,
      types:[...body.matchAll(/^\*\*([^*]+)\*\*$/gm)].map(type=>type[1]).join(' · ')};
  });
  if(groups.some(group=>!group.count)) return null;
  return {before:text.slice(0,headings[0].index).trim(),groups,after:text.slice(end).trim()};
}
