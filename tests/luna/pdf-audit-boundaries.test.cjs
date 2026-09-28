const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('PDF audit bounds, identity and OCR authority fail closed', () => {
  const program = `
import importlib.util
spec = importlib.util.spec_from_file_location('audit', 'scripts/probe-nas-pdf.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def rejects(f):
    try: f()
    except ValueError: return
    raise AssertionError('unsafe input accepted')
assert m.selected_pages('', 14) == []
assert m.selected_pages('4,2,3', 14) == [2,3,4]
for value in ['0', '15', '1,1', '1,2,3,4,5,6', '../2', '1;touch /tmp/bad']:
    rejects(lambda: m.selected_pages(value,14))
data = b'%PDF-synthetic-identity'
assert m.check_source(data, m.sha(data)) == m.sha(data)
rejects(lambda: m.check_source(data, '0'*64))
rejects(lambda: m.check_source(b'not-pdf', None))
assert m.render_dimensions(72,72,300) == (300,300)
rejects(lambda: m.render_dimensions(72000,72000,300))
rejects(lambda: m.render_dimensions(0,72,300))
ocr = m.ocr_observation(2, 'perfect-looking OCR', 'hash')
assert ocr['review_state'] == 'candidate' and ocr['verified_claims'] == []
assert ocr['text'] == 'perfect-looking OCR'
`;
  const result = spawnSync('python3', ['-B', '-c', program], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
