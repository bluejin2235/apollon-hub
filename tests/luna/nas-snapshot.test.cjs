const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('node:crypto');

test('atomic NAS snapshot protocol on PostgreSQL', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to service_role;
      create table nas_directory(id bigserial primary key,drive text not null,path text not null,
        type text not null check(type in ('file','folder')),size_bytes bigint,modified_at timestamptz,
        file_summary text,importance smallint not null default 0,marked_reason text,
        scan_batch timestamptz not null default now(), unique(drive,path,scan_batch));
      grant all on nas_directory to service_role;
      grant usage,select on sequence nas_directory_id_seq to service_role;
      insert into nas_directory(drive,path,type) values('T','original','folder'),('P','unrelated','folder');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20260925003721_nas_atomic_snapshot.sql'),'utf8'));
    const begin = async (id, drive='T') => db.query('select nas_snapshot_begin($1,$2)',[id,drive]);
    const stage = async (id,rows) => db.query('select nas_snapshot_stage_batch($1,$2::jsonb)',[id,JSON.stringify(rows)]);
    const commit = async (id,n) => db.query('select nas_snapshot_commit($1,$2) as count',[id,n]);
    const live = async () => (await db.query('select id::text,drive,path from nas_directory order by id')).rows;
    const row = p => ({drive:'T',path:p,type:'file',size_bytes:20});
    let run = randomUUID();
    await t.test('staging and idempotent upload leave live rows untouched',async()=>{
      const before=await live();await begin(run);await begin(run);
      await stage(run,[row('new')]);await stage(run,[row('new')]);
      assert.deepEqual(await live(),before);
      assert.equal((await db.query('select count(*)::int n from nas_snapshot_stage')).rows[0].n,1);
    });
    await t.test('incomplete and mismatched-drive inputs do not replace live data',async()=>{
      const before=await live();await assert.rejects(commit(run,2),/Incomplete/);
      await assert.rejects(stage(run,[{...row('bad'),drive:'P'}]),/mismatched/);
      assert.deepEqual(await live(),before);
    });
    await t.test('failure after delete rolls back the old rows and receipt',async()=>{
      await db.exec(`create function reject_snapshot_test() returns trigger language plpgsql as $$
        begin raise exception 'injected insert failure'; end; $$;
        create trigger reject_snapshot_test before insert on nas_directory for each row execute function reject_snapshot_test();`);
      const before=await live();await assert.rejects(commit(run,1),/injected insert failure/);
      assert.deepEqual(await live(),before);
      assert.equal((await db.query('select committed_at from nas_snapshot_runs where id=$1',[run])).rows[0].committed_at,null);
      await db.exec('drop trigger reject_snapshot_test on nas_directory;');
    });
    await t.test('publish and lost-response retry replace only the target drive once',async()=>{
      const result=await commit(run,1);assert.equal(result.rows[0].count,1);
      const after=await live();assert.deepEqual(after.map(x=>x.path),['unrelated','new']);
      await commit(run,1);assert.deepEqual(await live(),after);
      await assert.rejects(commit(run,2),/Retry count differs/);
      await assert.rejects(stage(run,[row('late')]),/already committed/);
    });
    await t.test('newer scan supersedes an older unfinished scan',async()=>{
      const older=randomUUID(), newer=randomUUID();await begin(older);await stage(older,[row('old')]);
      await begin(newer);await assert.rejects(commit(older,1),/Superseded/);
      await stage(newer,[row('latest')]);await commit(newer,1);
      assert.ok((await live()).some(x=>x.path==='latest'));
    });
    await t.test('anonymous and employee roles cannot read staging or call RPCs',async()=>{
      for(const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(db.query('select * from nas_snapshot_stage'),/permission denied/);
          await assert.rejects(begin(randomUUID()),/permission denied/);
          await assert.rejects(stage(randomUUID(),[row('denied')]),/permission denied/);
          await assert.rejects(commit(randomUUID(),1),/permission denied/);
        } finally {await db.exec('reset role');}
      }
    });
    await t.test('service role can perform the complete protocol',async()=>{
      await db.exec('set role service_role');
      try {const id=randomUUID();await begin(id);await stage(id,[row('server')]);await commit(id,1);}
      finally {await db.exec('reset role');}
      assert.ok((await live()).some(x=>x.path==='server'));
    });
    await t.test('empty first index still requires the existing minimum of 100 rows',async()=>{
      const id=randomUUID();await begin(id,'Z');await stage(id,[{...row('one'),drive:'Z'}]);
      await assert.rejects(commit(id,1),/safety threshold/);
    });
  } finally {await db.close();}
});
