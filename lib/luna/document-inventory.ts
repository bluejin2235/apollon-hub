import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotionSource } from '@/lib/luna/notion';
import { readIndexedNotionEvidence, type ReadNotionEvidence } from '@/lib/luna/notion-page-evidence';
import { reviewEvidenceDocuments } from '@/lib/luna/evidence-document-review';
import { loadNotionRelationGraph, readRelationCandidates } from '@/lib/luna/notion-relation-navigation';
import { readDirectoryMaterials, requestedDirectoryProjects, type NotionDirectoryProject } from '@/lib/luna/notion-project-directory';
import { readProjectMentions } from '@/lib/luna/notion-project-mentions';
import type { EvidenceReviewer } from '@/lib/luna/notion-evidence-review';

type Reviewer = EvidenceReviewer;

/** Only complete, identical bodies can share a review. Never merge by title alone. */
function duplicateKey(source: ReadNotionEvidence): string | null {
  if (source.evidence_state !== 'complete') return null;
  const body=(source.evidence_passages ?? []).join('\n').replace(/\s+/g,' ').trim();
  if(body.length<120) return null;
  return source.title.replace(/\s*\(\d+\)$/, '').trim().toLowerCase()+'\n'+body;
}
function canonicalPreference(source: NotionSource): number {
  const path=(source.path_titles ?? []).join('/');
  return (/backup|백업|사본/i.test(path) ? -10 : 0)+(/사업개발/.test(path) ? 1 : 0);
}

/** Traverse grounded project memberships and explicit relations to a fixed point.
 * Empty relation pages are navigation only; failed/missing bodies remain visible
 * in coverage. Neither summary length nor citations decide inventory membership. */
