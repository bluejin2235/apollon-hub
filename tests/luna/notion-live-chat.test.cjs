const test=require('node:test');const assert=require('node:assert/strict');const {loadTs}=require('./helpers.cjs');
const policy=loadTs('lib/luna/notion-live/policy.ts');
function fixture({owned=true,connected=true,notionFailure=false}={}){
 const calls=[],saved=[],started=new Set();let resolveAll;const all=new Promise(r=>resolveAll=r);
 const begin=async key=>{started.add(key);if(started.size===3)resolveAll();await all;};
 const admin={from(table){calls.push(table);let write=null;const b={select(){return b},is(){return b},eq(){return b},order(){return b},limit(){return b},maybeSingle(){return b},insert(v){write=v;saved.push(...v);return b},update(v){write=v;return b},then(resolve){return Promise.resolve({data:write?[]:table==='luna_conversations'?(owned?{id:'c'}:null):[],error:null}).then(resolve)}};return b}};
 const overrides={
  '@anthropic-ai/sdk':class{},'next/server':{NextResponse:{json:(body,init)=>new Response(JSON.stringify(body),init)}},
  '@/lib/auth/get-api-user':{getApiUser:async()=>({id:'user-a'}),getServiceSupabase:()=>admin},
  '@/lib/luna/beta-access':{hasLunaAccess:async()=>true},
  '@/lib/luna/focused-search':{executeFocusedSearch:()=>{throw Error('not docs')}},
  './policy':policy,'./connection':{connectionRow:async()=>connected?{user_id:'user-a'}:null},
  './search':{searchLiveNotion:async(_a,uid)=>{assert.equal(uid,'user-a');await begin('notion');if(notionFailure)throw new policy.NotionConnectionError('scope_unverified','scope blocked');return [{id:'n',title:'allowed',url:'https://www.notion.so/abc',excerpt:'verified evidence'}]}},
  '@/lib/luna/embedding':{createQueryEmbedding:async()=>[1]},
  '@/lib/luna/media-index-search':{searchMediaForLuna:async()=>{await begin('images');return {cards:[]}}},
  '@/lib/luna/workserver-explore':{exploreWorkserverFallback:async()=>{await begin('nas');return [{path:'T:\\Work\\project',type:'folder'}]}},
  '@/lib/luna/ask-what':{parseAskedWhat:()=>({})},
  '@/lib/luna/engine':{getTierModel:async()=>({provider:'openai',model_id:'configured'}),resolveProviderModel:v=>v},
  '@/lib/luna/llm/client':{llmStreamText:async function*(opts){assert.ok(!opts.user.includes('private-secret'));yield {delta:'grounded report'}}},
  '@/lib/luna/env-keys':{anthropicApiKey:()=>null}
 };
 const {liveChat}=loadTs('lib/luna/notion-live/chat.ts',overrides);
 const request=()=>new Request('https://hub.apollonworks.com/api/luna/chat',{method:'POST',body:JSON.stringify({conversation_id:'c',message:'project',search_mode:'docs'})});
 return {liveChat,request,calls,saved,started};
}
test('conversation owner and user grant are required before any retrieval',async()=>{
 for(const config of [{owned:false},{connected:false}]){const f=fixture(config);const r=await f.liveChat(f.request());assert.equal(r.status,config.owned===false?404:409);assert.equal(f.started.size,0);assert.equal(f.saved.length,0)}
});
test('Notion, NAS and images start in parallel and only the authenticated result is persisted',async()=>{
 const f=fixture();const r=await f.liveChat(f.request());const text=await r.text();assert.match(text,/grounded report/);assert.equal(f.started.size,3);assert.equal(f.saved.length,2);assert.equal(f.saved[1].metadata.search_policy,policy.LIVE_NOTION_POLICY);assert.ok(!f.calls.some(t=>/notion_(pages|blocks|chunks)|learning|wiki/.test(t)));
});
test('scope failure excludes all Notion evidence but returns actual NAS results with a warning',async()=>{
 const f=fixture({notionFailure:true});const r=await f.liveChat(f.request());const text=await r.text();assert.match(text,/scope blocked/);assert.deepEqual(f.saved[1].metadata.notion_sources,[]);assert.equal(f.saved[1].metadata.cards.length,1);
});
