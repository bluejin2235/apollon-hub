/** Mechanical checks complement semantic answer grading. Missing labels never
 * mean that retrieval completeness has been measured successfully. */
export type SearchExpectations = {
  required_notion_ids?: string[];
  forbidden_notion_ids?: string[];
  expect_empty?: boolean;
};

function notionPageId(href: string): string | null {
  try {
    const url = new URL(href);
    if (!/(^|\.)(notion\.so|notion\.com|notion\.site)$/.test(url.hostname)) return null;
    const hex = url.pathname.match(/(?:^|\/|-)([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i)?.[1]?.replace(/-/g,'').toLowerCase();
    return hex ? `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` : null;
  } catch { return null; }
}
type SourceCard = {type?:string;url?:string|null};
function notionCardIds(cards: SourceCard[]): string[] {
  return cards.filter(card=>card.type==='notion').map(card=>notionPageId(card.url??'') ?? `unidentified:${card.url??''}`);
}
export function inspectSearchStream(wire: string, finalIds: string[], finalCards: SourceCard[] = []) {
  const shown = new Set<string>();
  for (const line of wire.split('\n')) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try { event=JSON.parse(line); } catch { break; }
    if (event.type==='search_snapshot' || event.type==='meta') {
      for (const source of Array.isArray(event.notion_sources) ? event.notion_sources : []) {
        if(source && typeof source.id==='string') shown.add(source.id);
      }
      for(const id of notionCardIds(Array.isArray(event.cards) ? event.cards : [])) shown.add(id);
    }
    if (event.type==='meta') break;
  }
  const final=new Set([...finalIds,...notionCardIds(finalCards)]);
  return {shownIds:[...shown], disappearedIds:[...shown].filter(id=>!final.has(id))};
}
export function assessSearchQuality(input: {
  expected: SearchExpectations | null;
  finalIds: string[];
  reviewed?: {direct?:string[];adjacent?:string[]}|null;
  unverifiedIds?:string[];
  disappearedIds?:string[];
  aliases?:Record<string,string>;
  navigationComplete?:boolean;
  finalCards?:SourceCard[];
  answer?:string;
}) {
  const cardIds=notionCardIds(input.finalCards??[]);
  const final=new Set([...input.finalIds,...cardIds]), expected=input.expected;
  const approved=new Set([...(input.reviewed?.direct??[]),...(input.reviewed?.adjacent??[])]);
  const present=(id:string)=>final.has(id) || Boolean(input.aliases?.[id] && final.has(input.aliases[id]));
  const missing=(expected?.required_notion_ids??[]).filter(id=>!present(id));
  const forbidden=(expected?.forbidden_notion_ids??[]).filter(present);
  const omittedApproved=[...approved].filter(id=>!final.has(id));
  const unapproved=input.reviewed ? [...final].filter(id=>!approved.has(id)) : [];
  const disappeared=input.disappearedIds??[];
  const incompleteReview=input.unverifiedIds??[];
  const unexpectedNonempty=expected?.expect_empty===true && final.size>0;
  const hasLabels=Boolean(expected && ((expected.required_notion_ids?.length??0)>0 || (expected.forbidden_notion_ids?.length??0)>0 || expected.expect_empty===true));
  const incompleteNavigation=input.navigationComplete===false;
  const invalidAnswerLinks=[...(input.answer??'').matchAll(/\[[^\]\n]*\]\((https?:\/\/[^\s)]+)\)/g)]
    .map(match=>match[1]).filter(href=>{
      let url:URL;try{url=new URL(href);}catch{return false;}
      if(!/(^|\.)(notion\.so|notion\.com|notion\.site)$/.test(url.hostname))return false;
      const id=notionPageId(href);return !id || !present(id);
    });
  return {pass:![missing,forbidden,omittedApproved,unapproved,disappeared,incompleteReview,invalidAnswerLinks].some(a=>a.length>0)&&!unexpectedNonempty&&!incompleteNavigation,
    labeled:hasLabels,missing,forbidden,omittedApproved,unapproved,disappeared,incompleteReview,unexpectedNonempty,
    incompleteNavigation,invalidAnswerLinks,
    recall:expected?.required_notion_ids?.length ? 1-missing.length/expected.required_notion_ids.length : null};
}

/** Only final displayed evidence belongs in the semantic grader's source list.
 * Retrieval/debug traces contain rejected candidates and must stay in the audit
 * record, not masquerade as citations in the answer being graded. */
export function semanticSourceEvidence(validation: ReturnType<typeof assessSearchQuality>,
  sources: Array<{id:string;title:string;excerpt?:string|null}>,
  review?: {basis?:Record<string,{quote:string;reason:string}>;direct?:string[];adjacent?:string[]}|null,
  wiki: Array<{slug:string;section_id?:string;excerpt?:string}> = []) {
  const ids=new Set(sources.map(source=>source.id));
  return {source_validation:validation,wiki,notion:sources.map(source=>({id:source.id,title:source.title,excerpt:source.excerpt})),
    review:review ? {
      direct:(review.direct??[]).filter(id=>ids.has(id)),
      adjacent:(review.adjacent??[]).filter(id=>ids.has(id)),
      basis:Object.fromEntries(Object.entries(review.basis??{}).filter(([id])=>ids.has(id)))
    } : null};
}
