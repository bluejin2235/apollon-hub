const { loadTs } = require('../tests/luna/helpers.cjs');
const { parseAskedWhat } = loadTs('lib/luna/ask-what.ts');
const { haystackMatchesAsked, keepSourcesUsedInAnswer } = loadTs('lib/luna/search-filter.ts');
const { isNotFoundAnswer } = loadTs('lib/luna/failures-shared.ts');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

// Component observations only: not an end-to-end or employee success score.
const material = '01 사업개발\\2026\\260108 해운대스퀘어 공공부지사업\\05 Design\\260204 KV\\PSD\\260209_해운대스퀘어 미디어쇼 KV\\01.jpg';
const rows = [];
for (const [id, question] of [
  ['haeundae-kv-typo-1', '해운대스퀀어 KV 이미지 보여줘'],
  ['haeundae-kv-typo-2', '해운대스퀵어 KV 이미지'],
  ['haeundae-kv-exact', '해운대스퀘어 KV 이미지 보여줘']
]) {
  const asked = parseAskedWhat(question);
  rows.push({ id, expected: true, actual: haystackMatchesAsked(material, asked), parsed: asked });
}
rows.push({ id: 'wrong-project-negative-control', expected: false,
  actual: haystackMatchesAsked('02 Project\\2024\\해운대 그랜드조선호텔\\KV\\01.jpg', parseAskedWhat('해운대스퀘어 KV 이미지 보여줘')) });
rows.push({ id: 'atrium-is-attribute', expected: 0,
  actual: parseAskedWhat('아트리움 이미지 보여줘').projectPhrases.length });
rows.push({ id: 'suwon-partial-evidence', expected: false,
  actual: isNotFoundAnswer('기획 자료는 확인했습니다. 아직 실제 구축·수행 단계 자료는 확인되지 않았습니다.') });
const kept = keepSourcesUsedInAnswer({ cards: [], wiki: [],
  notion: [{ title: '고래쇼 제안서', url: 'https://example.invalid/evidence' }],
  answer: '고래 공연 기획은 이 자료를 참고하면 됩니다.', hideUnused: false });
rows.push({ id: 'source-title-paraphrase', expected: 1, actual: kept.notion.length,
  caveat: 'A verified citation ID is required in the eventual fix; retaining every source is not acceptable.' });

const fingerprints = {};
for (const file of ['ask-what', 'named-entities', 'search-filter', 'failures-shared']) {
  fingerprints[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../lib/luna', `${file}.ts`))).digest('hex');
}
console.log(JSON.stringify({ data_context: 'synthetic', measurement: 'component_baseline',
  code_fingerprints: fingerprints, cases: rows.map(row => ({ ...row, passed: row.expected === row.actual })) }, null, 2));
