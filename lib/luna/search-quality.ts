/** Mechanical checks complement semantic answer grading. Missing labels never
 * mean that retrieval completeness has been measured successfully. */
export type SearchExpectations = {
  required_notion_ids?: string[];
  forbidden_notion_ids?: string[];
  expect_empty?: boolean;
};
export function inspectSearchStream(wire: string, finalIds: string[]) {
  const shown = new Set<string>();
  for (const line of wire.split('\n')) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try { event=JSON.parse(line); } catch { break; }
    if (event.type==='search_snapshot' || event.type==='meta') {
      for (const source of Array.isArray(event.notion_sources) ? event.notion_sources : []) {
        if(source && typeof source.id==='string') shown.add(source.id);
      }
    }
    if (event.type==='meta') break;
  }
  const final=new Set(finalIds);
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
}) {
  const final=new Set(input.finalIds), expected=input.expected;
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
  return {pass:![missing,forbidden,omittedApproved,unapproved,disappeared,incompleteReview].some(a=>a.length>0)&&!unexpectedNonempty&&!incompleteNavigation,
    labeled:hasLabels,missing,forbidden,omittedApproved,unapproved,disappeared,incompleteReview,unexpectedNonempty,
    incompleteNavigation,
    recall:expected?.required_notion_ids?.length ? 1-missing.length/expected.required_notion_ids.length : null};
}
