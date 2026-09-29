const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {applyNotionEvidenceReview}=loadTs('lib/luna/notion-evidence-review.ts');
const sources=Array.from({length:8},(_,i)=>({id:String(i),excerpt:'원문 '+i}));
test('validated review orders direct evidence first without dropping related material requested in full',()=>{
 const result=applyNotionEvidenceReview(sources,{direct:[3,1],adjacent:[0,2,4,5,6],unrelated:[7]});
 assert.deepEqual(result.map(s=>s.id),['3','1','0','2','4','5','6']);
 assert.equal(result[0],sources[3]);
});
test('omitted, duplicate, fabricated or empty-positive reviews cannot erase evidence',()=>{
 for(const review of [null,{direct:[3],adjacent:[],unrelated:[]},
 {direct:[1,1],adjacent:[2,3,4,5,6],unrelated:[7]},
 {direct:[99],adjacent:[0,1,2,3,4,5],unrelated:[6]},
 {direct:[],adjacent:[],unrelated:[0,1,2,3,4,5,6,7]}])
 assert.equal(applyNotionEvidenceReview(sources,review),sources);
});
