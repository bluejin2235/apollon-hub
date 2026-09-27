const test=require('node:test'),assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {loadTs}=require('./helpers.cjs');
const {expandSourcesViaLinks}=loadTs('lib/luna/search-secondary.ts');
const {postgrestTextList}=loadTs('lib/luna/postgrest-text-list.ts');

// Real supabase-js request construction, controlled response transport.
test('relation expansion escapes NAS endpoint and project identities in both directions',async()=>{
 const nas='T:\\Fixture (Draft)\\Media,Images\\quote"name.pdf';
 const project='Fixture \\ Project "A", (2026)';
 const requests=[];
 const link=(from_type,from_id,to_type,to_id,kind)=>({from_type,from_id,to_type,to_id,kind,status:'active',confidence:0.95,evidence:{}});
 const db=createClient('https://example.invalid','placeholder',{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:async input=>{
   const url=new URL(String(input)),q=url.searchParams;requests.push(q);
   let rows=[];
   if(url.pathname.endsWith('/luna_links')){
    if(q.has('from_id')){
     assert.equal(q.get('from_id'),'in.'+postgrestTextList(['seed',nas]));
     rows=[link('nas_path',nas,'notion_page','direct','same'),link('notion_page','seed','project',project,'belongs')];
    }else if(q.get('to_type')==='eq.project'){
     assert.equal(q.get('to_id'),'in.'+postgrestTextList([project]));
     rows=[link('notion_page','sibling','project',project,'belongs')];
    }else{
     assert.equal(q.get('to_id'),'in.'+postgrestTextList(['seed',nas]));
     rows=[link('notion_page','reverse','nas_path',nas,'same')];
    }
    assert.equal(q.get('status'),'eq.active');
   }else if(url.pathname.endsWith('/luna_notion_pages')){
    rows=['direct','reverse','sibling'].map(page_id=>({page_id,title:page_id,archived:false,path_titles:[],nas_path:null,last_edited_time:null}));
   }else if(url.pathname.endsWith('/luna_notion_chunks')){
    rows=['direct','reverse','sibling'].map(page_id=>({page_id,position:0,text:'Bounded source evidence'}));
   }else throw Error('Unexpected table '+url.pathname);
   return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json'}});
  }}
 });
 const result=await expandSourcesViaLinks(db,[{id:'seed',title:'Fixture',nas_path:nas}]);
 assert.deepEqual(result.sources.map(s=>s.id).sort(),['direct','reverse','sibling']);
 assert.equal(requests.filter(q=>q.has('to_id')||q.has('from_id')).length,3);
});
