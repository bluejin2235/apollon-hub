const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('recovery queue accepts current application reasons while preserving old rows and rejecting invalid states',async()=>{
 const db=new PGlite();
 try{
  await db.exec("create table luna_index_queue(reason text not null constraint luna_index_queue_reason_check check(reason in ('stale','properties_null','relation_changed')),status text check(status in ('pending','running','done','failed'))); insert into luna_index_queue values('properties_null','done');");
  const sql=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260930000000_luna_index_queue_recovery_reasons.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  for(const reason of ['index_failed','schema_changed','manual']) await db.query("insert into luna_index_queue values($1,'pending')",[reason]);
  assert.equal((await db.query('select count(*)::int as n from luna_index_queue')).rows[0].n,4);
  await assert.rejects(()=>db.exec("insert into luna_index_queue values('made_up','pending')"),/check constraint/);
  await assert.rejects(()=>db.exec("insert into luna_index_queue values('index_failed','made_up')"),/check constraint/);
 }finally{await db.close();}
});
