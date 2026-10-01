const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {reviewWikiEvidence}=loadTs('lib/luna/wiki-evidence-review.ts');
const source={slug:'project-record',section_id:'installation',title:'프로젝트 기록',section_title:'현장',path:'/wiki/project-record',excerpt:'검색용 앞부분',cite_publicly:true};
const proof='실제 수목 사이에 조명과 사운드를 설치한 현장의 전기 도면입니다.';
test('wiki review reads a relevant late section beyond the retrieval excerpt',async()=>{
 const docs=[{slug:source.slug,sections:[{id:source.section_id,body:'일반 소개 '.repeat(1500)+proof}]}];
 const result=await reviewWikiEvidence([source],docs,async rows=>{
  const direct=rows.flatMap((s,i)=>s.excerpt.includes(proof)?[i]:[]);
  return {direct,adjacent:[],unrelated:rows.flatMap((_,i)=>direct.includes(i)?[]:[i]),evidence:direct.map(index=>({index,quote:proof,reason:'현장 조명 설치에 필요한 실제 전기 도면 근거'}))};
 });
 assert.equal(result.sources.length,1);assert.match(result.sources[0].excerpt,/실제 수목/);
 assert.equal(result.sources[0].path,source.path);
});
test('unrelated wiki content and unreadable sections cannot enter the answer prompt',async()=>{
 const reject=async rows=>({direct:[],adjacent:[],unrelated:rows.map((_,i)=>i)});
 const unrelated=await reviewWikiEvidence([source],[{slug:source.slug,sections:[{id:source.section_id,body:'어떤 사업에도 통용되는 일반 조직의 업무 역할 설명입니다.'}]}],reject);
 assert.deepEqual(unrelated.sources,[]);assert.deepEqual(unrelated.unverifiedIds,[]);
 const missing=await reviewWikiEvidence([source],[],reject);
 assert.deepEqual(missing.sources,[]);assert.deepEqual(missing.unverifiedIds,['wiki:project-record:installation']);
});
