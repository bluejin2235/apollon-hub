const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('coverage retrieval ranks beyond the old 80-row window and does not erase same-title documents',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon;create role authenticated;create role service_role;create table luna_notion_pages(page_id text,title text,archived boolean);create table luna_notion_chunks(chunk_id text,page_id text,heading text,text text);');
  await db.exec("insert into luna_notion_pages select 'generic'||n,'미디어아트 제안 '||n,false from generate_series(1,100) n; insert into luna_notion_chunks select 'chunk'||n,'generic'||n,'미디어아트','실내 미디어아트 영상 콘텐츠' from generate_series(1,100) n;");
  await db.exec("insert into luna_notion_pages values ('target','야간공원 제안',false),('different','야간공원 제안',false),('hidden','숲 야외 미디어아트',true); insert into luna_notion_chunks values ('target-chunk','target','설치 계획','야외 숲 미디어아트 라이팅 설치'),('different-chunk','different','다른 장소','다른 공원의 숲 미디어아트 설치'),('hidden-chunk','hidden','자료','야외 숲 미디어아트');");
  await db.exec(fs.readFileSync('supabase/migrations/20260929070043_luna_notion_keyword_coverage.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260929084331_luna_notion_concept_dedup.sql','utf8'));
  const r=await db.query("select * from luna_notion_keyword_candidates(array['야외','숲','미디어아트'],12)");
  assert.equal(r.rows[0].page_id,'target');
  assert.ok(r.rows.some(x=>x.page_id==='different'));
  assert.ok(!r.rows.some(x=>x.page_id==='hidden'));
  const privileges=await db.query("select has_function_privilege('anon','luna_notion_keyword_candidates(text[],integer)','execute') anon,has_function_privilege('authenticated','luna_notion_keyword_candidates(text[],integer)','execute') authenticated");
  assert.equal(privileges.rows[0].anon,false);assert.equal(privileges.rows[0].authenticated,false);
 } finally {await db.close();}
});

test('focused sources outrank incidental mentions and copied blocks do not crowd out distinct pages',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon;create role authenticated;create role service_role;create table luna_notion_pages(page_id text,title text,archived boolean);create table luna_notion_chunks(chunk_id text,page_id text,heading text,text text);');
  await db.exec("insert into luna_notion_pages values ('focused','Forest 설치 계획',false),('copy','Forest 설치 계획',false),('incidental','실내 쇼핑몰 제안',false),('other','야외 숲 라이팅',false); insert into luna_notion_chunks values ('a','focused','설치','야외 숲 미디어아트 설치'),('z','focused','운영','forest 야외 미디어아트 운영'),('b','copy','운영','forest 야외 미디어아트 운영'),('y','copy','설치','야외 숲 미디어아트 설치'),('i','incidental','참고',repeat('실내 쇼핑몰 일반 설명 ',600)||'야외 숲 미디어아트 참고'),('o','other','설계','야외 숲 미디어아트 라이팅 설계');");
  await db.exec(fs.readFileSync('supabase/migrations/20260929084331_luna_notion_concept_dedup.sql','utf8'));
  const r=await db.query("select * from luna_notion_keyword_candidates(array['숲','야외','미디어아트'],3)");
  assert.notEqual(r.rows[0].page_id,'incidental');
  assert.equal(new Set(r.rows.map(x=>x.page_id)).size,3,'first pass returns distinct pages before second snippets');
  assert.equal(r.rows.filter(x=>['focused','copy'].includes(x.page_id)).length,1,'identical copies with different chunk IDs are one source');
  const expanded=await db.query("select * from luna_notion_keyword_candidates(array['숲','야외','미디어아트','Media Art','야외미디어아트'],3)");
  assert.deepEqual(expanded.rows,r.rows,'aliases and generated bigrams must not alter concept weights');
  const independent=await db.query("select * from luna_notion_keyword_candidates(array['라이팅','설계'],3)");
  assert.equal(independent.rows[0].page_id,'other');
 } finally {await db.close();}
});
