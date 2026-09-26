const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {parseNasEmbeddingArgs}=loadTs('lib/luna/nas-embedding-options.ts');
const {planEmbeddingRequests,embeddingCostUsd}=loadTs('lib/luna/bounded-embeddings.ts',{'@/lib/luna/embedding':{},'@/lib/luna/env-keys':{}});
test('default and full runs are bounded and read-only',()=>{
 assert.deepEqual(parseNasEmbeddingArgs([]),{limit:500,batchSize:100,kind:'incremental',apply:false,maxCostUsd:1});
 assert.equal(parseNasEmbeddingArgs(['--full']).apply,false);
 assert.equal(parseNasEmbeddingArgs(['--full']).limit,500);
});
test('paid execution requires an explicit switch with bounded limits',()=>{
 assert.deepEqual(parseNasEmbeddingArgs(['--limit=20','--batch=10','--apply']),{limit:20,batchSize:10,kind:'incremental',apply:true,maxCostUsd:1});
});
test('bad flags cannot silently start an unlimited run',()=>{
 for(const flag of ['--limit=0','--limit=-1','--limit=999999','--limit=abc','--batch=101','--apply=yes','--limt=5','--max-cost-usd=0','--max-cost-usd=50','--max-cost-usd=Infinity']) {
  assert.throws(()=>parseNasEmbeddingArgs([flag]));
 }
});

test('actual CLI default performs reads only and never starts a run or calls embeddings',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
 let writes=0,calls=0;const logs=[];
 const query={select(){return this},is(){return this},order(){return this},range:async()=>({data:[{id:'1',path:'example',seq:0,content:'text'}]})};
 const dependencies={
  '@/lib/luna/nas-embedding-options':{parseNasEmbeddingArgs},
  dotenv:{config(){}},'node:path':{resolve:()=>'/unused'},
  '@supabase/supabase-js':{createClient:()=>({from:()=>query})},
  '@/lib/luna/embedding':{embeddingToSql:()=>''},
  '@/lib/luna/bounded-embeddings':{planEmbeddingRequests,embeddingCostUsd,createBoundedEmbeddingsBatch:async()=>{calls++;throw Error('unexpected API');},estimateEmbeddingCostUsd:()=>0},
  '@/lib/luna/nas-text-runs':{startNasTextRun:async()=>{writes++;throw Error('unexpected write');}}
 };
 const source=fs.readFileSync(path.join(__dirname,'../../scripts/embed-nas-chunks.ts'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{require:n=>{if(!(n in dependencies))throw Error(n);return dependencies[n];},exports:{},
  process:{argv:['node','script'],env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SECRET_KEY:'test-placeholder'},cwd:()=>'/unused',exit:()=>{throw Error('unexpected exit');}},
  console:{log:(...v)=>logs.push(v.join(' ')),error:()=>{throw Error('unexpected error');},warn(){} }
 });
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(writes,0);assert.equal(calls,0);assert.ok(logs.some(l=>l.includes('dry_run')));
});

async function runAppliedCli({ updateResult, completionError = null, args = [] }) {
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
 const events=[]; let finish;
 const finished=new Promise(resolve=>{finish=resolve});
 const admin={from(table){
  let updating=false, counting=false; const filters=[];
  const q={
   select(_columns,options){counting=Boolean(options?.head);return q},
   update(){updating=true;return q},
   eq(...args){filters.push(['eq',...args]);return q},
   is(...args){filters.push(['is',...args]);return q},
   order(){return q},
   range:async()=>({data:[{id:'one',path:'sample',seq:0,content:'original'}]}),
   then(resolve,reject){
    events.push({table,updating,counting,filters});
    const result=table==='nas_file_text'?{error:completionError}:counting?{count:0,error:null}:updateResult;
    return Promise.resolve(result).then(resolve,reject);
   }
  };return q;
 }};
 const dependencies={
  '@/lib/luna/nas-embedding-options':{parseNasEmbeddingArgs},dotenv:{config(){}},'node:path':{resolve:()=>'/unused'},
  '@supabase/supabase-js':{createClient:()=>admin},'@/lib/luna/embedding':{embeddingToSql:()=> '[0]'},
  '@/lib/luna/bounded-embeddings':{planEmbeddingRequests,embeddingCostUsd,createBoundedEmbeddingsBatch:async()=>({vectors:[[0]],tokens:1}),estimateEmbeddingCostUsd:()=>0.01},
  '@/lib/luna/nas-text-runs':{
   startNasTextRun:async()=>{events.push({start:true});return 'run'},updateNasTextRunProgress:async()=>{},
   finishNasTextRun:async(_admin,_id,status,progress)=>{events.push({status,progress:{...progress}})}
  }
 };
 const source=fs.readFileSync(path.join(__dirname,'../../scripts/embed-nas-chunks.ts'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{require:n=>{if(!(n in dependencies))throw Error(n);return dependencies[n]},exports:{},
  process:{argv:['node','script','--apply','--limit=1',...args],env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SECRET_KEY:'test-placeholder'},cwd:()=>'/unused',exit:code=>finish(code)},
  console:{log:(message)=>{if(message==='=== embed done ===')finish(0)},warn(){},error(){}}
 });
 const exit=await finished;return {events,exit};
}

test('changed or already embedded rows are skipped and never marked indexed',async()=>{
 const {events,exit}=await runAppliedCli({updateResult:{data:[],error:null}});
 assert.equal(exit,0);
 const update=events.find(e=>e.table==='nas_file_chunks'&&e.updating);
 assert.deepEqual(JSON.parse(JSON.stringify(update.filters)),[['eq','id','one'],['eq','content','original'],['is','embedding',null]]);
 assert.equal(events.some(e=>e.table==='nas_file_text'),false);
 const outcome=events.find(e=>e.status);
 assert.equal(outcome.progress.embeddingsCreated,0);assert.equal(outcome.progress.skipped,1);
});
test('failed chunk writes produce failed job and nonzero exit',async()=>{
 const {events,exit}=await runAppliedCli({updateResult:{data:null,error:{message:'write failed'}}});
 assert.equal(exit,1);assert.equal(events.find(e=>e.status).status,'failed');
 assert.equal(events.find(e=>e.status).progress.failed,1);
 assert.equal(events.some(e=>e.table==='nas_file_text'),false);
});
test('file completion write failures cannot be recorded as successful jobs',async()=>{
 const {events,exit}=await runAppliedCli({updateResult:{data:[{id:'one'}],error:null},completionError:{message:'completion failed'}});
 assert.equal(exit,1);assert.equal(events.find(e=>e.status).status,'failed');
});


test('actual apply CLI refuses an over-budget run before any database writes',async()=>{
 const {events,exit}=await runAppliedCli({updateResult:{data:[{id:'one'}],error:null},args:['--max-cost-usd=0.000000001']});
 assert.equal(exit,1);
 assert.deepEqual(events,[]);
});
