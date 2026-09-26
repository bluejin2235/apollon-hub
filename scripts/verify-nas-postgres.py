"""Disposable CI PostgreSQL verification. Never accepts a production connection.
Requires an empty local luna_snapshot_ci database and explicit --local-ci-fixture.
No third-party Python dependencies; psql handles connections. No file contents from NAS.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

if sys.argv[1:] != ['--local-ci-fixture']:
    raise SystemExit('Requires --local-ci-fixture')
if os.environ.get('PGHOST') != '127.0.0.1' or os.environ.get('PGDATABASE') != 'luna_snapshot_ci':
    raise SystemExit('Only the dedicated local CI database is allowed')
BASE = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
ROOT = Path(__file__).resolve().parent.parent

def sql(text):
    result = subprocess.run(BASE, input=text, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()

def digest(drive):
    return sql(f"select json_build_object('n',count(*),'hash',md5(string_agg(row(id,path,size_bytes,modified_at,scan_batch)::text,'|' order by id))) from nas_directory where drive='{drive}';")

def begin(drive):
    run = str(uuid.uuid4())
    sql(f"select nas_snapshot_begin('{run}','{drive}');")
    return run

def stage(run,drive,count,prefix):
    # Exercise the same 100-row RPC boundary; transport here is psql, not HTTP.
    sql(f"""do $$ declare i integer; payload jsonb; begin
      for i in 0..(({count}-1)/100) loop
        select jsonb_agg(jsonb_build_object('drive','{drive}','path','{prefix}/'||n||'.pdf',
          'type','file','size_bytes',n,'modified_at','2026-09-25T00:00:00Z')) into payload
          from generate_series(i*100,least(i*100+99,{count}-1)) n;
        perform nas_snapshot_stage_batch('{run}',payload);
      end loop; end $$;""")

def commit(run,count):
    return sql(f"select nas_snapshot_commit('{run}',{count});")

def expect_failure(action,fragment):
    try:
        action()
    except RuntimeError as exc:
        assert fragment in str(exc),str(exc)
    else:
        raise AssertionError('Expected failure: '+fragment)

def start_session(query, app):
    env = {**os.environ, 'PGAPPNAME':app}
    proc = subprocess.Popen(BASE, stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    proc.stdin.write(query)
    proc.stdin.close()
    return proc

def wait_for(predicate,seconds=10):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if predicate(): return
        time.sleep(0.1)
    raise AssertionError('Timed out waiting for PostgreSQL state')

def finish(proc):
    code=proc.wait(timeout=15)
    out=proc.stdout.read();err=proc.stderr.read()
    assert code==0,err
    return out.strip()

# Never destroy or reuse an existing populated DB.
assert sql("select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema');")=='0','Fixture DB is not empty'
report={'engine':'PostgreSQL service, synthetic data, psql transport','rows':102280,'checks':[],'timings_ms':{}}
sql("""create role anon;create role authenticated;create role service_role bypassrls;
create table nas_directory(id bigserial primary key,drive text not null,path text not null,
 type text not null check(type in ('folder','file')),size_bytes bigint,modified_at timestamptz,
 file_summary text,importance smallint not null default 0,marked_reason text,
 scan_batch timestamptz not null default now(),unique(drive,path,scan_batch));
