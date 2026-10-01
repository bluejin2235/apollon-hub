import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotionDirectoryProject } from './notion-project-directory';
import { readRelationCandidates } from '@/lib/luna/notion-relation-navigation';

/** Actual directory names are lookup keys, never evidence of membership.
 * This reaches write-ups and reports filed outside their project's folder. */
export async function readProjectMentions(admin:SupabaseClient, projects:NotionDirectoryProject[]) {
  const names=[...new Set(projects.map(p=>p.key.replace(/^(?:\s*\d{2,6}\s+)+/,'').trim())
    .filter(name=>name.replace(/\s/g,'').length>=4))];
  const ids=new Set<string>();
  let complete=true;
  for(let start=0;start<names.length;start+=3) {
    await Promise.all(names.slice(start,start+3).map(async name=>{
      const pattern='%'+name.replace(/[\\%_]/g,'\\$&')+'%';
      for(let offset=0;;offset+=1000) {
        const {data,error}=await admin.from('luna_notion_chunks').select('page_id,chunk_id')
          .ilike('text',pattern).order('page_id').order('chunk_id').range(offset,offset+999);
        if(error) {complete=false;break;}
        for(const row of data??[]) if(row.page_id) ids.add(row.page_id);
        if(!data || data.length<1000) break;
      }
    }));
  }
  const hydrated=await readRelationCandidates(admin,[...ids]);
  return {...hydrated,complete,sources:hydrated.sources.map(s=>({...s,via_link:'project_mention'}))};
}
