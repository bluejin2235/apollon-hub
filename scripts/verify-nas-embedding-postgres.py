"""Disposable local pgvector concurrency checks; no operational connection accepted."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

if sys.argv[1:] != ['--local-ci-fixture']:
    raise SystemExit('Requires --local-ci-fixture')
if os.environ.get('PGHOST') != '127.0.0.1' or os.environ.get('PGDATABASE') != 'luna_embedding_ci':
    raise SystemExit('Only the dedicated local embedding CI database is allowed')
ROOT=Path(__file__).resolve().parent.parent
BASE=['psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1']
def sql(query):
    r=subprocess.run(BASE,input=query,text=True,capture_output=True,timeout=30)
    if r.returncode:raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()
def session(query,name):
    p=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'PGAPPNAME':name})
    p.stdin.write(query);p.stdin.close();return p
def wait_for(predicate):
    until=time.monotonic()+10
    while time.monotonic()<until:
        if predicate():return
        time.sleep(.1)
    raise AssertionError('Timed out waiting for concurrent fixture')
def finish(p):
    code=p.wait(timeout=15);out=p.stdout.read();err=p.stderr.read()
    assert code==0,err
    return out.strip()
def cleanup(*processes):
    for p in processes:
        if p and p.poll() is None:p.kill();p.wait()
def literal(obj):return '$payload$'+json.dumps(obj)+'$payload$::jsonb'
assert sql("select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")=='0'
sql("""create extension vector;create role anon;create role authenticated;create role service_role bypassrls;
create table nas_directory(drive text,path text,type text,size_bytes bigint,modified_at timestamptz,scan_batch timestamptz);
create table nas_file_text(path text primary key,drive text not null,ext text not null,size_bytes bigint,modified_at timestamptz,
 content_hash text,text_length integer not null default 0,chunk_count integer not null default 0,status text not null,
 skip_reason text,error text,extracted_at timestamptz,indexed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz not null default now());
create table nas_file_chunks(id uuid primary key default gen_random_uuid(),path text not null references nas_file_text(path) on delete cascade,
 seq integer not null,content text not null,embedding vector(1536),created_at timestamptz default now(),unique(path,seq));
alter table nas_file_text enable row level security;alter table nas_file_chunks enable row level security;alter table nas_directory enable row level security;
grant all on all tables in schema public to service_role;
insert into nas_directory values('T','fixture.pdf','file',100,'2026-09-26T00:00:00Z','2026-09-26T00:00:00Z');""")
for name in ['20260926063021_nas_text_atomic_publish.sql','20260926074534_nas_embedding_validated_queue.sql',
             '20260926081424_nas_embedding_worker_gate.sql']:
    sql((ROOT/'supabase/migrations'/name).read_text())

# The durable claim must serialize separate transactions before any paid call.
owner_a='00000000-0000-4000-8000-000000000001'
owner_b='00000000-0000-4000-8000-000000000002'
first=session(f"begin;set local role service_role;select nas_embedding_acquire_worker('{owner_a}');select pg_sleep(3);commit",'embedding-gate-winner')
second=None
try:
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='embedding-gate-winner' and wait_event='PgSleep')")=='t')
    second=session(f"set role service_role;select nas_embedding_acquire_worker('{owner_b}')",'embedding-gate-loser')
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='embedding-gate-loser' and wait_event_type='Lock')")=='t')
    assert finish(first).strip()=='t'
    assert finish(second)=='f'
    assert sql(f"set role service_role;select nas_embedding_release_worker('{owner_b}')")=='f'
    assert sql(f"set role service_role;select nas_embedding_acquire_worker('{owner_b}')")=='f'
    assert sql(f"set role service_role;select nas_embedding_release_worker('{owner_a}')")=='t'
    assert sql(f"set role service_role;select nas_embedding_acquire_worker('{owner_b}')")=='t'
    assert sql(f"set role service_role;select nas_embedding_release_worker('{owner_b}')")=='t'
finally:cleanup(first,second)
meta=dict(path='fixture.pdf',drive='T',ext='pdf',size_bytes=100,modified_at='2026-09-26T00:00:00Z',content_hash='first',
 text_length=6,chunk_count=2,status='ok',skip_reason=None,error=None,extracted_at='2026-09-26T00:00:00Z')
sql(f"set role service_role;select nas_text_publish({literal(meta)},array['one','two'],null)")
def queued():return json.loads(sql("select coalesce(json_agg(q),'[]') from nas_embedding_candidates() q"))
def payload():return [{**r,'embedding':'['+','.join(['1']+['0']*1535)+']'} for r in queued()]
old=payload();version=old[0]['source_version'];meta['content_hash']='second'
replace=f"select nas_text_publish({literal(meta)},array['new one','new two'],'{version}')"
first=session('begin;set local role service_role;'+replace+';select pg_sleep(3);commit','embedding-text-writer')
second=None
try:
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='embedding-text-writer' and wait_event='PgSleep')")=='t')
    second=session(f"set role service_role;select nas_embedding_store_batch({literal(old)})",'embedding-stale-store')
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='embedding-stale-store' and wait_event_type='Lock')")=='t')
    assert sql("set statement_timeout='1000ms';select count(*) from nas_file_chunks where content='one'")=='1'
    finish(first);assert finish(second)=='{}'
    assert sql('select count(*) from nas_file_chunks where embedding is not null')=='0'
    assert sql('select indexed_at is null from nas_file_text')=='t'
finally:cleanup(first,second)
current=payload();store=f"select nas_embedding_store_batch({literal(current)})"
first=session('begin;set local role service_role;'+store+';select pg_sleep(3);commit','embedding-winner')
second=None
try:
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='embedding-winner' and wait_event='PgSleep')")=='t')
    second=session('set role service_role;'+store,'embedding-duplicate')
    wait_for(lambda:sql("select exists(select 1 from pg_stat_activity where application_name='embedding-duplicate' and wait_event_type='Lock')")=='t')
    assert sql('select count(*) from nas_file_chunks where embedding is not null')=='0'
    finish(first);assert finish(second)=='{}'
    assert sql('select count(*) from nas_file_chunks where vector_dims(embedding)=1536')=='2'
    assert sql('select indexed_at is not null from nas_file_text')=='t'
finally:cleanup(first,second)
assert queued()==[]
print(json.dumps({'ok':True,'engine':'PostgreSQL 16 + pgvector, synthetic source/vector fixtures',
 'checks':['concurrent workers acquire one durable gate; unrelated owner cannot release it',
 'text publication and embedding store serialize; old paid response cannot populate new source',
 'concurrent vector stores acknowledge each chunk once; completion and vectors become visible together',
 'service-only RPCs execute against real 1536-dimensional vector columns']},indent=2))
