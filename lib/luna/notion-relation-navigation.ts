import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotionSource } from '@/lib/luna/notion';

/** Notion's explicit relations are navigation, never evidence of relevance. */
export async function loadNotionRelationGraph(admin: SupabaseClient) {
  const neighbours = new Map<string, Set<string>>();
  for (let start=0;;start+=1000) {
    const {data,error}=await admin.from('luna_notion_relations')
      .select('from_page_id,to_page_id,property_name')
      .order('from_page_id').order('to_page_id').order('property_name').range(start,start+999);
    if(error) return {neighbours,complete:false};
    for (const row of data ?? []) {
      if (!row.from_page_id || !row.to_page_id) continue;
      for (const [from,to] of [[row.from_page_id,row.to_page_id],[row.to_page_id,row.from_page_id]]) {
        const ids=neighbours.get(from) ?? new Set<string>();
        ids.add(to);neighbours.set(from,ids);
      }
    }
    if(!data || data.length<1000) return {neighbours,complete:true};
  }
}

/** Only hydrate pages already accessible in the application's index. */
export async function readRelationCandidates(admin: SupabaseClient, ids: string[]) {
  const sources: NotionSource[]=[];
  const unavailable: string[]=[];
  for (let start=0;start<ids.length;start+=100) {
    const batch=ids.slice(start,start+100);
    const {data,error}=await admin.from('luna_notion_pages')
      .select('page_id,title,url,path_titles,parent_id,last_edited_time')
      .in('page_id',batch).eq('archived',false);
    const found=new Set<string>();
    if(!error) for(const page of data ?? []) {
      found.add(page.page_id);
      sources.push({id:page.page_id,title:page.title,url:page.url || `https://notion.so/${page.page_id.replace(/-/g,'')}`,
        path_titles:page.path_titles ?? [],parent_id:page.parent_id,last_edited_time:page.last_edited_time,
        link_expanded:true,via_link:'notion_relation'});
    }
    unavailable.push(...batch.filter(id=>!found.has(id)));
  }
  return {sources,unavailable};
}
