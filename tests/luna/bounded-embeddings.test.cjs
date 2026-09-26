const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
let key = 'test-placeholder';
const { planEmbeddingRequests, createBoundedEmbeddingsBatch } = loadTs('lib/luna/bounded-embeddings.ts', {
  '@/lib/luna/embedding': { EMBEDDING_DIMS: 1536, EMBEDDING_MODEL: 'text-embedding-3-small' },
  '@/lib/luna/env-keys': { openaiApiKey: () => key }
});
const vec = () => [1, ...Array(1535).fill(0)];

test('UTF-8 budget handles Korean and emoji, reserves all calls and splits large requests', () => {
  const plan = planEmbeddingRequests(Array(100).fill('가'.repeat(2000)), 1);
  assert.equal(plan.tokensUpperBound, 600000);
  assert.equal(plan.batches.length, 4);
  assert.ok(plan.batches.every(batch => batch.input.reduce((sum, text) => sum + Buffer.byteLength(text), 0) <= 200000));
  assert.deepEqual(plan.batches.map(batch => batch.start), [0,33,66,99]);
  assert.throws(() => planEmbeddingRequests(Array(100).fill('가'.repeat(2000)), 0.001), /budget/);
  assert.equal(planEmbeddingRequests(['🌙']).tokensUpperBound, 4);
  assert.throws(() => planEmbeddingRequests(['가'.repeat(3000)]), /rechunk/);
  assert.throws(() => planEmbeddingRequests(['  ']), /empty/);
  assert.throws(() => planEmbeddingRequests(['text'], 50), /budget/);
});

test('provider response is reordered by index and deadline covers request/body', async () => {
  const original = global.fetch;
  let signal;
  global.fetch = async (url, request) => {
    assert.equal(url, 'https://api.openai.com/v1/embeddings');
    signal = request.signal;
    assert.equal(JSON.parse(request.body).encoding_format, 'float');
    return {ok:true,json:async()=>({data:[{index:1,embedding:vec()},{index:0,embedding:vec().map(n=>n*2)}],usage:{total_tokens:2}})};
  };
  try {
    const result = await createBoundedEmbeddingsBatch(['first','second']);
    assert.equal(result.vectors[0][0], 2);
    assert.equal(result.vectors[1][0], 1);
    assert.ok(signal instanceof AbortSignal);
  } finally {global.fetch=original;}
});

test('malformed vectors, missing usage and duplicate indices cannot count as success', async () => {
  const original = global.fetch;
  const valid = {data:[{index:0,embedding:vec()},{index:1,embedding:vec()}],usage:{total_tokens:2}};
  const bad = [
    {...valid,usage:{}}, {...valid,usage:{total_tokens:90000}},
    {...valid,data:[valid.data[0]]},
    {...valid,data:[valid.data[0],valid.data[0]]},
    {...valid,data:[valid.data[0],{index:1,embedding:[0]}]},
    {...valid,data:[valid.data[0],{index:1,embedding:Array(1536).fill(0)}]},
    {...valid,data:[valid.data[0],{index:1,embedding:[NaN,...Array(1535).fill(0)]}]}
  ];
  try {
    for (const json of bad) {
      global.fetch=async()=>({ok:true,json:async()=>json});
      await assert.rejects(createBoundedEmbeddingsBatch(['first','second']));
    }
  } finally {global.fetch=original;}
});

test('missing key, HTTP errors and abort do not retry or log provider bodies', async () => {
  const original = global.fetch;
  let calls=0;
  global.fetch=async()=>{calls++;return {ok:false,status:429,text:()=>{throw Error('must not read private body')}};};
  try {
    key='';
    await assert.rejects(createBoundedEmbeddingsBatch(['text']), /required/);
    assert.equal(calls,0);
    key='test-placeholder';
    await assert.rejects(createBoundedEmbeddingsBatch(['text']), /HTTP 429/);
    assert.equal(calls,1);
    global.fetch=async()=>{calls++;throw new DOMException('Aborted','AbortError')};
    await assert.rejects(createBoundedEmbeddingsBatch(['text']), {name:'AbortError'});
    assert.equal(calls,2);
  } finally {key='test-placeholder';global.fetch=original;}
});


test('deadline actually aborts a stalled paid request and never retries it',async()=>{
 const originalFetch=global.fetch,originalTimer=global.setTimeout;
 let calls=0,deadline=0;
 global.setTimeout=(fn,ms)=>{deadline=ms;return originalTimer(fn,0)};
 global.fetch=async(_url,request)=>{
  calls++;
  return new Promise((_resolve,reject)=>request.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 };
 try{
  await assert.rejects(createBoundedEmbeddingsBatch(['source']),{name:'AbortError'});
  assert.equal(deadline,60000);assert.equal(calls,1);
 }finally{global.fetch=originalFetch;global.setTimeout=originalTimer;}
});
