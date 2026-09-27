const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { root } = require('./helpers.cjs');

const ADMIN = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-000000000002';
const ROOM = '00000000-0000-4000-8000-000000000003';
const QUESTION = '00000000-0000-4000-8000-000000000004';
const FIXTURE = '89100bd6-dd28-4a42-8e02-6284bc9ebc36';
const migration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260924155621_luna_search_foundation_security.sql'), 'utf8');

test('security and data isolation migration on an isolated PostgreSQL engine', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to service_role;
      create table public.profiles(id uuid primary key, role text);
      create table public.luna_conversations(id uuid primary key, title text);
      create table public.luna_learnings(id uuid primary key, content text, meta jsonb,
        source_conversation_id uuid, status text, resolved_by uuid, resolved_at timestamptz);
      create table public.luna_questions(id uuid primary key, status text, answer text,
        answered_by uuid, answered_at timestamptz);
      create table public.luna_rules(id uuid primary key, status text, confirmed_at timestamptz, confirmed_by uuid);
      create table public.luna_decisions(item_type text, item_id uuid, decision text,
        note text, decided_by uuid, decided_via text);
      create view public.luna_inbox as select id from public.luna_questions;
      grant all on all tables in schema public to service_role;
      insert into public.profiles values ('${ADMIN}', '슈퍼관리자'), ('${STAFF}', '직원');
      insert into public.luna_conversations values ('${ROOM}', '[P9TEST:baseline] 가짜 대화');
      insert into public.luna_questions values ('${QUESTION}', 'pending', null, null, null);
      insert into public.luna_learnings(id,content,status) values
        ('${FIXTURE}', '검증용 고유 지식문장: melona', 'active'),
        ('${ADMIN}', '실제 업무 지식', 'active');
      insert into public.luna_learnings(id,content,status,source_conversation_id)
        values ('${STAFF}', '시험 대화에서 만든 지식', 'active', '${ROOM}');
    `);
    await db.exec(migration);

    await t.test('known fixtures are retained and quarantined; genuine knowledge remains active', async () => {
      const { rows } = await db.query('select id, status, data_context from public.luna_learnings order by id');
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.find(x => x.id === ADMIN), { id: ADMIN, status: 'active', data_context: 'production' });
      for (const id of [STAFF, FIXTURE]) assert.deepEqual(rows.find(x => x.id === id), { id, status: 'archived', data_context: 'synthetic' });
    });

    await t.test('synthetic data cannot become production by renaming or approving it', async () => {
      await db.exec(`update public.luna_conversations set title='정상 업무 제목', data_context='production' where id='${ROOM}';
        update public.luna_learnings set status='active', data_context='production', meta='{}' where id='${FIXTURE}';`);
      assert.equal((await db.query(`select data_context from public.luna_conversations where id='${ROOM}'`)).rows[0].data_context, 'synthetic');
      assert.equal((await db.query(`select status from public.luna_learnings where id='${FIXTURE}'`)).rows[0].status, 'archived');
    });

    await t.test('new harness conversations and learning writes are isolated automatically', async () => {
      await db.exec(`insert into public.luna_conversations(id,title) values ('${QUESTION}', '[LUNA-EVAL:next] 자료 찾기');
        insert into public.luna_learnings(id,content,status,source_conversation_id)
        values ('${QUESTION}', 'new synthetic knowledge', 'active', '${QUESTION}');`);
      assert.equal((await db.query(`select status from public.luna_learnings where id='${QUESTION}'`)).rows[0].status, 'archived');
    });

    await t.test('anonymous and regular authenticated roles cannot call the administrative RPC or read its inbox', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(db.query(`select public.luna_inbox_decide('question', '${QUESTION}', 'approve', 'x', '${ADMIN}')`), e => e.code === '42501');
          await assert.rejects(db.query('select * from public.luna_inbox'), e => e.code === '42501');
        } finally { await db.exec('reset role'); }
      }
    });

    await t.test('trusted server must still supply a real administrator; forged actor is rejected', async () => {
      await db.exec('set role service_role');
      try {
        for (const actor of [null, STAFF]) {
          await assert.rejects(db.query('select public.luna_inbox_decide($1,$2,$3,$4,$5)', ['question', QUESTION, 'approve', 'x', actor]), e => e.code === '42501');
        }
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [STAFF]);
        await assert.rejects(db.query('select public.luna_inbox_decide($1,$2,$3,$4,$5)', ['question', QUESTION, 'approve', 'x', ADMIN]), e => e.code === '42501');
        await db.query("select set_config('request.jwt.claim.sub', '', false)");
      } finally { await db.exec('reset role'); }
      assert.equal((await db.query('select count(*)::int as n from public.luna_decisions')).rows[0].n, 0);
    });

    await t.test('authorized server decision changes one item and records the verified actor once', async () => {
      await db.exec('set role service_role');
      try {
        const args = ['question', QUESTION, 'approve', '확인된 답', ADMIN];
        assert.equal((await db.query('select public.luna_inbox_decide($1,$2,$3,$4,$5) as result', args)).rows[0].result, 'ok');
        assert.equal((await db.query('select public.luna_inbox_decide($1,$2,$3,$4,$5) as result', args)).rows[0].result, 'no pending item matched');
      } finally { await db.exec('reset role'); }
      const { rows } = await db.query('select decided_by, note from public.luna_decisions');
      assert.deepEqual(rows, [{ decided_by: ADMIN, note: '확인된 답' }]);
    });

    await t.test('migration is repeatable and no longer runs the decision RPC as its owner', async () => {
      await db.exec(migration);
      assert.equal((await db.query("select prosecdef from pg_proc where proname='luna_inbox_decide'")).rows[0].prosecdef, false);
    });
  } finally { await db.close(); }
});
