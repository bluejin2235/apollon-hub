const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {reviewNasMaterialCards}=loadTs('lib/luna/nas-material-inventory.ts');
test('only reviewed NAS paths survive independently of a Notion-only summary',async()=>{
 const cards=[{type:'nas',title:'현장 시험 기록',raw_path:'T:\\Project\\샘플항구\\Test\\현장시험.pptx'},{type:'nas',title:'다른 사업',raw_path:'T:\\Project\\다른항구\\회의록.docx'}];
 const result=await reviewNasMaterialCards(cards,async sources=>({direct:[0],adjacent:[],unrelated:[1],evidence:[{index:0,quote:sources[0].nas_path,reason:'요청한 대상의 시험 파일 위치가 경로에 명시되어 있습니다.'}]}));
 assert.deepEqual(result.cards,[cards[0]]);assert.match(result.answer,/원본 내용을 열어 검증한 것은 아닙니다/);assert.match(result.answer,/현장시험.pptx/);assert.ok(!result.answer.includes('다른항구'));
});
