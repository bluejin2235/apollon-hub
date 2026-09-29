const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('coverage retrieval ranks beyond the old 80-row window and does not erase same-title documents',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon;create role authenticated;create role service_role;create table luna_notion_pages(page_id text,title text,archived boolean);create table luna_notion_chunks(chunk_id text,page_id text,heading text,text text);');
  await db.exec("insert into luna_notion_pages select 'generic'||n,'미디어아트 제안 '||n,false from generate_series(1,100) n; insert into luna_notion_chunks select 'chunk'||n,'generic'||n,'미디어아트','실내 미디어아트 영상 콘텐츠' from generate_series(1,100) n;");
  await db.exec("insert into luna_notion_pages values ('target','야간공원 제안',false),('different','야간공원 제안',false),('hidden','숲 야외 미디어아트',true); insert into luna_notion_chunks values ('target-chunk','target','설치 계획','야외 숲 미디어아트 라이팅 설치'),('different-chunk','different','다른 장소','다른 공원의 숲 미디어아트 설치'),('hidden-chunk','hidden','자료','야외 숲 미디어아트');");
  await db.exec(fs.readFileSync('supabase/migrations/20260929070043_luna_notion_keyword_coverage.sql','utf8'));
  const r=await db.query("select * from luna_notion_keyword_candidates(array['야외','숲','미디어아트'],12)");
  assert.equal(r.rows[0].page_id,'target');
  assert.ok(r.rows.some(x=>x.page_id==='different'));
  assert.ok(!r.rows.some(x=>x.page_id==='hidden'));
  const privileges=await db.query("select has_function_privilege('anon','luna_notion_keyword_candidates(text[],integer)','execute') anon,has_function_privilege('authenticated','luna_notion_keyword_candidates(text[],integer)','execute') authenticated");
  assert.equal(privileges.rows[0].anon,false);assert.equal(privileges.rows[0].authenticated,false);
 } finally {await db.close();}
});
