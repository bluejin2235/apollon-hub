const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const {loadProductionPerspectiveMessages}=loadTs('lib/luna-admin/perspective-messages.ts');
const msg=(id,parent,role='user')=>({id,conversation_id:parent,role,content:'미디어파사드'});
test('perspective counts exclude synthetic, harness, orphan and assistant dialogue',async()=>{
 const db=fakeDb({luna_messages:[msg('1','real'),msg('2','test'),msg('3','harness'),msg('4','missing'),msg('5','real','assistant')],
  luna_conversations:[{id:'real',title:'업무 테스트 방법',data_context:'production'},{id:'test',title:'normal',data_context:'synthetic'},{id:'harness',title:'[LUNA-EVAL:sample]',data_context:'production'}]});
 assert.deepEqual((await loadProductionPerspectiveMessages(db)).map(r=>r.id),['1']);
});
test('provenance lookup failure aborts the rebuild instead of returning partial counts',async()=>{
 const db=fakeDb({luna_messages:[msg('1','real')]},{luna_conversations:{message:'lookup failed'}});
 await assert.rejects(loadProductionPerspectiveMessages(db),/provenance/);
});
test('ordered pagination retains every real message across a page boundary',async()=>{
 const db=fakeDb({luna_messages:Array.from({length:501},(_,i)=>msg(String(i).padStart(4,'0'),'real')),
 luna_conversations:[{id:'real',title:'Project',data_context:'production'}]});
 const result=await loadProductionPerspectiveMessages(db);assert.equal(result.length,501);assert.equal(new Set(result.map(r=>r.id)).size,501);
});
test('obsolete generated usage counts reset even when no new terms remain; manual counts survive',()=>{
 const {obsoletePerspectiveUsageIds}=loadTs('lib/luna-admin/perspective-messages.ts');
 const rows=[{id:'old',name:'old',source:'data',used_count:9},{id:'current',name:'current',source:'data',used_count:2},{id:'manual',name:'manual',source:'human',used_count:7},{id:'zero',name:'zero',source:'data',used_count:0}];
 assert.deepEqual(obsoletePerspectiveUsageIds(rows,['current']),['old']);
 assert.deepEqual(obsoletePerspectiveUsageIds(rows,[]),['old','current']);
});
