const test=require('node:test'),assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {loadTs}=require('./helpers.cjs');
const {matchMediaEmbeddings}=loadTs('lib/luna/media-index-search.ts',{
 '@/lib/luna/embedding':{EMBEDDING_DIMS:1536,embeddingToSql:JSON.stringify}
});
const {postgrestTextList}=loadTs('lib/luna/postgrest-text-list.ts');
const vec=[1,...Array(1535).fill(0)];
const respond=body=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
test('image metadata lookup retains special-character paths, descriptions and previews',async()=>{
 const path='Fixture\\KV, (draft)\\quote"name.png';
 const db=createClient('https://example.invalid','placeholder',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async input=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/rpc/luna_match_media'))return respond([{path,drive:'T',file_name:'fixture.png',similarity:.8}]);
  assert.equal(url.searchParams.get('path'),'in.'+postgrestTextList([path]));
  return respond([{path,project:'Fixture',description:'Expected image description',thumbnail_url:'https://example.invalid/preview.png'}]);
 }}});
 const result=await matchMediaEmbeddings(db,vec);
 assert.equal(result.length,1);assert.equal(result[0].description,'Expected image description');
 assert.equal(result[0].thumbnail_url,'https://example.invalid/preview.png');
});
test('invalid query vectors do not issue any database requests',async()=>{
 const db={rpc(){throw Error('invalid query reached RPC')}};
 for(const v of [[],[1],Array(1536).fill(0),[NaN,...vec.slice(1)],[Infinity,...vec.slice(1)]]){
  assert.deepEqual(await matchMediaEmbeddings(db,v),[]);
 }
});
test('fallback rejects truncated, malformed and zero vectors instead of comparing prefixes',async()=>{
 const vectors=[vec,JSON.stringify(vec),[1],Array(1536).fill(0),[1,NaN,...vec.slice(2)],[1,'bad',...vec.slice(2)],'[1,,0]'];
 const db={rpc:async()=>({error:{code:'PGRST202'}}),from(){return {
  select(){return this},not:async()=>({data:vectors.map((embedding,i)=>({path:'fixture-'+i,drive:'T',embedding}))})
 }}};
 const hits=await matchMediaEmbeddings(db,vec);
 assert.deepEqual(hits.map(h=>h.path),['fixture-0','fixture-1']);
 assert.ok(hits.every(h=>h.similarity===1));
});
