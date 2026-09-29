const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
function route({user={id:'admin'},allowed=true,running=null}={}) {
 const calls=[];
 const mod=loadTs('app/api/luna/notion/index/route.ts',{
  'next/server':{NextResponse:{json:(body,opts)=>({status:opts?.status??200,body})}},
  '@/lib/auth/get-api-user':{getApiUser:async()=>user,getServiceSupabase:()=>({})},
  '@/lib/luna/auth':{isSuperAdminUser:async()=>allowed},
  '@/lib/luna/notion-index-continue':{},
  '@/lib/luna/notion-index-runner':{getRunningNotionIndex:async()=>running,reindexSingleNotionPage:async(_,id)=>{calls.push(id);return {blocks:4,embeddings:2};}}
 });
 return {post:body=>mod.POST({json:async()=>body}),calls};
}
test('single-page repair requires authenticated superadmin and a valid page identity',async()=>{
 for(const [opts,status] of [[{user:null},401],[{allowed:false},403]]) {
  const r=route(opts);assert.equal((await r.post({action:'repair',page_id:'x'})).status,status);assert.equal(r.calls.length,0);
 }
 const r=route();assert.equal((await r.post({action:'repair',page_id:'../../other'})).status,400);assert.equal(r.calls.length,0);
});
test('single-page repair blocks during full indexing and only repairs the requested page',async()=>{
 const id='33cc795f-b818-8013-be47-c7b5dcf1c4a3';
 const busy=route({running:{id:'run'}});assert.equal((await busy.post({action:'repair',page_id:id})).status,409);assert.equal(busy.calls.length,0);
 const r=route();const result=await r.post({action:'repair',page_id:id});assert.equal(result.status,200);assert.deepEqual(r.calls,[id]);assert.equal(result.body.blocks,4);
});
