/** Offline synthetic integration; no env, network or live DB. Pass scanner.js path. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
async function main(){
 if(process.argv.length!==3)throw Error('Supply scanner.js path');
 const source=fs.readFileSync(process.argv[2],'utf8'), db=new PGlite(), timings={}, calls={};
 let lostStage=false,lostCommit=false;
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create table nas_directory(id bigserial primary key,drive text not null,path text not null,
   type text not null check(type in ('file','folder')),size_bytes bigint,modified_at timestamptz,
   file_summary text,importance smallint not null default 0,marked_reason text,
   scan_batch timestamptz not null default now(),unique(drive,path,scan_batch));
   insert into nas_directory(drive,path,type,size_bytes) select 'T','previous/'||i,'file',i from generate_series(1,90943) i;
   insert into nas_directory(drive,path,type,size_bytes) select 'P','previous/'||i,'file',i from generate_series(1,11337) i;`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260925003721_nas_atomic_snapshot.sql'),'utf8'));
  const rpc=async(name,args)=>{
   calls[name]=(calls[name]??0)+1; let result;
   if(name==='nas_snapshot_stage_batch'){
    result=await db.query('select nas_snapshot_stage_batch($1,$2::jsonb) value',[args.p_run_id,JSON.stringify(args.p_rows)]);
    if(!lostStage){lostStage=true;return {error:{code:'57014',status:400,message:'statement timeout'}};}
   }else if(name==='nas_snapshot_commit'){
    result=await db.query('select nas_snapshot_commit($1,$2) value',[args.p_run_id,args.p_expected_count]);
    if(!lostCommit){lostCommit=true;throw new TypeError('fetch failed');}
   }else throw Error('Unexpected RPC '+name);
   return {data:result.rows[0].value};
  };
  // Empty filesystem facades prevent the scanner's guards from patching host fs.
  const ctx=vm.createContext({fs:{},fsp:{},path:path.win32,randomUUID,createClient:()=>({rpc}),cron:{},
   process:{env:{SCAN_DELAY_MS:'0'},argv:[]},console:{log(){},warn(){},error(){}},setTimeout:fn=>setImmediate(fn),Date});
  const isolated=source.replace(/^import .*;\r?\n/gm,'').replace('dotenv.config();','');
  const end=isolated.lastIndexOf('if (isRetrySelfTest) {');assert.ok(end>0);
  vm.runInContext(isolated.slice(0,end)+'\nglobalThis.commit=commitDriveRecords;',ctx);
  const begin=(run,drive)=>db.query('select nas_snapshot_begin($1,$2)',[run,drive]);
  const digest=async drive=>(await db.query(`select count(*)::int n,
   md5(string_agg(row(id,path,size_bytes,scan_batch)::text,'|' order by id)) digest from nas_directory where drive=$1`,[drive])).rows[0];
  const records=(drive,n,prefix)=>Array.from({length:n},(_,i)=>({drive,path:prefix+'/'+i+'.pdf',type:'file',size_bytes:i+1,
   modified_at:'2026-09-25T00:00:00Z',file_summary:'Synthetic fixture; no company content'}));
  const initialP=await digest('P');
  for(const [drive,n] of [['T',90943],['P',11337]]){
   const run=randomUUID();await begin(run,drive);const start=Date.now();
   const receipt=await ctx.commit(drive,records(drive,n,'next'),n,run);timings[drive]=Date.now()-start;
   assert.equal(receipt.afterCount,n);assert.equal((await digest(drive)).n,n);
   if(drive==='T')assert.deepEqual(await digest('P'),initialP);
  }
  assert.ok(lostStage&&lostCommit);
  assert.equal(calls.nas_snapshot_stage_batch,Math.ceil(90943/100)+Math.ceil(11337/100)+1);
  assert.equal(calls.nas_snapshot_commit,3);
  const before=await digest('T'),pBefore=await digest('P'),failing=randomUUID();await begin(failing,'T');
  await db.exec(`create function reject_scale_row() returns trigger language plpgsql as $$
   begin if new.path='failed/40960.pdf' then raise exception 'injected mid-insert failure'; end if; return new; end; $$;
   create trigger reject_scale before insert on nas_directory for each row execute function reject_scale_row();`);
  const start=Date.now();
  await assert.rejects(ctx.commit('T',records('T',90943,'failed'),90943,failing),/injected mid-insert failure/);
  timings.failedReplacement=Date.now()-start;
  assert.deepEqual(await digest('T'),before);assert.deepEqual(await digest('P'),pBefore);
  assert.equal((await db.query('select committed_at from nas_snapshot_runs where id=$1',[failing])).rows[0].committed_at,null);
  assert.equal((await db.query('select count(*)::int n from nas_snapshot_stage where run_id=$1',[failing])).rows[0].n,90943);
  await db.exec('drop trigger reject_scale on nas_directory');
  assert.equal((await db.query('select nas_snapshot_commit($1,90943) n',[failing])).rows[0].n,90943);
  assert.equal((await db.query('select count(*)::int n from nas_snapshot_stage')).rows[0].n,0);
  console.log(JSON.stringify({ok:true,engine:'in-memory PGlite; mocked HTTP; not live NAS or Supabase benchmark',
   scannerSha256:createHash('sha256').update(source).digest('hex'),rows:102280,timingsMs:timings,
   verified:['stage response lost and retry','commit response lost and receipt retry','other drive unchanged',
    '90943-row rollback retains row IDs and metadata','failed receipt uncommitted','staging recovery','completed staging cleaned']},null,2));
 }finally{await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