insert into nas_directory(drive,path,type,size_bytes) select 'T','old/'||i,'file',i from generate_series(1,90943)i;
insert into nas_directory(drive,path,type,size_bytes) select 'P','old/'||i,'file',i from generate_series(1,11337)i;""")
sql((ROOT/'supabase/migrations/20260925003721_nas_atomic_snapshot.sql').read_text())
for drive,n in [('T',90943),('P',11337)]:
    before_other=digest('P' if drive=='T' else 'T')
    run=begin(drive);start=time.monotonic();stage(run,drive,n,'new')
    report['timings_ms'][drive+'_stage']=round((time.monotonic()-start)*1000)
    start=time.monotonic();assert commit(run,n)==str(n)
    report['timings_ms'][drive+'_commit']=round((time.monotonic()-start)*1000)
    after=digest(drive);assert commit(run,n)==str(n);assert digest(drive)==after
    assert digest('P' if drive=='T' else 'T')==before_other
report['checks'].append('102280 rows, stage RPC, commit receipt retry and other-drive isolation')

run=begin('T');stage(run,'T',90943,'failed');before=digest('T');other=digest('P')
sql("""create function reject_test_row() returns trigger language plpgsql as $$ begin
 if new.path='failed/40960.pdf' then raise exception 'injected insertion failure';end if;return new;end $$;
 create trigger reject_test before insert on nas_directory for each row execute function reject_test_row();""")
expect_failure(lambda:commit(run,90943),'injected insertion failure')
assert digest('T')==before and digest('P')==other
assert sql(f"select committed_at is null from nas_snapshot_runs where id='{run}';")=='t'
assert sql(f"select count(*) from nas_snapshot_stage where run_id='{run}';")=='90943'
sql('drop trigger reject_test on nas_directory;');assert commit(run,90943)=='90943'
report['checks'].append('mid-insert rollback preserves IDs/metadata; retained staging recovers')

# Hold the exact final-publication table lock on one connection. SELECT must work;
# a second commit must wait. Observe the lock, then cancel the fixture holder.
run=begin('P');stage(run,'P',11337,'concurrent');before=digest('P')
lock_proc=start_session("begin; lock table nas_directory in share row exclusive mode; select pg_sleep(30); rollback;",'snapshot-lock-holder')
commit_proc=None
try:
    wait_for(lambda:sql("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='snapshot-lock-holder' and l.relation='nas_directory'::regclass and l.mode='ShareRowExclusiveLock' and l.granted);")=='t')
    # Explicit timeout proves ordinary reads are not blocked by the publication lock.
    assert sql("set statement_timeout='1500ms';select count(*) from nas_directory;")=='102280'
    commit_proc=start_session(f"select nas_snapshot_commit('{run}',11337);",'snapshot-waiting-commit')
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='snapshot-waiting-commit' and wait_event_type='Lock');")=='t')
    assert digest('P')==before,'Uncommitted replacement leaked'
    # Cancel only this disposable test holder; connection exit rolls back its transaction.
    assert sql("select pg_cancel_backend(pid) from pg_stat_activity where application_name='snapshot-lock-holder';")=='t'
    lock_proc.wait(timeout=5)
    assert finish(commit_proc)=='11337'
    assert json.loads(digest('P'))['n']==11337
finally:
    for proc in [lock_proc,commit_proc]:
        if proc and proc.poll() is None:proc.kill();proc.wait()
report['checks'].append('two-connection commit waits for writer lock; reads remain available; uncommitted rows invisible')

# Two simultaneous commits for the same completed run must return one receipt.
a=start_session(f"select nas_snapshot_commit('{run}',11337);",'snapshot-retry-a')
b=start_session(f"select nas_snapshot_commit('{run}',11337);",'snapshot-retry-b')
assert finish(a)=='11337' and finish(b)=='11337'
assert sql('select count(*) from nas_snapshot_stage;')=='0'
report['checks'].append('concurrent receipt retries do not duplicate live rows')
# Text publication uses a separate per-path lock and one transaction for
# metadata/chunks. Exercise real concurrent connections, not mocked RPC calls.
sql("""create table nas_file_text(path text primary key,drive text not null,ext text not null,
 size_bytes bigint,modified_at timestamptz,content_hash text,text_length integer not null default 0,
 chunk_count integer not null default 0,status text not null default 'ok',skip_reason text,error text,
 extracted_at timestamptz,indexed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table nas_file_chunks(id uuid primary key default gen_random_uuid(),path text not null references nas_file_text(path) on delete cascade,
 seq integer not null,content text not null,embedding text,created_at timestamptz not null default now(),unique(path,seq));
grant all on nas_directory,nas_file_text,nas_file_chunks to service_role;
insert into nas_directory(drive,path,type,size_bytes,modified_at,scan_batch)
 select 'T','atomic-text-fixture.pptx','file',100,'2026-09-25T00:00:00Z',max(scan_batch) from nas_directory where drive='T';""")
sql((ROOT/'supabase/migrations/20260926063021_nas_text_atomic_publish.sql').read_text())
text_meta=json.dumps(dict(path='atomic-text-fixture.pptx',drive='T',ext='pptx',size_bytes=100,
 modified_at='2026-09-25T00:00:00Z',content_hash='fixture',text_length=6,chunk_count=2,
 status='ok',skip_reason=None,error=None,extracted_at='2026-09-25T00:00:00Z'))
publication=f"select nas_text_publish($payload${text_meta}$payload$::jsonb,array['one','two'],null);"
first=start_session('begin; set local role service_role; '+publication+' select pg_sleep(3); commit;','text-first-writer')
second=None
try:
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='text-first-writer' and wait_event='PgSleep');")=='t')
    assert sql("set statement_timeout='1500ms';select count(*) from nas_file_text;")=='0','Partial text publication leaked'
    second=start_session('set role service_role; '+publication,'text-stale-writer')
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='text-stale-writer' and wait_event_type='Lock');")=='t')
    finish(first)
    assert second.wait(timeout=10)!=0
    assert 'Publication version changed' in second.stderr.read()
    assert sql('select count(*) from nas_file_chunks;')=='2'
finally:
    for proc in [first,second]:
        if proc and proc.poll() is None:proc.kill();proc.wait()
report['checks'].append('atomic text is invisible until commit; concurrent stale writer waits then is rejected')

version=sql('select updated_at from nas_file_text;')
before=sql('select to_jsonb(t)::text from nas_file_text t;')
chunks_before=sql('select jsonb_agg(to_jsonb(c) order by seq)::text from nas_file_chunks c;')
sql("""create function reject_text_fixture() returns trigger language plpgsql as $$begin
 if new.content='reject-fixture' then raise exception 'injected text failure';end if;return new;end$$;
 create trigger reject_text_fixture before insert on nas_file_chunks for each row execute function reject_text_fixture();""")
bad=publication.replace("array['one','two'],null",f"array['one','reject-fixture'],'{version}'")
expect_failure(lambda:sql(bad),'injected text failure')
assert sql('select to_jsonb(t)::text from nas_file_text t;')==before
assert sql('select jsonb_agg(to_jsonb(c) order by seq)::text from nas_file_chunks c;')==chunks_before
report['checks'].append('real PostgreSQL mid-chunk failure rolls back metadata/chunk IDs together')

report['ok']=True
print(json.dumps(report,indent=2))
