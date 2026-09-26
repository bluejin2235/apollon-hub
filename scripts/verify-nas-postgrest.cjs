// Explicit local CI fixtures only. Real PostgREST HTTP, no operational credentials.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHmac}=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');
const {loadTs}=require('../tests/luna/helpers.cjs');
if(process.argv.slice(2).join(' ')!=='--local-ci-fixture'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='luna_embedding_ci'){
 throw Error('Only explicit disposable local embedding CI fixture is allowed');
}
const base='http://127.0.0.1:3101';
const secret='local-ci-postgrest-signing-secret-only-0000';
const token=role=>{
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role,exp:Math.floor(Date.now()/1000)+600});
 return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
};
const service=token('service_role');
const admin=createClient(base,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{
 // PostgREST is directly exposed here, without Supabase's /rest/v1 gateway.
 const url=new URL(String(input));assert.equal(url.origin,base);
 assert.ok(url.pathname.startsWith('/rest/v1/'));url.pathname=url.pathname.slice('/rest/v1'.length);
 return fetch(url,init);
}}});
const sql=q=>execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:10000}).trim();
const literal=s=>"'"+s.replace(/'/g,"''")+"'";
const paths=['Fixture\\Draft (1)\\file.pdf','Fixture\\Media,Images\\quoted"file.pdf','Fixture\\자료\\plan.pdf'];
const stamp='2026-09-26T00:00:00Z';
const owner='00000000-0000-4000-8000-000000000091';
const other='00000000-0000-4000-8000-000000000092';
async function main(){
 let ready=false;
 for(let i=0;i<40;i++){
  try{const response=await fetch(base+'/rpc/nas_embedding_candidates',{method:'POST',headers:{Authorization:'Bearer '+service,'Content-Type':'application/json'},body:'{}'});
   if(response.ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(ready,'PostgREST schema not ready');
 sql('truncate nas_file_text,nas_file_chunks,nas_directory cascade');
 for(let i=0;i<paths.length;i++){
  const p=literal(paths[i]);
  sql(`insert into nas_directory values('T',${p},'file',100,'${stamp}','${stamp}');
   insert into nas_file_text(path,drive,ext,size_bytes,modified_at,content_hash,text_length,chunk_count,status,extracted_at,updated_at)
   values(${p},'T','pdf',100,'${stamp}','fixture',10,1,'ok','${stamp}','${stamp}');
   insert into nas_file_chunks(path,seq,content) values(${p},0,'Synthetic evidence ${i}');`);
 }
 const {currentNasBodyFiles}=loadTs('lib/luna/nas-source-version.ts');
 const current=await currentNasBodyFiles(admin,paths);
 assert.deepEqual([...current.keys()],paths);
 const {reportSourcesAreCurrent}=loadTs('lib/luna/report-freshness.ts');
 assert.equal(await reportSourcesAreCurrent(admin,paths.map(ref=>({type:'nas',ref,drive:'T',size_bytes:100,modified_at:stamp}))),true);
 const queue=loadTs('lib/luna/nas-embedding-queue.ts');
 const selected=await queue.selectNasEmbeddingQueue(admin,3);
 assert.equal(selected.length,3);
 assert.equal((await queue.revalidateNasEmbeddingBatch(admin,selected)).length,3);
 assert.equal(await queue.storeNasEmbeddingBatch(admin,selected,selected.map(()=>[1,...Array(1535).fill(0)])),3);
 assert.equal((await queue.selectNasEmbeddingQueue(admin,3)).length,0);
 assert.equal(sql('select count(*) from nas_file_text where indexed_at is not null'),'3');

 assert.equal((await admin.rpc('nas_embedding_acquire_worker',{p_owner:owner})).data,true);
 assert.equal((await admin.rpc('nas_embedding_acquire_worker',{p_owner:other})).data,false);
 assert.equal((await admin.rpc('nas_embedding_release_worker',{p_owner:other})).data,false);
 assert.equal((await admin.rpc('nas_embedding_release_worker',{p_owner:owner})).data,true);
 for(const authorization of [null,'Bearer '+token('authenticated')]){
  const headers={'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})};
  for(const name of ['nas_embedding_acquire_worker','nas_embedding_release_worker']){
   const denied=await fetch(base+'/rpc/'+name,{method:'POST',headers,body:JSON.stringify({p_owner:owner})});
   assert.ok([401,403].includes(denied.status),name+' must deny public callers');
  }
  const denied=await fetch(base+'/nas_embedding_worker_gate',{headers});assert.ok([401,403].includes(denied.status));
 }
 sql(`insert into nas_directory values('T','New snapshot','file',100,'${stamp}','2026-09-27T00:00:00Z')`);
 assert.equal((await currentNasBodyFiles(admin,paths)).size,0);
 assert.equal(await reportSourcesAreCurrent(admin,[{type:'nas',ref:paths[0],drive:'T',size_bytes:100,modified_at:stamp}]),false);

 // Concurrent relationship builders must report only their own inserted rows.
 sql(`create table luna_links(id uuid primary key default gen_random_uuid(),
  from_type text,from_id text,to_type text,to_id text,kind text,
  confidence double precision check(confidence between 0 and 1),evidence jsonb,source text,status text,
  confirmed_by uuid,confirmed_at timestamptz,unique(from_type,from_id,to_type,to_id,kind));
  alter table luna_links enable row level security;
  grant all on luna_links to service_role;notify pgrst,'reload schema';`);
 let linkReady=false;
 for(let i=0;i<40;i++){
  const reply=await admin.from('luna_links').select('id').limit(1);
  if(!reply.error){linkReady=true;break;}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(linkReady,'relationship fixture schema not ready');
 const {insertLinkBatch,updateLinkEvidence}=loadTs('lib/luna-admin/link-write-receipts.ts');
 const relation={from_type:'notion_page',from_id:'fixture-page',to_type:'project',to_id:'fixture-project',kind:'belongs',
  confidence:.9,evidence:{fixture:true},source:'rule',status:'active'};
 const counts=await Promise.all([insertLinkBatch(admin,[relation]),insertLinkBatch(admin,[relation])]);
 assert.deepEqual(counts.sort(),[0,1]);
 assert.equal(await insertLinkBatch(admin,[{...relation,confidence:.5}]),0);
 const {data:stored,error:storedError}=await admin.from('luna_links').select('id,confidence').single();
 assert.equal(storedError,null);assert.equal(stored.confidence,.9);
 await updateLinkEvidence(admin,stored.id,1,{fixture:'updated'});
 await assert.rejects(updateLinkEvidence(admin,owner,1,{}),/update/);
 await assert.rejects(insertLinkBatch(admin,[{...relation,from_id:'invalid',confidence:2}]),/insert/);
 console.log(JSON.stringify({ok:true,transport:'real PostgREST HTTP + installed supabase-js',paid_requests:0,
  checks:['escaped Windows path identity','current source and report membership','validated vector RPC roundtrip and completion',
   'durable worker claims','anonymous and authenticated denial','old snapshot exclusion',
   'concurrent relation insert receipts','evidence update acknowledgement and constraint failures']},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
