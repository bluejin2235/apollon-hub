const test = require('node:test');
const assert = require('node:assert/strict');
const {loadTs} = require('./helpers.cjs');
const {isNotFoundAnswer} = loadTs('lib/luna/failures-shared.ts');
const {filterWeakSubjectMedia,searchMediaForLuna} = loadTs('lib/luna/media-index-search.ts',{
  '@/lib/luna/embedding':{EMBEDDING_DIMS:1536,embeddingToSql:JSON.stringify}
});
const hit=(description,similarity=.36)=>({path:description+'.jpg',file_name:'a.jpg',description,similarity,drive:'T',project:null});

test('partial findings remain positive despite missing later stages',()=>{
  for(const answer of [
    '자료를 내부에서 찾았지만, 실제 구축 자료는 확인하지 못했습니다.',
    '현재 확인된 내부 자료는 **제안 단계 자료 2건**이며, 실제 운영 자료는 확인되지 않았습니다.',
    '내부회의 2건과 미팅 기록이 있으며, 실제 구축·수행 단계 자료는 확인되지 않았습니다.'
  ]) assert.equal(isNotFoundAnswer(answer),false,answer);
});
test('absent and irrelevant findings still produce missing-material signals',()=>{
  for(const answer of ['확인된 자료가 없습니다.','관련 없는 자료만 찾았습니다. 요청한 자료는 없습니다.',
    '자료를 확인하지 못했습니다.']) {
    assert.equal(isNotFoundAnswer(answer),true,answer);
  }
});
test('weak topic images require subject evidence while strong matches survive',()=>{
  const hits=[hit('대형 고래 조형물'),hit('돌고래 영상'),hit('데이터 시각화'),hit('마케팅 촬영 현장'),hit('추상 이미지',.55)];
  assert.deepEqual(filterWeakSubjectMedia(hits,'고래쇼 자료 찾아줘'),[hits[0],hits[1],hits[4]]);
  assert.deepEqual(filterWeakSubjectMedia([hit('나비 조형물'),hit('데이터 시각화')],'나비쇼 사진 보여줘').map(x=>x.description),['나비 조형물']);
});
test('complex visual queries and named folders retain existing search behavior',()=>{
  const hits=[hit('청색 조명과 유리 조형물')];
  assert.deepEqual(filterWeakSubjectMedia(hits,'파란 LED로 연출한 레퍼런스 보여줘'),hits);
  assert.deepEqual(filterWeakSubjectMedia(hits,'프로젝트 사진 보여줘',{projectPhrases:['프로젝트']}),hits);
  assert.deepEqual(filterWeakSubjectMedia(hits,'이미지 보여줘'),hits);
});
test('search integration excludes unsupported weak hits from both prompt hits and cards',async()=>{
  const rows=[hit('대형 고래 조형물'),hit('데이터 시각화')];
  const db={rpc:async()=>({data:rows}),from(){return{select(){return this},filter:async()=>({data:rows})}}};
  const result=await searchMediaForLuna(db,[1,...Array(1535).fill(0)],'고래쇼 자료 찾아줘');
  assert.equal(result.hits.length,1);
  assert.equal(result.cards.length,1);
  assert.equal(result.cards[0].raw_path,rows[0].path);
});
test('confirmed factual roles remain partial while fabrication remains unknown',()=>{
  const answer='실제 시공사는 확인할 수 없습니다. 확인되는 것은 예시회사가 설치 위치와 연출 계획을 정리했다는 점이며, 이것만으로 시공사를 단정할 수는 없습니다.';
  assert.equal(isNotFoundAnswer(answer),false);
  for (const text of [
    '확인된 내용은 없습니다. 제작사를 확인할 수 없습니다.',
    '확인된 내용은 회사가 제작했다는 점이 아닙니다. 제작사는 알 수 없습니다.',
    '회사에서 제작했다는 점을 확인할 수 없습니다.',
    '질문은 확인했습니다. 관련 자료는 없습니다.'
  ]) assert.equal(isNotFoundAnswer(text),true,text);
});
test('a partial factual answer retains its supplied citation, not unrelated sources',()=>{
  const {keepSourcesUsedInAnswer}=loadTs('lib/luna/search-filter.ts');
  const {notionCitationMarker}=loadTs('lib/luna/source-citations.ts');
  const id='11111111-1111-1111-1111-111111111111';
  const source={id,title:'역할 확인 기록',url:'https://example.invalid/role'};
  const answer=`확인된 내용은 예시회사가 기획했다는 점입니다. ${notionCitationMarker(id)} 시공사는 확인할 수 없습니다.`;
  const kept=keepSourcesUsedInAnswer({cards:[],wiki:[],notion:[source,{id:'other',title:'다른 기록'}],answer,notFound:false,injectedNotionIds:[id]});
  assert.deepEqual(kept.notion,[source]);
});
