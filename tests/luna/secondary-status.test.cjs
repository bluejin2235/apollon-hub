const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {expandSourcesViaLinks}=loadTs('lib/luna/search-secondary.ts');
const seed={id:'seed',title:'Project',nas_path:null};
const page=id=>({page_id:id,title:id,archived:false,path_titles:[],parent_id:null,nas_path:null,url:null,last_edited_time:null});
const link=(from,to,status,kind='same',toType='notion_page')=>({from_type:'notion_page',from_id:from,to_type:toType,to_id:to,kind,confidence:0.95,status,evidence:{}});
test('direct and reverse expansion exclude pending and rejected links even at high confidence',async()=>{
 const links=[link('seed','approved','active'),link('seed','pending','pending'),link('reverse-pending','seed','pending'),link('rejected','seed','rejected')];
 const db=fakeDb({luna_links:links,luna_notion_pages:['approved','pending','reverse-pending','rejected'].map(page)});
 const result=await expandSourcesViaLinks(db,[seed]);
 assert.deepEqual(result.sources.map(s=>s.id),['approved']);assert.equal(result.stats.links_followed,1);
});
test('project sibling expansion uses active membership only',async()=>{
 const links=[link('seed','Project','active','belongs','project'),link('approved','Project','active','belongs','project'),link('pending','Project','pending','belongs','project')];
 const db=fakeDb({luna_links:links,luna_notion_pages:['approved','pending'].map(page)});
 const result=await expandSourcesViaLinks(db,[seed]);
 assert.deepEqual(result.sources.map(s=>s.id),['approved']);
});
