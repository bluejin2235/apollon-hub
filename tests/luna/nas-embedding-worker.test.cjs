const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {loadTs}=require('./helpers.cjs');
const {parseNasEmbeddingArgs}=loadTs('lib/luna/nas-embedding-options.ts');
const bounded=loadTs('lib/luna/bounded-embeddings.ts',{'@/lib/luna/embedding':{},'@/lib/luna/env-keys':{}});
const queue=loadTs('lib/luna/nas-embedding-queue.ts');
const row={id:'00000000-0000-4000-8000-000000000001',path:'fixture',seq:0,content:'source evidence',source_version:'2026-09-26T00:00:00Z'};
const vector=[1,...Array(1535).fill(0)];
async function run({apply=true,args=[],current=[row],storeResult={data:[row.id],error:null},providerError=null,readError=false,claim={data:true},release={data:true},startError=false}={}){
 const events=[],logs=[];let exit=0;
 const admin={async rpc(name,params){
  events.push({rpc:name,params});
  if(name==='nas_embedding_acquire_worker')return claim;
  if(name==='nas_embedding_release_worker')return release;
  if(name==='nas_embedding_candidates') return readError&&params.p_ids?{error:{message:'read failed'}}:{data:params.p_ids?current:[row],error:null};
  if(name==='nas_embedding_store_batch')return storeResult;
  throw Error('Unexpected RPC '+name);
 },from(){throw Error('No direct table fallback allowed');}};
 const deps={
  '@/lib/luna/nas-embedding-options':{parseNasEmbeddingArgs},
  '@/lib/luna/nas-error':loadTs('lib/luna/nas-error.ts'),
  '@/lib/luna/nas-embedding-queue':queue,
  '@/lib/luna/nas-embedding-gate':loadTs('lib/luna/nas-embedding-gate.ts',{'node:crypto':require('node:crypto')}),
  dotenv:{config(){}},'node:path':{resolve:()=>'/unused'},'@supabase/supabase-js':{createClient:()=>admin},
  '@/lib/luna/bounded-embeddings':{...bounded,createBoundedEmbeddingsBatch:async input=>{
   events.push({paid:true,input});if(providerError)throw providerError;return {vectors:input.map(()=>vector),tokens:2};}},
  '@/lib/luna/nas-text-runs':{startNasTextRun:async()=>{events.push({start:true});if(startError)throw Error('start failed');return 'run'},
   updateNasTextRunProgress:async()=>{},finishNasTextRun:async(_admin,_id,status,progress,error)=>events.push({status,progress:{...progress},error})}
 };
 const source=fs.readFileSync(path.join(__dirname,'../../scripts/embed-nas-chunks.ts'),'utf8');
 const code=ts.transpileModule(source.replace('main().catch((e) => {','globalThis.completion = main().catch((e) => {'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const ctx={require:n=>{if(!(n in deps))throw Error('Unmocked '+n);return deps[n]},exports:{},
  process:{argv:['node','script',...(apply?['--apply']:[]),'--limit=1',...args],env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SECRET_KEY:'fixture'},cwd:()=>'/unused',exit:n=>{exit=n}},
  console:{log:(...x)=>logs.push(x.join(' ')),warn:(...x)=>logs.push(x.join(' ')),error:(...x)=>logs.push(x.join(' '))}};
 vm.runInNewContext(code,ctx);await ctx.completion;return {events,exit,logs};
}
test('default preview does not pay, write data or create run receipts',async()=>{
 const r=await run({apply:false});assert.equal(r.exit,0,r.logs.join('\n'));
 assert.equal(r.events.length,1);assert.equal(r.events[0].rpc,'nas_embedding_candidates');
 assert.ok(r.logs.some(x=>x.includes('dry_run')));
});
test('over-budget run is rejected before run creation or payment',async()=>{
 const r=await run({args:['--max-cost-usd=0.000000001']});assert.equal(r.exit,1);
 assert.ok(!r.events.some(e=>e.paid||e.start||e.rpc==='nas_embedding_store_batch'));
});
test('invalidated source, edited content or revision change before payment is skipped without billing',async()=>{
 for(const current of [[],[{...row,content:'changed'}],[{...row,source_version:'2026-09-26T00:00:01Z'}]]){
  const r=await run({current});assert.equal(r.exit,0,r.logs.join('\n'));
  assert.ok(!r.events.some(e=>e.paid||e.rpc==='nas_embedding_store_batch'));
  assert.equal(r.events.find(e=>e.status).progress.skipped,1);
 }
});
test('revalidation failure cannot trigger paid fallback',async()=>{
 const r=await run({readError:true});assert.equal(r.exit,1);
 assert.ok(!r.events.some(e=>e.paid||e.rpc==='nas_embedding_store_batch'));
});
test('successful vectors use guarded RPC and count only acknowledged rows',async()=>{
 const r=await run();assert.equal(r.exit,0,r.logs.join('\n'));
 const write=r.events.find(e=>e.rpc==='nas_embedding_store_batch');
 assert.equal(write.params.p_rows[0].source_version,row.source_version);
 assert.equal(write.params.p_rows[0].content,row.content);
 const outcome=r.events.find(e=>e.status);assert.equal(outcome.status,'done');
 assert.equal(outcome.progress.embeddingsCreated,1);assert.equal(outcome.progress.ok,1);
});
test('source changed after paid response is skipped without overwriting or duplicate payment',async()=>{
 const r=await run({storeResult:{data:[],error:null}});assert.equal(r.exit,0);
 assert.equal(r.events.filter(e=>e.paid).length,1);
 const outcome=r.events.find(e=>e.status);assert.equal(outcome.progress.embeddingsCreated,0);
 assert.equal(outcome.progress.skipped,1);
});
test('storage/completion transaction failures are reported with acknowledged cost and no retry',async()=>{
 const r=await run({storeResult:{data:null,error:{message:'completion failed'}}});assert.equal(r.exit,1);
 const outcome=r.events.find(e=>e.status);assert.equal(outcome.status,'failed');assert.equal(outcome.progress.failed,1);
 assert.ok(outcome.progress.costUsd>0);assert.equal(r.events.filter(e=>e.paid).length,1);
 assert.equal(r.events.filter(e=>e.rpc==='nas_embedding_store_batch').length,1);
});
test('unknown provider usage is flagged and never automatically retried',async()=>{
 const r=await run({providerError:Error('timeout')});assert.equal(r.exit,1);
 assert.equal(r.events.filter(e=>e.paid).length,1);assert.ok(r.logs.some(x=>x.includes('usage unknown')));
 assert.equal(r.events.find(e=>e.status).status,'failed');
});
test('malformed storage receipt cannot become a successful run',async()=>{
 const r=await run({storeResult:{data:['unexpected-id'],error:null}});assert.equal(r.exit,1);
 assert.equal(r.events.find(e=>e.status).status,'failed');
});

test('selection keyset advances after 500 candidates and rejects duplicate/non-advancing responses',async()=>{
 const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');const calls=[];
 const admin={async rpc(name,params){calls.push(params);return {data:params.p_after_id?[{...row,id:id(501)}]:Array.from({length:500},(_,i)=>({...row,id:id(i+1)}))};}};
 assert.equal((await queue.selectNasEmbeddingQueue(admin,501)).length,501);
 assert.equal(calls[1].p_after_id,id(500));assert.equal(calls[1].p_limit,1);
 await assert.rejects(queue.selectNasEmbeddingQueue({rpc:async()=>({data:Array.from({length:500},()=>row)})},501),/Duplicate/);
});

test('busy, missing or ambiguous gate receipts reject before run creation and payment',async()=>{
 for(const claim of [{data:false},{data:null},{data:true,error:{message:'lost response'}}]){
  const r=await run({claim});assert.equal(r.exit,1);
  assert.ok(!r.events.some(e=>e.paid||e.start||e.rpc==='nas_embedding_release_worker'));
 }
});
test('successful worker releases only its own gate after terminal receipt',async()=>{
 const r=await run();assert.equal(r.exit,0);
 const claim=r.events.find(e=>e.rpc==='nas_embedding_acquire_worker');
 const release=r.events.find(e=>e.rpc==='nas_embedding_release_worker');
 assert.equal(release.params.p_owner,claim.params.p_owner);
 assert.ok(r.events.indexOf(claim)<r.events.findIndex(e=>e.paid));
 assert.ok(r.events.indexOf(release)>r.events.findIndex(e=>e.status==='done'));
});
test('pre-payment failure releases gate, unresolved paid requests retain it',async()=>{
 for(const opts of [{startError:true},{readError:true}]){
  const r=await run(opts);assert.equal(r.exit,1);
  assert.ok(r.events.some(e=>e.rpc==='nas_embedding_release_worker'));
  assert.ok(!r.events.some(e=>e.paid));
 }
 for(const opts of [{providerError:Error('timeout')},{storeResult:{error:{message:'lost storage reply'}}},{storeResult:{data:['wrong-id']}}]){
  const r=await run(opts);assert.equal(r.exit,1);
  assert.ok(!r.events.some(e=>e.rpc==='nas_embedding_release_worker'));
 }
});
test('unacknowledged gate release is not reported as successful process completion',async()=>{
 for(const release of [{data:false},{error:{message:'release failed'}}]){
  const r=await run({release});assert.equal(r.exit,1);
  assert.equal(r.events.filter(e=>e.paid).length,1);
  assert.ok(r.logs.some(x=>x.includes('release not acknowledged')));
 }
});
