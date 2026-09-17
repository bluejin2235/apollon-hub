import assert from 'node:assert/strict';
import {
  resolveAnswerMode,
  shouldShowImageChrome
} from '../components/luna/chat/answer-layout';

const term = resolveAnswerMode({
  questionText: '디지털 랜드마크가 뭐야?',
  classification: { types: ['know'], labels: ['알기'], confidence: 0.9 },
  steps: [
    { key: 'ui_read', label: '질문을 읽었습니다 — 용어·정의', status: 'done' },
    { key: 'ui_glossary', label: '용어사전을 찾았습니다', status: 'done', right: '1건' }
  ]
});
assert.equal(term, 'term');
assert.equal(shouldShowImageChrome(term, '디지털 랜드마크가 뭐야?'), false);

const project = resolveAnswerMode({
  questionText: '인스파이어 시즌4 진행 현황 어떻게 돼?',
  classification: { types: ['find'], labels: ['찾기'], confidence: 0.9 },
  steps: [
    { key: 'ui_read', label: '질문을 읽었습니다 — 프로젝트 현황', status: 'done' },
    { key: 'ui_notion', label: '노션에서 찾았습니다', status: 'done', right: '12건' },
    { key: 'ui_link', label: '연결 자료를 따라갔습니다', status: 'done', right: '+18건' },
    { key: 'ui_work', label: 'Work서버 폴더를 찾았습니다', status: 'done', right: '6건' }
  ]
});
assert.equal(project, 'project');
assert.equal(shouldShowImageChrome(project, '인스파이어 시즌4 진행 현황 어떻게 돼?'), false);

const reference = resolveAnswerMode({
  questionText: '미디어 파사드 설치 사례 이미지 보여줘',
  classification: { types: ['find'], labels: ['찾기'], confidence: 0.9 },
  steps: [
    { key: 'ui_read', label: '질문을 읽었습니다 — 사례·레퍼런스', status: 'done' },
    { key: 'ui_notion', label: '노션에서 찾았습니다', status: 'done', right: '4건' },
    { key: 'ui_image', label: '관련 이미지를 찾았습니다', status: 'done', right: '8건' }
  ]
});
assert.equal(reference, 'reference');
assert.equal(shouldShowImageChrome(reference, '미디어 파사드 설치 사례 이미지 보여줘'), true);

const caseShow = resolveAnswerMode({
  questionText: '우리가 한 미디어파사드 사례 보여줘',
  classification: { types: ['find'], labels: ['찾기'], confidence: 0.9 },
  steps: [
    { key: 'ui_read', label: '질문을 읽었습니다 — 사례·레퍼런스', status: 'done' },
    { key: 'ui_notion', label: '노션에서 찾았습니다', status: 'done', right: '27건' },
    { key: 'ui_image', label: '관련 이미지를 찾았습니다', status: 'done', right: '0건' }
  ]
});
assert.equal(caseShow, 'reference');
assert.equal(shouldShowImageChrome(caseShow, '우리가 한 미디어파사드 사례 보여줘'), true);

console.log('chat-v2 modes ok', { term, project, reference, caseShow });
