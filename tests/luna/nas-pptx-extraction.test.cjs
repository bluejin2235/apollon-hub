const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { loadTs } = require('./helpers.cjs');

function load(yauzl, fakeFs = fs) {
  return loadTs('lib/luna/nas-text.ts', {
    'node:fs': fakeFs, 'node:path': path,
    yauzl: { default: yauzl },
    '@/lib/luna/embedding': { contentHash: () => 'unused' }
  });
}

function fixture(mode) {
  const zip = new EventEmitter();
  let index = 0;
  let active;
  let closed = false;
  const entries = ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml'];
  zip.close = () => { closed = true; };
  zip.readEntry = () => setImmediate(() => {
    if (closed) return;
    if (index === entries.length) zip.emit('end');
    else zip.emit('entry', { fileName: entries[index++] });
  });
  zip.openReadStream = (entry, callback) => {
    if (index === 2 && mode === 'open-error') return callback(new Error('EIO slide unavailable'));
    if (index === 2 && mode === 'missing-stream') return callback(null, null);
    active = new Readable({ read() {} });
    callback(null, active);
    const stream = active;
    setImmediate(() => {
      if (index === 2 && mode === 'zip-error') {
        zip.emit('error', new Error('EIO archive read failure'));
      } else if (index === 2 && mode === 'stream-error') {
        stream.destroy(new Error('EIO slide read failure'));
      } else {
        stream.push('<a:t>Some source text</a:t>');
        stream.push(null);
      }
    });
  };
  return {
    yauzl: { open: (_file, _opts, callback) => callback(null, zip) },
    get closed() { return closed; },
    get active() { return active; }
  };
}

for (const mode of ['open-error', 'missing-stream', 'stream-error', 'zip-error']) {
  test(`PPTX ${mode} never accepts previously extracted partial text`, { timeout: 1500 }, async () => {
    const fake = fixture(mode);
    const result = await load(fake.yauzl, {...fs, statSync:()=>({size:100})}).extractNasFileText('sample.pptx', 'pptx');
    assert.equal(result.status, 'failed');
    assert.equal(result.text, '');
    assert.equal(fake.closed, true);
    if (mode === 'zip-error') assert.equal(fake.active.destroyed, true);
  });
}

test('real PPTX ZIP reads slide and note XML and never opens embedded media', async () => {
  const JSZip = require('jszip');
  const yauzl = require('yauzl');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-pptx-'));
  try {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<a:t>Slide evidence</a:t>');
    zip.file('ppt/notesSlides/notesSlide1.xml', '<a:t>Note evidence</a:t>');
    zip.file('ppt/media/image1.png', Buffer.alloc(1024 * 1024));
    const file = path.join(dir, 'sample.pptx');
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
    const opened = [];
    const tracked = { open(file, opts, callback) {
      yauzl.open(file, opts, (error, archive) => {
        if (archive) {
          const original = archive.openReadStream.bind(archive);
          archive.openReadStream = (entry, cb) => { opened.push(entry.fileName); original(entry, cb); };
        }
        callback(error, archive);
      });
    } };
    const result = await load(tracked).extractNasFileText(file, 'pptx');
    assert.equal(result.status, 'ok');
    assert.equal(result.text, 'Slide evidence\nNote evidence');
    assert.deepEqual(opened, ['ppt/slides/slide1.xml', 'ppt/notesSlides/notesSlide1.xml']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
