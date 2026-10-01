const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {displayedSourceCounts}=loadTs('components/luna/chat/answer-layout.ts',{
 '@/lib/luna/media-index-search':{hasImageSearchIntent:()=>false},
 '@/lib/luna/luna-answer-ui':{},
 '@/lib/luna/search-scope':{},
 '@/lib/luna/progress-display':{}
});
test('completed counters do not claim hidden image candidates are displayed',()=>{
 const sources={notion:[{}],work:[{},{}],wiki:[],image:Array(37).fill({})};
 assert.deepEqual(displayedSourceCounts(sources,'project','현장 테스트 자료 찾아줘'),{notion:1,work:2,wiki:0,image:0});
 assert.equal(displayedSourceCounts(sources,'reference','이미지 찾아줘').image,37);
 assert.deepEqual(displayedSourceCounts({...sources,wiki:Array(5).fill({})},'term','용어 뜻'),{notion:0,work:0,wiki:3,image:0});
});
