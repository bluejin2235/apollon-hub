/** Citation markers identify retrieved records; they do not prove semantic support. */
export function notionCitationMarker(id: string): string {
  const normalized = id.replace(/-/g, "").toLowerCase();
  return /^[a-f0-9]{32}$/.test(normalized)
    ? `<!--luna-source:notion:${normalized}-->` : "";
}

export function citedNotionIds(answer: string): Set<string> {
  // Ignore examples inside fenced code blocks.
  const prose = answer.replace(/```[\s\S]*?```/g, "");
  return new Set([...prose.matchAll(/<!--luna-source:notion:([a-f0-9]{32})-->/g)]
    .map(match => match[1]!));
}

export function hasNotionCitation(answer: string, id: string): boolean {
  const marker = notionCitationMarker(id);
  return Boolean(marker) && citedNotionIds(answer).has(id.replace(/-/g, "").toLowerCase());
}

/** Internal attribution stays in stored answers, but not in copied user-facing text. */
export function stripLunaSourceMarkers(answer: string): string {
  return answer.replace(/<!--luna-source:notion:[^>]*-->/g, "");
}

/** The model can describe a record, but cannot create its identity or URL. */
export function canonicalizeNotionAnswerLinks(answer:string, sources:Array<{id:string;title:string;url?:string|null}>):string {
  const compact=(id:string)=>id.replace(/-/g,'').toLowerCase();
  const ids=new Map(sources.map(s=>[compact(s.id),s]));
  const titleKey=(title:string)=>title.replace(/\\([\\\[\]*_`<>])/g,'$1').replace(/\s+/g,' ').trim();
  const titles=new Map<string,typeof sources>();
  for(const source of sources) {const key=titleKey(source.title);titles.set(key,[...(titles.get(key)??[]),source]);}
  const linked=answer.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,(original,label:string,href:string)=>{
    let url:URL;try{url=new URL(href);}catch{return original;}
    if(!/(^|\.)(notion\.so|notion\.site|notion\.com)$/.test(url.hostname)) return original;
    const id=url.pathname.match(/([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/|$)/i)?.[1];
    const byTitle=titles.get(titleKey(label));
    const source=(byTitle?.length===1 ? byTitle[0] : undefined) ?? (id ? ids.get(compact(id)) : undefined);
    if(!source) return label;
    const title=source.title.replace(/[\r\n]+/g,' ').replace(/[\\\[\]*_`<>]/g,'\\$&');
    return `[${title}](https://www.notion.so/${compact(source.id)})${notionCitationMarker(source.id)}`;
  });
  return linked.replace(/<!--luna-source:notion:([^>]*)-->/g,(marker,id:string)=>ids.has(id)?marker:'');
}
