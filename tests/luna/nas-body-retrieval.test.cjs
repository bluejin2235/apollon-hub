const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const options={enabled:true,listing:false,notionEnough:false,query:'고래쇼',queryEmbedding:[0.1],rows:[]};
function setup(keyword,vector){
 const calls=[];
 const {retrieveNasBodyEvidence}=loadTs('lib/luna/nas-body-retrieval.ts',{
  '@/lib/luna/nas-text-keyword':{searchNasTextKeyword:async(...args)=>{calls.push('keyword');return keyword(...args)}},
  '@/lib/luna/nas-chunk-search':{matchNasChunkEmbeddings:async(...args)=>{calls.push('vector');return vector(...args)}},
  '@/lib/luna/workserver':{runWorkserverResultPipeline:rows=>rows}
 });return {run:retrieveNasBodyEvidence,calls};
}
const keywordHit={path:'Project/report.pdf',drive:'T',seq:0,snippet:'고래쇼 연출 내용',score:4,modified_at:null};
const vectorHit={id:'chunk',path:'Project/report.pdf',seq:0,similarity:0.8,content:'바다 생물 미디어 연출'};
test('both chat modes can enrich a path hit with keyword and semantic evidence',async()=>{
 const {run,calls}=setup(async()=>[keywordHit],async()=>[vectorHit]);
 const result=await run({}, {...options,rows:[{drive:'T',path:keywordHit.path,type:'file',size_bytes:10,modified_at:null,file_summary:null}]});
 assert.deepEqual(calls,['keyword','vector']);assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].file_summary,'고래쇼 연출 내용\n바다 생물 미디어 연출');
 assert.equal(result.rows[0].size_bytes,10);assert.equal(result.keywordHits,1);assert.equal(result.vectorHits,1);
});
test('disabled, listing and sufficient-notion gates do not query body storage',async()=>{
 for(const change of [{enabled:false},{listing:true},{notionEnough:true}]){
  const {run,calls}=setup(async()=>{throw Error('unexpected')},async()=>{throw Error('unexpected')});
  const result=await run({}, {...options,...change});assert.equal(result.searched,false);assert.equal(calls.length,0);
 }
});
test('missing query embedding still searches keyword body text',async()=>{
 const {run,calls}=setup(async()=>[keywordHit],async()=>{throw Error('unexpected')});
 const result=await run({}, {...options,queryEmbedding:null});
 assert.deepEqual(calls,['keyword']);assert.equal(result.rows[0].file_summary,keywordHit.snippet);
});
test('one failed retrieval channel does not discard the other channel evidence',async()=>{
 const {run}=setup(async()=>{throw Error('simulated keyword failure')},async()=>[vectorHit]);
 const result=await run({},options);assert.equal(result.keywordHits,0);assert.equal(result.vectorHits,1);
 assert.equal(result.rows[0].file_summary,vectorHit.content);
});
test('explicit broad body coverage overrides listing and Notion shortcuts',async()=>{
 for(const query of ['예시 프로젝트 전체 자료 찾아줘','예시 자료 전부 다 보여줘','예시 NAS 본문 검색해줘']){
  const {run,calls}=setup(async()=>[keywordHit],async()=>[]);
  const result=await run({}, {...options,query,listing:true,notionEnough:true});
  assert.equal(result.searched,true,query);assert.deepEqual(calls,['keyword','vector']);
 }
});
test('broad coverage never enables a disabled NAS connector',async()=>{
 const {run,calls}=setup(async()=>{throw Error('unexpected')},async()=>{throw Error('unexpected')});
 const result=await run({}, {...options,query:'전체 자료 찾아줘',enabled:false});
 assert.equal(result.searched,false);assert.deepEqual(calls,[]);
});
test('body terms exclude broad request words without dropping project/date subjects',()=>{
 const {nasBodyQueryTerms,requestsNasBodyCoverage}=loadTs('lib/luna/nas-query-intent.ts');
 assert.deepEqual(nasBodyQueryTerms('예시센터의 260204 전체 자료를 찾아주세요'),['예시센터','260204']);
 assert.deepEqual(nasBodyQueryTerms('전체 자료 보여줘'),[]);
 assert.equal(requestsNasBodyCoverage('예시 프로젝트 자료 찾아줘'),false);
});
test('follow-up all-sources intent survives reuse of a narrower subject query',async()=>{
 const {run,calls}=setup(async()=>[],async()=>[]);
 const result=await run({}, {...options,allSources:true,listing:true,notionEnough:true});
 assert.equal(result.searched,true);assert.equal(calls.length,2);
 const {resolveSearchScope,applyListingReferenceFlags}=loadTs('lib/luna/search-scope.ts');
 const scope=resolveSearchScope({types:['know'],question:'예시 레퍼런스 자료',allSources:true});
 assert.equal(applyListingReferenceFlags(scope,true).flags.nas,true);
 const direct=resolveSearchScope({types:['know'],question:'예시 레퍼런스 전체 자료 찾아줘'});
 assert.equal(applyListingReferenceFlags(direct,true).flags.nas,true);
 assert.equal(resolveSearchScope({types:['know'],question:'휴가 규정 알려줘'}).flags.nas,false);
});
