const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { root } = require('./helpers.cjs');
const migration = fs.readFileSync(path.join(root,'supabase/migrations/20260926063021_nas_text_atomic_publish.sql'),'utf8');
const stamp = '2026-09-25T00:00:00Z';
const meta = (patch={}) => ({path:'project\\document.pptx',drive:'T',ext:'pptx',size_bytes:100,
  modified_at:stamp,content_hash:'hash-one',text_length:8,chunk_count:2,status:'ok',
  skip_reason:null,error:null,extracted_at:stamp,...patch});

test('atomic NAS text publication on disposable PostgreSQL engine', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public.nas_directory(drive text,path text,type text,size_bytes bigint,modified_at timestamptz,scan_batch timestamptz);
      create table public.nas_file_text(path text primary key,drive text not null,ext text not null,
        size_bytes bigint,modified_at timestamptz,content_hash text,text_length integer not null default 0,
        chunk_count integer not null default 0,status text not null default 'ok',skip_reason text,error text,
        extracted_at timestamptz,indexed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
      create table public.nas_file_chunks(id uuid primary key default gen_random_uuid(),path text not null references public.nas_file_text(path) on delete cascade,
        seq integer not null,content text not null,embedding text,created_at timestamptz not null default now(),unique(path,seq));
      alter table public.nas_directory enable row level security;
      alter table public.nas_file_text enable row level security;
      alter table public.nas_file_chunks enable row level security;
      grant all on all tables in schema public to service_role;
    `);
    await db.exec(migration);
    async function reset() {
      await db.exec('truncate public.nas_file_text,public.nas_file_chunks,public.nas_directory cascade');
      await db.query('insert into public.nas_directory values($1,$2,$3,$4,$5,$6)', ['T',meta().path,'file',100,stamp,stamp]);
    }
    async function publish(m=meta(),chunks=['one','two'],version=null) {
      await db.exec('set role service_role');
      try {
        return (await db.query('select public.nas_text_publish($1::jsonb,$2::text[],$3::timestamptz) as receipt',
          [JSON.stringify(m),chunks,version])).rows[0].receipt;
      } finally { await db.exec('reset role'); }
    }
    const state = async () => (await db.query(`select to_jsonb(t) as metadata,
      (select jsonb_agg(to_jsonb(c) order by seq) from public.nas_file_chunks c where c.path=t.path) as chunks
      from public.nas_file_text t`)).rows;

    await t.test('insert failure after delete rolls back metadata and all old chunks/embeddings',async()=>{
      await reset(); const first=await publish();
      await db.exec("update public.nas_file_chunks set embedding='retained-vector'");
      const before=await state();
      await db.exec(`create function reject_fixture_chunk() returns trigger language plpgsql as $$begin
        if new.content='reject-fixture' then raise exception 'injected chunk failure'; end if; return new; end$$;
        create trigger reject_fixture before insert on public.nas_file_chunks for each row execute function reject_fixture_chunk();`);
      await assert.rejects(publish(meta({content_hash:'new-hash'}),['changed','reject-fixture'],first.updated_at),/injected chunk failure/);
      assert.deepEqual(await state(),before);
      await db.exec('drop trigger reject_fixture on public.nas_file_chunks; drop function reject_fixture_chunk()');
    });
    await t.test('exact chunk equality preserves IDs/vectors; missing chunks are repaired despite equal hash',async()=>{
      await reset(); const first=await publish();
      await db.exec("update public.nas_file_chunks set embedding='retained-vector'");
      await db.exec("update public.nas_file_text set indexed_at='2026-09-25T01:00:00Z'");
      const indexedBefore=(await state())[0].metadata.indexed_at;
      const before=(await state())[0].chunks;
      const second=await publish(meta(),['one','two'],first.updated_at);
      assert.equal(second.chunks_created,0); assert.equal(second.chunks_preserved,true);
      assert.deepEqual((await state())[0].chunks,before);
      assert.equal((await state())[0].metadata.indexed_at,indexedBefore);
      await db.exec('delete from public.nas_file_chunks where seq=1');
      const repaired=await publish(meta(),['one','two'],second.updated_at);
      assert.equal(repaired.chunks_created,2);
      assert.equal((await state())[0].chunks.length,2);
      assert.equal((await state())[0].metadata.indexed_at,null);
    });
    await t.test('competing stale writer and ambiguous retry cannot overwrite newer publication',async()=>{
      await reset(); const first=await publish();
      await publish(meta({content_hash:'new-hash'}),['new','text'],first.updated_at);
      const before=await state();
      await assert.rejects(publish(meta(),['one','two'],first.updated_at),e=>e.code==='40001');
      await assert.rejects(publish(),e=>e.code==='40001');
      assert.deepEqual(await state(),before);
    });
    await t.test('changed directory version or drive ambiguity blocks publication',async()=>{
      await reset();
      await db.exec('update public.nas_directory set size_bytes=101');
      await assert.rejects(publish(),e=>e.code==='40001');
      await reset();
      await db.exec("insert into public.nas_directory select 'P',path,type,size_bytes,modified_at,scan_batch from public.nas_directory");
      await assert.rejects(publish(),e=>e.code==='40001');
      assert.deepEqual(await state(),[]);
    });
    await t.test('non-ok states clear obsolete chunks atomically; malformed payloads are rejected',async()=>{
      for(const status of ['empty','failed','skipped']) {
        await reset(); const first=await publish();
        await publish(meta({status,content_hash:null,text_length:0,chunk_count:0}),[],first.updated_at);
        const result=(await state())[0]; assert.equal(result.metadata.status,status); assert.equal(result.chunks,null);
      }
      await reset();
      for(const [patch,chunks] of [[{chunk_count:1},['one','two']],[{},['one',null]],[{},['one','x'.repeat(17000)]],[{status:'empty'},['one','two']]]) {
        await assert.rejects(publish(meta(patch),chunks),/Invalid publication/);
      }
      assert.deepEqual(await state(),[]);
    });
    await t.test('repair audit finds missing and discontinuous chunks without labeling intact files',async()=>{
      await reset(); await publish();
      const audit=async()=> (await db.query('select public.nas_text_incomplete_paths() as paths')).rows[0].paths;
      assert.deepEqual(await audit(),[]);
      await db.exec('delete from public.nas_file_chunks where seq=1');
      assert.deepEqual(await audit(),[meta().path]);
      await db.exec('update public.nas_file_text set chunk_count=1; update public.nas_file_chunks set seq=2');
      assert.deepEqual(await audit(),[meta().path]);
      await db.exec('delete from public.nas_file_chunks; update public.nas_file_text set chunk_count=0');
      assert.deepEqual(await audit(),[meta().path]);
      await db.exec("update public.nas_file_text set status='empty'");
      assert.deepEqual(await audit(),[]);
    });
    await t.test('only service role can execute; function remains security invoker',async()=>{
      for(const role of ['anon','authenticated']) {
        await db.exec('set role '+role);
        try {
          await assert.rejects(db.query("select public.nas_text_incomplete_paths()"),e=>e.code==='42501');
          await assert.rejects(db.query("select public.nas_text_publish('{}','{}',null)"),e=>e.code==='42501'); }
        finally { await db.exec('reset role'); }
      }
      await db.exec(migration);
      assert.equal((await db.query("select prosecdef from pg_proc where proname='nas_text_publish'")).rows[0].prosecdef,false);
    });
  } finally { await db.close(); }
});
