const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {expandSourcesViaLinks,loadPagesByIds}=loadTs('lib/luna/search-secondary.ts');
const page=(id,archived=false)=>({page_id:id,title:id,archived,parent_id:null,path_titles:[],nas_path:null,url:null,last_edited_time:null});
const link=(from,to,kind='same',toType='notion_page')=>({from_type:'notion_page',from_id:from,to_type:toType,to_id:to,kind,confidence:0.95,status:'active',evidence:{}});
test('large project inventories split excerpt requests without losing later pages',async()=>{
 const ids=Array.from({length:241},(_,i)=>'page-'+i);
 const client=fakeDb({luna_notion_pages:ids.map(id=>page(id)),luna_notion_chunks:ids.map(id=>({page_id:id,position:0,text:'본문 '+id}))});
 const result=await loadPagesByIds(client,ids);
 const calls=client.calls.filter(c=>c.table==='luna_notion_chunks');
 assert.equal(calls.length,4);
 assert.ok(calls.every(c=>c.filters.find(f=>f[0]==='page_id')[2].length<=80));
 assert.equal(result.size,241);assert.equal(result.get('page-240').excerpt,'본문 page-240');
});
test('expanded page receives only its own bounded indexed excerpt in position order',async()=>{
 const client=fakeDb({luna_links:[link('seed','related')],luna_notion_pages:[page('related')],
 luna_notion_chunks:[{page_id:'unrelated',position:0,text:'Wrong evidence'},{page_id:'related',position:1,text:'Second'},
 {page_id:'related',position:0,heading:'Heading',text:'First'}]});
 const result=await expandSourcesViaLinks(client,[{id:'seed',title:'Seed'}]);
 assert.equal(result.sources[0].excerpt,'Heading First Second');
});
test('archived linked pages are not hydrated or returned',async()=>{
 const client=fakeDb({luna_links:[link('seed','archived')],luna_notion_pages:[page('archived',true)],
 luna_notion_chunks:[{page_id:'archived',position:0,text:'Old evidence'}]});
 assert.deepEqual((await expandSourcesViaLinks(client,[{id:'seed',title:'Seed'}])).sources,[]);
 assert.ok(!client.calls.some(c=>c.table==='luna_notion_chunks'));
});
test('excerpt lookup failure leaves a metadata-only candidate without fabricated evidence',async()=>{
 const client=fakeDb({luna_links:[link('seed','related')],luna_notion_pages:[page('related')]},
 {luna_notion_chunks:{message:'offline'}});
 assert.equal((await expandSourcesViaLinks(client,[{id:'seed',title:'Seed'}])).sources[0].excerpt,null);
});
test('query blocks unrelated project sibling expansion',async()=>{
 const client=fakeDb({luna_links:[link('seed','Other Project','belongs','project'),link('sibling','Other Project','belongs','project')],
 luna_notion_pages:[page('sibling')]});
 assert.equal((await expandSourcesViaLinks(client,[{id:'seed',title:'Other Project'}])).sources.length,1);
 assert.equal((await expandSourcesViaLinks(client,[{id:'seed',title:'Other Project'}],{query:'Target ProjectX'})).sources.length,0);
});
test('production index search passes the question into relation expansion',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../lib/luna/notion-index-search.ts'),'utf8');
 assert.match(source,/expandSourcesViaLinks\(admin, persp\.sources,\s*\{\s*query: queryText \|\| keywords/);
});
test('broad subject search follows a verified project from body evidence without its name in the question',async()=>{
 const client=fakeDb({luna_links:[link('seed','Sample Night Park','belongs','project'),link('sibling','Sample Night Park','belongs','project')],
 luna_notion_pages:[page('sibling')],luna_notion_chunks:[{page_id:'sibling',position:0,text:'최종보고와 현장 조명 테스트'}]});
 const seed={id:'seed',title:'Nightwalk Ideation',excerpt:'숲과 자연을 활용하는 야간 산책 공간'};
 const result=await expandSourcesViaLinks(client,[seed],{query:'숲 자료 모두 찾아줘'});
 assert.equal(result.sources.length,1);
 assert.equal(result.sources[0].project_key,'Sample Night Park');
 assert.match(result.sources[0].excerpt,/현장 조명 테스트/);
});
