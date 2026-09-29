const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {NotionIndexClient}=loadTs('lib/luna/notion-index.ts',{
  crypto:require('node:crypto'),
  '@/lib/luna/embedding':{}, '@/lib/luna/env-keys':{},
  '@/lib/luna/notion':{extractWorkserverPathsFromText:()=>[]}
});
test('nested headings, toggles, lists and callouts are read, child pages remain separate',async()=>{
  const client=new NotionIndexClient('test');const calls=[];
  const tree={page:[{id:'heading',type:'heading_2',has_children:true},{id:'child',type:'child_page',has_children:true}],
    heading:[{id:'toggle',type:'toggle',has_children:true}],toggle:[{id:'callout',type:'callout',has_children:true}],
    callout:[{id:'list',type:'bulleted_list_item',has_children:true}],list:[{id:'body',type:'paragraph'}]};
  client.fetchBlockChildren=async id=>{calls.push(id);return tree[id]??[];};
  const out=await client.fetchPageBlocks('page');
  assert.deepEqual(out.map(b=>b.id),['heading','toggle','callout','list','body','child']);
  assert.ok(!calls.includes('child'));
});
test('nested fetch failures surface instead of returning an apparently complete page',async()=>{
  const client=new NotionIndexClient('test');
  client.fetchBlockChildren=async id=>{if(id==='page')return [{id:'toggle',type:'toggle',has_children:true}];throw Error('429 retry required');};
  await assert.rejects(()=>client.fetchPageBlocks('page'),/429/);
});
test('synced or repeated blocks cannot recurse indefinitely',async()=>{
  const client=new NotionIndexClient('test');let calls=0;
  client.fetchBlockChildren=async()=>{calls++;return [{id:'same',type:'synced_block',has_children:true}];};
  assert.equal((await client.fetchPageBlocks('page')).length,1);assert.equal(calls,2);
});
test('metadata request preserves rate-limit errors instead of hiding them as missing pages',async()=>{
 const old=global.fetch;let calls=0;
 try {global.fetch=async()=>{calls++;return new Response('rate limited',{status:429,headers:{'retry-after':'0.01'}});};
  await assert.rejects(()=>new NotionIndexClient('test').fetchMeta('page'),/429/);assert.equal(calls,4);
 } finally {global.fetch=old;}
});
