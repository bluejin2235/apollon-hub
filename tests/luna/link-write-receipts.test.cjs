const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {insertLinkBatch,updateLinkEvidence}=loadTs('lib/luna-admin/link-write-receipts.ts');
const row={from_type:'notion_page',from_id:'a',to_type:'project',to_id:'p',kind:'belongs',confidence:.9,evidence:{},source:'rule',status:'active'};
const db=result=>({from(){return{upsert(_rows,opts){assert.equal(opts.ignoreDuplicates,true);return{select:async()=>result}},
 update(){return{eq(){return{select(){return{single:async()=>result}}}}}}}}});
test('insert count uses acknowledged unique relations, not requested batch size',async()=>{
 assert.equal(await insertLinkBatch(db({data:[row]}),[row,{...row,from_id:'b'}]),1);
 assert.equal(await insertLinkBatch(db({data:[]}),[row]),0);
});
test('missing, duplicate and foreign receipts cannot report successful insert totals',async()=>{
 for(const result of [{data:null},{data:[row,row]},{data:[{...row,from_id:'foreign'}]},{data:[{}]},{error:{message:'write failed'}}]){
  await assert.rejects(insertLinkBatch(db(result),[row]),/receipt|write failed/);
 }
});
test('empty batch makes no request and oversized batch is rejected',async()=>{
 assert.equal(await insertLinkBatch({},[]),0);
 await assert.rejects(insertLinkBatch({},Array(201).fill(row)),/limit/);
});
test('evidence merge requires exact row acknowledgement and surfaces update failures',async()=>{
 await updateLinkEvidence(db({data:{id:'id'}}),'id',1,{});
 for(const result of [{data:null},{data:{id:'other'}},{error:{message:'update failed'}}]){
  await assert.rejects(updateLinkEvidence(db(result),'id',1,{}),/receipt|update failed/);
 }
});
