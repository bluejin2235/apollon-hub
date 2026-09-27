const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {expandSourcesViaLinks}=loadTs('lib/luna/search-secondary.ts');
const page=(id,archived=false)=>({page_id:id,title:id,archived,parent_id:null,path_titles:[],nas_path:null,url:null,last_edited_time:null});
const link=(from,to,kind='same',toType='notion_page')=>({from_type:'notion_page',from_id:from,to_type:toType,to_id:to,kind,confidence:0.95,status:'active',evidence:{}});
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