export async function buildDocumentInventory(admin: SupabaseClient, input: {
  query: string; sources: NotionSource[]; directory: NotionDirectoryProject[]; review: Reviewer; verify?: Reviewer;
}) {
  const graph=await loadNotionRelationGraph(admin);
  const seen=new Set<string>(), reached=new Set<string>(), walked=new Set<string>();
  const inspected=new Map<string,ReadNotionEvidence>();
  const keys=new Map<string,string>(), aliases:Record<string,string>={};
  const direct=new Map<string,NotionSource>(), adjacent=new Map<string,NotionSource>();
  const basis:Record<string,{quote:string;reason:string}>={};
  const reviewed=new Set<string>(), unverified=new Set<string>(), unavailable=new Set<string>();
  const requestedMembers=new Set(requestedDirectoryProjects(input.directory,input.query).flatMap(p=>p.pageIds));
  const plannedProjects=new Set(input.sources.filter(s=>s.via_link==='project_directory').map(s=>s.project_key));
  const locationOnlyIds:string[]=[];
  const failures:Record<string,string>={};
  let navigationComplete=graph.complete;
  let candidates=input.sources;
  while(candidates.length) {
    const pending=[...new Map(candidates.filter(s=>!seen.has(s.id)).map(s=>[s.id,s])).values()].map(source=>{
      const memberships=input.directory.filter(project=>project.pageIds.includes(source.id));
      const ancestry=memberships.filter(project=>project.ancestorPageIds?.includes(source.id)).map(project=>project.key);
      return {...source,project_memberships:memberships.map(project=>project.key),project_ancestry:ancestry,
        project_key:ancestry.length===1 ? ancestry[0] : source.project_key};
    });
    if(!pending.length) break;
    pending.forEach(s=>seen.add(s.id));
    const read=await readIndexedNotionEvidence(admin,pending,input.query,true);
    const unique:ReadNotionEvidence[]=[];
    for(const source of read) {
      inspected.set(source.id,source);
      const key=duplicateKey(source), existing=key ? keys.get(key) : null;
      if(existing) aliases[source.id]=existing;
      else { if(key) keys.set(key,source.id); unique.push(source); }
    }
    const locations=unique.filter(source=>{
      if(!requestedMembers.has(source.id) || source.evidence_state!=='complete') return false;
      const lines=(source.evidence_passages??[]).join('\n').split('\n').map(s=>s.trim()).filter(Boolean);
      return lines.some(line=>/^(?:[a-z]:[\\/]|\\\\)/i.test(line)) && lines.every(line=>line===source.title || /^(?:[a-z]:[\\/]|\\\\)/i.test(line));
    });
    // A known project/path proves location, not the requested artifact or phase.
    // Apply the same relevance contract instead of promoting every member.
    const checked=await reviewEvidenceDocuments(unique,input.review,input.verify);
    checked.direct.forEach(s=>direct.set(s.id,s));checked.adjacent.forEach(s=>adjacent.set(s.id,s));
    Object.assign(basis,checked.basis);
    for(const source of locations) {
      if(!direct.has(source.id) && !adjacent.has(source.id)) continue;
      locationOnlyIds.push(source.id);
      if(basis[source.id]) basis[source.id].reason += ' 원본 자료의 위치만 확인했으며 원본 내용과 결과는 아직 확인하지 않음.';
    }
    Object.assign(failures,checked.failures);
    checked.reviewedIds.forEach(id=>reviewed.add(id));checked.unverifiedIds.forEach(id=>unverified.add(id));
    const navigation=new Set<string>(checked.navigationIds);
    for(const source of read) {
      const canonical=aliases[source.id] ?? source.id;
      if(canonical!==source.id) {
        if(unverified.has(canonical)) unverified.add(source.id); else reviewed.add(source.id);
      }
      if(direct.has(canonical) || adjacent.has(canonical) || source.evidence_state==='empty' || source.evidence_state==='missing') navigation.add(source.id);
    }
    // A useful reference justifies reading that record and its explicit links,
    // not recursively opening every member of every derived project membership.
    // Whole-project expansion needs direct evidence in its actual ancestry (or
    // an explicit directory selection). Retain adjacent records in the answer.
    const projects=input.directory.filter(project=>{
      if(reached.has(project.key)) return false;
      if(plannedProjects.has(project.key)) return true;
      return project.pageIds.some(id=>{
        const ancestry=inspected.get(id)?.project_ancestry;
        return navigation.has(id) && direct.has(aliases[id] ?? id) && (!ancestry?.length || ancestry.includes(project.key));
      });
    });
    projects.forEach(p=>reached.add(p.key));
    const linkedIds=new Set<string>();
    for(const id of navigation) {
      if(walked.has(id)) continue;
      walked.add(id);
      for(const neighbour of graph.neighbours.get(id) ?? []) if(!seen.has(neighbour)) linkedIds.add(neighbour);
    }
    const [members,linked,mentions]=await Promise.all([
      projects.length ? readDirectoryMaterials(admin,projects,input.query) : Promise.resolve([]),
      readRelationCandidates(admin,[...linkedIds]),
      projects.length ? readProjectMentions(admin,projects) : Promise.resolve({sources:[],unavailable:[],complete:true})
    ]);
    navigationComplete &&= mentions.complete;
    linked.unavailable.forEach(id=>{unavailable.add(id);seen.add(id);});
    mentions.unavailable.forEach(id=>unavailable.add(id));
    candidates=[...members,...linked.sources,...mentions.sources].filter(s=>!seen.has(s.id));
  }
  // Prefer a current page over an exact backup, retaining every equivalent ID in
  // the audit trail. Changed revisions have different keys and remain separate.
  const replacements=new Map<string,string>();
  for(const [alias,original] of Object.entries(aliases)) {
    const best=replacements.get(original) ?? original;
    if(canonicalPreference(inspected.get(alias)!)>canonicalPreference(inspected.get(best)!)) replacements.set(original,alias);
  }
  const finalAliases:Record<string,string>={};
  for(const [alias,original] of Object.entries(aliases)) {
    const best=replacements.get(original) ?? original;
    if(alias!==best) finalAliases[alias]=best;
    if(original!==best) finalAliases[original]=best;
  }
  const remap=(items:Map<string,NotionSource>)=>[...items.values()].map(source=>{
    const target=replacements.get(source.id);
    if(!target) return source;
    const {evidence_passages,evidence_state,...preferred}=inspected.get(target)!;
    basis[target]=basis[source.id];delete basis[source.id];
    return {...preferred,excerpt:source.excerpt};
  });
  return {direct:remap(direct),adjacent:remap(adjacent),basis,
    reviewedIds:[...reviewed],unverifiedIds:[...unverified],aliases:finalAliases,
    navigationComplete,unavailableIds:[...unavailable],failures,locationOnlyIds,
    inspected:[...inspected.values()].map(({evidence_passages,evidence_state,...source})=>source),
    reachedProjects:[...reached]};
}
