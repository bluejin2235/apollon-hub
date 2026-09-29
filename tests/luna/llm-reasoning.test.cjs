const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
const engine = {
  readOpenAiUsage: u => u, emptyUsage: () => ({}),
  getTierModel: async () => ({model_id:'gpt-5.6-luna'}),
  resolveProviderModel: m => ({...m,provider:'openai'}), bumpUsageDaily: () => {}
};
const { llmComplete, lunaLlmComplete, llmStreamText } = loadTs('lib/luna/llm/client.ts', {
  '@anthropic-ai/sdk': {}, '@/lib/luna/engine': engine,
  '@/lib/luna/notify': {},
  '@/lib/luna/prompt-cache': {flattenSystem: s => s, shouldApplyPromptCache: () => false},
  '@/lib/luna/env-keys': {openaiApiKey: () => 'test-only-placeholder'}
});
test('tier completion passes requested reasoning and budget to provider without changing model', async t => {
  let sent;
  t.mock.method(globalThis,'fetch',async (_url,init) => {
    sent=JSON.parse(init.body);
    return new Response(JSON.stringify({choices:[{message:{content:'{"direct":[0]}'}}],usage:{completion_tokens:60}}));
  });
  const result=await lunaLlmComplete({}, {tier:'B',feature:'eval_grade',user:'source',system:'review',maxTokens:8192,reasoningEffort:'low'});
  assert.equal(sent.model,'gpt-5.6-luna'); assert.equal(sent.reasoning_effort,'low');
  assert.equal(sent.max_completion_tokens,8192); assert.match(result.text,/direct/);
  await llmComplete({provider:'openai',model_id:'gpt-5.6-luna',user:'short'});
  assert.equal(sent.reasoning_effort,'none');
  await llmComplete({provider:'openai',model_id:'gpt-4o-mini',user:'short',reasoningEffort:'low'});
  assert.equal(sent.reasoning_effort,undefined);
});
test('streaming preserves visible output and usage with opt-in reasoning', async t => {
  let sent;
  t.mock.method(globalThis,'fetch',async (_url,init) => {
    sent=JSON.parse(init.body);
    return new Response('data: {"choices":[{"delta":{"content":"verified"}}]}\n\ndata: {"choices":[],"usage":{"completion_tokens":90}}\n\ndata: [DONE]\n\n');
  });
  const chunks=[];
  for await(const c of llmStreamText({provider:'openai',model_id:'gpt-5.6-luna',user:'question',maxTokens:10000,reasoningEffort:'low'})) chunks.push(c);
  assert.equal(sent.reasoning_effort,'low'); assert.equal(sent.max_completion_tokens,10000);
  assert.equal(chunks.map(c=>c.delta).join(''),'verified'); assert.equal(chunks.at(-1).usage.completion_tokens,90);
});
