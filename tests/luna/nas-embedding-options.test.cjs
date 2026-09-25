const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {parseNasEmbeddingArgs}=loadTs('lib/luna/nas-embedding-options.ts');
test('default and full runs are bounded and read-only',()=>{
 assert.deepEqual(parseNasEmbeddingArgs([]),{limit:500,batchSize:100,kind:'incremental',apply:false});
 assert.equal(parseNasEmbeddingArgs(['--full']).apply,false);
 assert.equal(parseNasEmbeddingArgs(['--full']).limit,500);
});
test('paid execution requires an explicit switch with bounded limits',()=>{
 assert.deepEqual(parseNasEmbeddingArgs(['--limit=20','--batch=10','--apply']),{limit:20,batchSize:10,kind:'incremental',apply:true});
});
test('bad flags cannot silently start an unlimited run',()=>{
 for(const flag of ['--limit=0','--limit=-1','--limit=999999','--limit=abc','--batch=101','--apply=yes','--limt=5']) {
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
  '@/lib/luna/notion-index':{chunk:()=>[],createEmbeddingsBatch:async()=>{calls++;throw Error('unexpected API');},estimateEmbeddingCostUsd:()=>0},
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
