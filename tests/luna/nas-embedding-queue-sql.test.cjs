const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');const {vector}=require('@electric-sql/pglite/vector');
const {root}=require('./helpers.cjs');
const stamp='2026-09-26T00:00:00Z';
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const vec='['+[1,...Array(1535).fill(0)].join(',')+']';
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260926074534_nas_embedding_validated_queue.sql'),'utf8');
test('validated embedding queue and atomic storage with real pgvector',async t=>{
 const db=new PGlite({extensions:{vector}});
 try {
  await db.exec(`create extension vector;
   create role anon;create role authenticated;create role service_role bypassrls;
   create table nas_directory(drive text,path text,type text,size_bytes bigint,modified_at timestamptz,scan_batch timestamptz);
   create table nas_file_text(path text primary key,drive text not null,ext text not null,size_bytes bigint,modified_at timestamptz,
    content_hash text,text_length integer not null default 0,chunk_count integer not null default 0,status text not null,
    skip_reason text,error text,extracted_at timestamptz,indexed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz not null);
   create table nas_file_chunks(id uuid primary key default gen_random_uuid(),path text not null references nas_file_text(path) on delete cascade,
    seq integer not null,content text not null,embedding vector(1536),unique(path,seq));
   alter table nas_file_text enable row level security;alter table nas_file_chunks enable row level security;
   alter table nas_directory enable row level security;
   grant all on all tables in schema public to service_role;`);
  await db.exec(migration);
  let nextId;
  async function reset(){await db.exec('truncate nas_file_text,nas_file_chunks,nas_directory cascade');nextId=1;}
  async function seed(name,{status='ok',chunks=['evidence'],expected=chunks.length,drive='T'}={}){
   await db.query('insert into nas_directory values($1,$2,\'file\',100,$3,$3)',[drive,name,stamp]);
   await db.query(`insert into nas_file_text(path,drive,ext,size_bytes,modified_at,content_hash,text_length,chunk_count,status,extracted_at,updated_at)
    values($1,$2,'pdf',100,$3,'hash',10,$4,$5,$3,$3)`,[name,drive,stamp,expected,status]);
   for(let seq=0;seq<chunks.length;seq++)await db.query('insert into nas_file_chunks(id,path,seq,content) values($1,$2,$3,$4)',[uid(nextId++),name,seq,chunks[seq]]);
  }
  async function queue(limit=500,after=null,ids=null){return (await db.query('select * from nas_embedding_candidates($1,$2,$3)',[limit,after,ids])).rows;}
  async function put(rows){
   await db.exec('set role service_role');
   try{return (await db.query('select nas_embedding_store_batch($1) as ids',[JSON.stringify(rows.map(row=>({...row,embedding:row.embedding??vec})))])).rows[0].ids;}
   finally{await db.exec('reset role');}
  }
  await t.test('failed, skipped, incomplete, stale, ambiguous and marker-only sources are excluded',async()=>{
   await reset();await seed('valid.pdf');await seed('failed.pdf',{status:'failed'});
   await seed('skipped.pdf',{status:'skipped'});await seed('partial.pdf',{expected:2});await seed('stale.pdf');
   await seed('ambiguous.pdf');await seed('markers.pdf',{chunks:['-- 1 of 2 --\n-- 2 of 2 --','   \n\t']});
   await db.exec("update nas_directory set size_bytes=101 where path='stale.pdf';insert into nas_directory select 'P',path,type,size_bytes,modified_at,scan_batch from nas_directory where path='ambiguous.pdf'");
   assert.deepEqual((await queue()).map(r=>r.path),['valid.pdf']);
  });
  await t.test('keyset traversal fills selected limit after exclusions and does not skip pending rows after prior writes',async()=>{
   await reset();await seed('invalid.pdf',{status:'failed'});await seed('valid.pdf',{chunks:['first','second','third']});
   const first=await queue(1);assert.equal(first[0].id,uid(2));
   await put(first);const next=await queue(2,first[0].id);
   assert.deepEqual(next.map(r=>r.id),[uid(3),uid(4)]);
  });
  await t.test('paid response for changed metadata or content is rejected without vectors or completion',async()=>{
   for(const change of ["update nas_file_text set status='failed'","update nas_file_text set updated_at=updated_at+interval '1 second'",
    "update nas_directory set size_bytes=101","update nas_file_chunks set content='changed'"]){
    await reset();await seed('valid.pdf');const before=await queue();await db.exec(change);
    assert.deepEqual(await put(before),[]);
    assert.equal((await db.query('select count(*)::integer n from nas_file_chunks where embedding is not null')).rows[0].n,0);
    assert.equal((await db.query('select indexed_at from nas_file_text')).rows[0].indexed_at,null);
   }
  });
  await t.test('only final chunk marks completion and source revision remains stable across batches',async()=>{
   await reset();await seed('valid.pdf',{chunks:['one','two']});const rows=await queue();
   assert.deepEqual(await put([rows[0]]),[rows[0].id]);
   assert.equal((await db.query('select indexed_at from nas_file_text')).rows[0].indexed_at,null);
   assert.deepEqual(await put([rows[1]]),[rows[1].id]);
   const metadata=(await db.query('select indexed_at,updated_at from nas_file_text')).rows[0];
   assert.ok(metadata.indexed_at);assert.equal(metadata.updated_at.toISOString(),new Date(stamp).toISOString());
   assert.deepEqual(await put(rows),[]);assert.equal((await queue()).length,0);
   assert.equal((await db.query('select vector_dims(embedding) dims from nas_file_chunks limit 1')).rows[0].dims,1536);
  });
  await t.test('mid-batch dimension or trigger error rolls back all vectors and completion markers',async()=>{
   await reset();await seed('valid.pdf',{chunks:['one','two']});const rows=await queue();
   await assert.rejects(put([rows[0],{...rows[1],embedding:'[1,2]'}]),/dimensions/);
   assert.equal((await db.query('select count(*)::integer n from nas_file_chunks where embedding is not null')).rows[0].n,0);
   await db.exec(`create function reject_complete() returns trigger language plpgsql as $$begin
    if new.indexed_at is not null then raise exception 'fixture completion error';end if;return new;end$$;
    create trigger reject_complete before update on nas_file_text for each row execute function reject_complete();`);
   await assert.rejects(put(rows),/fixture completion error/);
   assert.equal((await db.query('select count(*)::integer n from nas_file_chunks where embedding is not null')).rows[0].n,0);
   await db.exec('drop trigger reject_complete on nas_file_text;drop function reject_complete()');
  });
  await t.test('missing from latest snapshot is excluded even when an older matching row remains',async()=>{
   await reset();await seed('deleted.pdf');
   await db.exec("insert into nas_directory values('T','different.pdf','file',100,now(),now())");
   assert.deepEqual(await queue(),[]);
  });
  await t.test('bounds, duplicate IDs and caller permissions fail closed',async()=>{
   await reset();await seed('valid.pdf');const rows=await queue();
   await assert.rejects(queue(501),/bounds/);await assert.rejects(put([rows[0],rows[0]]),/Duplicate/);
   for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    try {
     await assert.rejects(queue(),e=>e.code==='42501');
     await assert.rejects(db.query("select nas_embedding_store_batch('[]')"),e=>e.code==='42501');
    }finally{await db.exec('reset role');}
   }
   assert.ok((await db.query("select prosecdef from pg_proc where proname in ('nas_embedding_candidates','nas_embedding_store_batch')")).rows.every(r=>r.prosecdef===false));
  });
 }finally{await db.close();}
});
