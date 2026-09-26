const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {root}=require('./helpers.cjs');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260926081424_nas_embedding_worker_gate.sql'),'utf8');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
test('durable embedding gate has exclusive ownership, no expiry and restricted access',async t=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls');
  await db.exec(migration);
  const call=async(name,owner)=>(await db.query(`select ${name}($1) acquired`,[owner])).rows[0].acquired;
  await t.test('second worker and duplicate acquisition cannot authorize a paid request',async()=>{
   await db.exec('set role service_role');
   assert.equal(await call('nas_embedding_acquire_worker',a),true);
   assert.equal(await call('nas_embedding_acquire_worker',b),false);
   assert.equal(await call('nas_embedding_acquire_worker',a),false);
   assert.equal(await call('nas_embedding_release_worker',b),false);
   assert.equal(await call('nas_embedding_acquire_worker',b),false);
   await db.exec('reset role');
  });
  await t.test('age and migration replay do not discard an unresolved owner',async()=>{
   await db.exec("update nas_embedding_worker_gate set acquired_at='2000-01-01'");
   await db.exec(migration);
   await db.exec('set role service_role');
   assert.equal(await call('nas_embedding_acquire_worker',b),false);
   assert.equal(await call('nas_embedding_release_worker',a),true);
   assert.equal(await call('nas_embedding_acquire_worker',b),true);
   assert.equal(await call('nas_embedding_release_worker',a),false);
   assert.equal(await call('nas_embedding_release_worker',b),true);
   await assert.rejects(call('nas_embedding_acquire_worker',null),/required/);
   await db.exec('reset role');
  });
  await t.test('public users cannot read, claim or release the gate; functions use invoker rights',async()=>{
   for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    await assert.rejects(db.query('select * from nas_embedding_worker_gate'),e=>e.code==='42501');
    await assert.rejects(call('nas_embedding_acquire_worker',a),e=>e.code==='42501');
    await assert.rejects(call('nas_embedding_release_worker',a),e=>e.code==='42501');
    await db.exec('reset role');
   }
   assert.equal((await db.query("select relrowsecurity enabled from pg_class where oid='nas_embedding_worker_gate'::regclass")).rows[0].enabled,true);
   assert.ok((await db.query("select prosecdef from pg_proc where proname in ('nas_embedding_acquire_worker','nas_embedding_release_worker')")).rows.every(r=>r.prosecdef===false));
  });
 }finally{await db.close();}
});
