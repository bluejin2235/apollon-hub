const test = require('node:test');
const assert = require('node:assert/strict');
const {loadTs} = require('./helpers.cjs');
const {parseAskedWhat,correctRegisteredProjectTypos} = loadTs('lib/luna/ask-what.ts');
const {NAMED_ENTITY_SEED} = loadTs('lib/luna/named-entities.ts');
const {haystackMatchesAsked} = loadTs('lib/luna/search-filter.ts');
const path = '01 사업개발\\2026\\260108 해운대스퀘어 공공부지사업\\05 Design\\260204 KV\\01.jpg';
for(const name of ['해운대스퀀어','해운대스퀵어','해운대스퀘어']) {
  test(`${name} finds the registered project without widening to nearby projects`,()=>{
    const asked=parseAskedWhat(`${name} KV 이미지 보여줘`);
    assert.ok(haystackMatchesAsked(path,asked));
    assert.ok(!haystackMatchesAsked('해운대 그랜드조선호텔\\KV\\01.jpg',asked));
    assert.ok(!haystackMatchesAsked('해운대스퀘어\\견적\\01.pdf',asked));
    assert.deepEqual(asked.projectPhrases,['해운대스퀘어']);
  });
}
test('ambiguous corrections are not guessed',()=>{
  const entities=['가나다라마','가나다라바'].map(canonical=>({canonical,kind:'project',aliases:[],searchPhrases:[],parentCanonical:null}));
  assert.equal(correctRegisteredProjectTypos('가나다라사 이미지',entities),'가나다라사 이미지');
});
test('exact names, unknown words, and numbered names are preserved',()=>{
  for(const q of ['해운대스퀘어','해운대스퀘어에서','해운대스퀘어2','전혀다른프로젝트','해운대스퀀어2']) {
    assert.equal(correctRegisteredProjectTypos(q,NAMED_ENTITY_SEED),q);
  }
});
test('runtime entity registry determines permitted corrections',()=>{
  assert.equal(correctRegisteredProjectTypos('해운대스퀀어',[]),'해운대스퀀어');
});

test('diagnostic misses do not claim measured improvement', async()=>{
  let result={probed:10,miss:8};
  const {runProbeRetrievalExam}=loadTs('lib/luna/probe-retrieval.ts',{
    '@/lib/luna/llm/client':{}, '@/lib/luna/model-pricing':{}, '@/lib/luna/notion-index-search':{},
    '@/lib/luna/probe-mode-a-sources':{
      isMultiSourceModeAEnabled:()=>true,
      runModeAMultiSource:async()=>({result,cost_usd:0,llm_calls:0}), MODE_A_CALL_BUDGET_MS:100
    }
  });
  const chain={select(){return this},eq(){return this},gte(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve({data:[]}).then(resolve)}};
  const db={from:()=>chain};
  assert.equal((await runProbeRetrievalExam(db,{},10)).outcome,'no_change');
  result={probed:10,miss:0};
  assert.equal((await runProbeRetrievalExam(db,{},10)).outcome,'no_change');
  result={probed:0,miss:0};
  assert.equal((await runProbeRetrievalExam(db,{},10)).outcome,'failed');
});


const {isNotFoundAnswer} = loadTs('lib/luna/failures-shared.ts');
const {isNotFoundAnswerText,keepSourcesUsedInAnswer} = loadTs('lib/luna/search-filter.ts');
test('partial evidence is not classified as a wholly missing answer',()=>{
  const answer='기획 자료는 확인했습니다. 아직 실제 구축·수행 단계 자료는 확인되지 않았습니다.';
  assert.equal(isNotFoundAnswer(answer),false);
  const mixed='기획 자료는 찾았습니다. 수행 단계 자료는 찾지 못했습니다.';
  assert.equal(isNotFoundAnswerText(mixed),false);
  const kept=keepSourcesUsedInAnswer({cards:[],wiki:[],notion:[{title:'기획 자료',url:'https://example.invalid/source'}],answer:mixed,notFound:isNotFoundAnswerText(mixed)});
  assert.equal(kept.notion.length,1);
});
test('genuine missing answers still report failure',()=>{
  for(const answer of ['요청하신 자료를 찾지 못했습니다.','자료는 확인하지 못했습니다.','관련 문서가 없어요.']) {
    assert.equal(isNotFoundAnswer(answer),true);
  }
  assert.equal(isNotFoundAnswerText('요청하신 자료를 찾지 못했습니다.'),true);
});
test('unrelated positive remarks do not suppress missing evidence',()=>{
  assert.equal(isNotFoundAnswer('질문은 확인했습니다. 자료를 찾지 못했습니다.'),true);
});


test('atrium is a space attribute unless explicitly registered as a project',()=>{
  assert.deepEqual(parseAskedWhat('아트리움 이미지 보여줘').projectPhrases,[]);
  const entity={canonical:'아트리움',kind:'project',aliases:[],searchPhrases:[],parentCanonical:null};
  assert.deepEqual(parseAskedWhat('아트리움 이미지 보여줘',[entity]).projectPhrases,['아트리움']);
});
