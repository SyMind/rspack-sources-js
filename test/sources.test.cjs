'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const ref = require('webpack-sources');
const api = require('../lib/index.js');
const binding = require('../lib/binding.js');

function digest(source) {
  const hash = createHash('sha256');
  source.updateHash(hash);
  return hash.digest('hex');
}
function compare(build, { native = true } = {}) {
  for (const options of [undefined, {}, { columns: true }, { columns: false }]) {
    const a = build(api), b = build(ref);
    binding.debugSourceStats(true);
    assert.deepStrictEqual(a.map(options), b.map(options));
    assert.equal(JSON.stringify(a.map(options)), JSON.stringify(b.map(options)));
    assert.deepStrictEqual(a.sourceAndMap(options), b.sourceAndMap(options));
    if (native) assert.ok(binding.debugSourceStats().nativeReads > 0, 'fixture must exercise Rust');
    assert.equal(a.source(), b.source());
    assert.deepStrictEqual(a.buffer(), b.buffer());
    assert.equal(a.size(), b.size());
    assert.equal(digest(a), digest(b));
  }
}

for (const value of ['', 'abc', '\n', 'a\r\nb\n', 'const x = 1;\nconsole.log(x);\n', '中文😀\nconst é = "a";', 'a\0b']) {
  test(`OriginalSource ${JSON.stringify(value)}`, () => compare(w => new w.OriginalSource(value, 'input.js')));
  test(`ConcatSource ${JSON.stringify(value)}`, () => compare(w => new w.ConcatSource('// prefix\n', new w.OriginalSource(value, 'input.js'), '\nend')));
}

test('batched replacements use UTF-16 inclusive endpoints', () => {
  compare(w => {
    const r = new w.ReplaceSource(new w.OriginalSource('A😀B 中文\nsecond line\n', 'in.js'), 'replaced');
    r.replace(1, 2, '🙂', 'emoji');
    r.insert(0, '/* start */');
    r.insert(0, '/* next */');
    r.replace(5, 6, '汉字');
    return new w.ConcatSource('[', r, ']');
  });
});

test('sharing a child rejects edits before and after native reads', () => {
  const child = new api.ReplaceSource(new api.OriginalSource('abc', 'in.js'));
  child.replace(0, 0, 'X');
  const parent = new api.ConcatSource('[', child, ']');
  assert.throws(() => child.insert(0, 'x'), /Cannot modify shared ReplaceSource/);
  const held = binding.debugSourceSnapshot(parent);
  assert.equal(parent.sourceAndMap().source, '[Xbc]');
  assert.throws(() => child.replace(1, 1, 'y'), /Cannot modify shared ReplaceSource/);
  assert.equal(child.getReplacements().length, 1);
  assert.throws(() => parent.add('!'), /Cannot modify shared ConcatSource/);
  const bytes = Buffer.from(held.buffer());
  bytes[0] = 0;
  assert.equal(held.source(), '[Xbc]');
  assert.equal(parent.source(), '[Xbc]');
});

test('successive edits apply to the uniquely owned source', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('a'.repeat(1000), 'in.js'));
  binding.debugSourceStats(true);
  for (let i = 0; i < 1000; i++) r.replace(i, i, 'b');
  assert.equal(binding.debugSourceStats().mutations, 1000);
  assert.equal(r.sourceAndMap().source, 'b'.repeat(1000));
});

test('reusing one child in several positions retains the shared source', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('x', 'x.js'));
  r.insert(0, 'a');
  const a = new api.ConcatSource(r, r, r);
  assert.equal(a.sourceAndMap().source, 'axaxax');
  assert.throws(() => r.insert(0, '!'), /Cannot modify shared ReplaceSource/);
});

test('concatenation preserves deleted originals and closes nested mappings at raw text', () => {
  const build = w => {
    const deleted = new w.ReplaceSource(new w.OriginalSource('old', 'deleted.js'));
    deleted.replace(0, 2, '');
    const body = new w.CachedSource(new w.ConcatSource(new w.OriginalSource('}', 'body.js'), '\n}'));
    return new w.ConcatSource(new w.CachedSource(new w.ConcatSource('header\n', deleted)), body);
  };
  const actual = build(api);
  const expected = build(ref).sourceAndMap();
  assert.deepEqual(expected.map.sources, ['deleted.js', 'body.js']);
  assert.deepEqual(actual.sourceAndMap(), expected);
  assert.deepEqual(actual.map(), expected.map);
});

test('line-only maps retain replacement names across native cache hits', () => {
  const edited = new api.ReplaceSource(new api.OriginalSource('one two', 'input.js'));
  edited.replace(0, 2, 'three', 'one');
  const prefixed = new api.PrefixSource('> ', new api.CachedSource(edited));
  const first = prefixed.map({ columns: false });
  assert.deepEqual(first.names, ['one']);
  assert.deepEqual(prefixed.map({ columns: false }), first);
});

test('nested ConcatSource captures children when flattened', () => {
  const a = new api.ConcatSource('a'); const b = new api.ConcatSource(a);
  a.add('b'); assert.equal(b.sourceAndMap().source, 'a');
});

test('a parent can append while its shared child rejects edits', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  r.replace(0, 0, 'x');
  const p = new api.ConcatSource(r);
  assert.equal(p.sourceAndMap().source, 'xbc');
  r.getReplacements()[0].content = 'y';
  assert.equal(p.sourceAndMap().source, 'xbc');
  assert.throws(() => r.replace(1, 1, 'Y'), /Cannot modify shared ReplaceSource/);
  const end = new api.OriginalSource('!', 'end');
  p.getChildren().push(end);
  assert.equal(p.sourceAndMap().source, 'xbc');
  p.add(end);
  assert.equal(p.sourceAndMap().source, 'xbc!');
});

test('CachedSource retains the source and map across a rejected edit', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  const cached = new api.CachedSource(r);
  const before = cached.sourceAndMap();
  assert.throws(() => r.replace(0, 0, 'X'), /Cannot modify shared ReplaceSource/);
  binding.debugSourceStats(true);
  assert.deepStrictEqual(cached.sourceAndMap(), before);
  assert.equal(binding.debugSourceStats().nativeReads, 0);
  assert.equal(r.source(), 'abc');
  assert.strictEqual(cached.map(), before.map);
});

for (const value of ['\ud800', 'A\ude00B']) {
  test('OriginalSource maps isolated surrogates in Rust ' + JSON.stringify(value), () => compare(w => new w.OriginalSource(value, 'x')));
}
test('OriginalSource maps Buffer and UTF-16 inputs in Rust', () => {
  const name = 'input\udc00.js';
  for (const value of [Buffer.from('a; b\n'), 'x\ud800; 😀\n', '']) {
    const source = new api.OriginalSource(value, name);
    const reference = new ref.OriginalSource(value, name);
    if (Buffer.isBuffer(value)) value[0] = 0xff;
    binding.debugSourceStats(true);
    assert.deepEqual(source.map({ get columns() { return true; } }), reference.map());
    if (Buffer.isBuffer(value)) value.fill(0);
    assert.deepEqual(source.sourceAndMap({ columns: false }), reference.sourceAndMap({ columns: false }));
    assert.equal(binding.debugSourceStats().nativeReads, 2);
    assert.equal(binding.debugSourceStats().fallbacks, 0);
  }
});

for (const [start, end] of [[1, 1], [-1, 0], [0.5, 1], [50, 70], [2, 0]]) {
  test(`unsupported edit fallback ${start}:${end}`, () => compare(w => {
    const r = new w.ReplaceSource(new w.OriginalSource('A😀B', 'x')); r.replace(start, end, 'X'); return r;
  }, { native: false }));
}

test('overlapping edits and insert after replacement use JS semantics', () => compare(w => {
  const r = new w.ReplaceSource(new w.OriginalSource('abcdef', 'x'));
  r.replace(0, 3, 'x');r.replace(2, 4, 'y');return r;
}, { native: false }));

test('copying the Buffer passed to a hash preserves the OriginalSource bytes', () => {
  const text = 'a中😀';
  const source = new api.OriginalSource(text, 'input.js');
  const snapshot = binding.debugSourceSnapshot(source);
  const chunks = [];
  source.updateHash({ update(value) { chunks.push(value); return this; } });
  assert.deepStrictEqual(chunks, ['OriginalSource', Buffer.from(text), 'input.js']);
  assert.deepEqual(source.buffer(), chunks[1]);

  const copy = Buffer.from(chunks[1]);
  copy[0] = 98;
  assert.equal(copy.toString(), 'b中😀');
  assert.equal(snapshot.source(), text);
  assert.equal(source.source(), text);
  assert.equal(source.sourceAndMap().source, text);
  assert.equal(source.buffer().toString(), text);
});

test('RawSource and SourceMapSource hash Buffers match their prepared snapshots', () => {
  const text = 'abc😀';
  const map = { version: 3, sources: ['in.js'], sourcesContent: [text], names: [], mappings: 'AAAA' };
  for (const source of [new api.RawSource(text), new api.SourceMapSource(text, 'in.js', map)]) {
    const snapshot = binding.debugSourceSnapshot(source);
    const chunks = [];
    source.updateHash({ update(value) { chunks.push(value); return this; } });
    const bytes = chunks[1];
    assert.deepEqual(bytes, Buffer.from(text));
    assert.deepEqual(source.buffer(), bytes);
    assert.deepEqual(snapshot.buffer(), bytes);
    assert.equal(snapshot.source(), text);
    assert.equal(source.source(), text);
  }
});

test('mutable Buffer follows reference method-local string caching', () => {
  function run(w) {
    const data = Buffer.from('abc'); const raw = new w.RawSource(data);
    assert.strictEqual(raw.source(), data);
    const p = new w.ConcatSource(new w.OriginalSource('prefix', 'x'), raw);
    const before = p.sourceAndMap();
    data[0] = 88;
    return { before, after: p.sourceAndMap(), raw: raw.source(), buffer: raw.buffer() };
  }
  binding.debugSourceStats(true);
  assert.deepStrictEqual(run(api), run(ref));
  assert.ok(binding.debugSourceStats().fallbacks > 0);
});

test('custom Sources participate in composite source maps', () => {
  class Custom extends api.Source {
    source() { return 'custom'; }
    updateHash(hash) { hash.update('custom'); }
  }
  compare(w => new w.ConcatSource(new w.CompatSource(new Custom()), new w.OriginalSource('a', 'x')), { native: false });
});

const rawMap = () => ({ version: 3, sources: ['original.js'], names: [], sourcesContent: ['let a=1;\n'], mappings: 'AAAA', file: 'generated.js' });
test('SourceMapSource direct map retains identity', () => {
  const map = rawMap(); const s = new api.SourceMapSource('let a=1;\n', 'generated.js', map);
  assert.strictEqual(s.map(), map); map.file='other'; assert.strictEqual(s.sourceAndMap().map, map);
});
test('SourceMapSource in concat uses Rust and observes map mutation', () => {
  compare(w => new w.ConcatSource('// pre\n', new w.SourceMapSource('let a=1;\n', 'generated.js', rawMap())));
  const map=rawMap(); const s=new api.ConcatSource(new api.SourceMapSource('let a=1;\n','generated.js',map));
  s.map(); map.sources[0]='changed.js'; assert.deepStrictEqual(s.map().sources,['changed.js']);
});
test('nested source-map composition', () => compare(w => new w.SourceMapSource('let a=1;\n', 'generated.js', {
  version:3,sources:['generated.js'],sourcesContent:['let a=1;\n'],names:[],mappings:'AAAA',
}, 'let a=1;\n', rawMap(), true)));
test('map string inputs and missing sourcesContent', () => compare(w => new w.ConcatSource(new w.SourceMapSource('abc', 'x', JSON.stringify({version:3,sources:['x'],names:[],mappings:'AAAA'}))), { native: false }));

test('typed bindings validate receiver ownership and source type', () => {
  assert.throws(() => binding.rawSource({}), /Invalid Source receiver/);
  assert.throws(() => binding.originalSource(new api.RawSource('x'), true), /Invalid Source receiver/);
});
test('invalid mappings never reach the Rust decoder', () => {
  for(const mappings of ['ggggggggggggggggg', '!', 'ACAA', 'AAAAAA']) {
    const source = new api.SourceMapSource('x', 'x', {version:3,sources:['x'],sourcesContent:['x'],names:[],mappings});
    assert.equal(binding.debugSourceSnapshot(source), null);
  }
});

test('ESM entry and public inheritance', async () => {
  const esm = await import('../lib/index.mjs');
  assert.strictEqual(esm.OriginalSource, api.OriginalSource);
  assert.ok(new api.OriginalSource('a','x') instanceof api.Source);
  assert.strictEqual(api.ReplaceSource.Replacement, require('../lib/ReplaceSource.js').Replacement);
});

test('map preserves ConcatSource child-array replacement after add', () => {
  function run(w) {
    const c = new w.ConcatSource('a');
    const old = c.getChildren();
    c.add('b'); c.map();
    old.push(new w.RawSource('obsolete'));
    return c.sourceAndMap();
  }
  assert.deepStrictEqual(run(api), run(ref));
});

test('map and later insertions leave earlier replacement snapshots untouched', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  r.insert(2, 'x');
  const first = r.getReplacements();
  r.insert(0, 'y');
  r.map();
  assert.deepEqual(first.map(e => e.start), [2]);
  assert.deepEqual(r.getReplacements().map(e => e.start), [0, 2]);
});

test('deterministic differential graphs include Unicode edits and composed maps', () => {
  let seed = 0x13579;
  const next = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const alphabet = ['a', ' ', ';', '\n', '\r\n', '中', '😀', 'é'];
  for (let fixture = 0; fixture < 64; fixture++) {
    const parts = Array.from({ length: 24 }, () => alphabet[next(alphabet.length)]);
    const value = parts.join('');
    const offsets = [0];
    for (const p of parts) offsets.push(offsets.at(-1) + p.length);
    const start = offsets[2], end = offsets[5] - 1;
    const content = alphabet[next(alphabet.length)] + 'insert\n';
    compare(w => {
      const base = fixture % 2 ? new w.OriginalSource(value, 'input.js') : new w.SourceMapSource(value, 'generated.js', new ref.OriginalSource(value, 'input.js').map());
      const r = new w.ReplaceSource(base);
      r.replace(start, end, content, 'edit'); r.insert(offsets[12], '🙂');
      return new w.ConcatSource('prefix\n', r, new w.OriginalSource('tail', 'tail.js'));
    });
  }
});

test('null source content and source-map extensions use compatible JS fallback', () => {
  for (const extra of [{ sourcesContent: [null] }, { ignoreList: [0] }, { debugId: 'id' }, { x_custom: true }]) {
    compare(w => new w.ConcatSource(new w.SourceMapSource('abc', 'x', { ...rawMap(), ...extra })), { native: false });
  }
});

test('sourceRoot composition matches the reference', () => compare(w => new w.ConcatSource(new w.SourceMapSource('let a=1;\n', 'generated.js', { ...rawMap(), sourceRoot: '/src' }))));

test('native graph lifetimes are independent across Worker teardown', async () => {
  const { Worker } = require('node:worker_threads');
  const code = `
    const { parentPort } = require('node:worker_threads');
    const api = require(${JSON.stringify(require.resolve('../lib/index.js'))});
    for (let i = 0; i < 100; i++) {
      let child = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
      child.replace(0, 0, 'X');
      const parent = new api.ConcatSource('[', child, ']');
      parent.map(); child = null;
      if (parent.sourceAndMap().source !== '[Xbc]') throw new Error('stale snapshot');
    }
    parentPort.postMessage('ok');
  `;
  for (let round = 0; round < 2; round++) {
    await Promise.all(Array.from({ length: 2 }, () => new Promise((resolve, reject) => {
      const worker = new Worker(code, { eval: true });
      let message;
      worker.on('message', value => { message = value; });
      worker.on('error', reject);
      worker.on('exit', exitCode => {
        try { assert.equal(exitCode, 0); assert.equal(message, 'ok'); resolve(); } catch (e) { reject(e); }
      });
    })));
  }
});

test('PrefixSource preserves mapped positions', () => compare(w => new w.PrefixSource('> ', new w.OriginalSource('a\nb\n', 'x')), { native: false }));

test('source maps and hashes never read fields of a returned replacement', () => {
  const source = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  source.replace(0, 0, 'x');
  const expected = source.sourceAndMap();
  const hash = digest(source);
  Object.defineProperty(source.getReplacements()[0], 'content', {
    get() { assert.fail('read a replacement from a returned snapshot'); },
  });
  assert.deepEqual(source.sourceAndMap(), expected);
  assert.equal(digest(source), hash);
});

test('a writable copy of SourceMapSource bytes is independent of its concat parent', () => {
  const mapped = new api.SourceMapSource('abc', 'x', rawMap());
  const concat = new api.ConcatSource(mapped);
  const copy = Buffer.from(mapped.buffer());
  copy[0] = 88;
  assert.equal(copy.toString(), 'Xbc');
  assert.equal(concat.buffer().toString(), 'abc');
});

test('proxy map options keep application callbacks on the JS path', () => {
  function run(w) {
    let reads = 0;
    const source = new w.OriginalSource('abc', 'x');
    const options = new Proxy({}, { get(target, key) { reads++; return target[key]; } });
    const result = new w.ConcatSource(source).sourceAndMap(options);
    return { result, reads };
  }
  assert.deepStrictEqual(run(api), run(ref));
});

test('mixed missing and empty sourcesContent retains nulls and trailing omissions', () => {
  for (const contents of [undefined, [], ['']]) {
    for (const first of [true, false]) {
      compare(w => {
        const s = new w.SourceMapSource('xyz', 'x', { version: 3, sources: ['unknown'], names: [], mappings: 'AAAA', ...(contents === undefined ? {} : { sourcesContent: contents }) });
        const original = new w.OriginalSource('abc', 'known');
        return new w.ConcatSource(...(first ? [s, original] : [original, s]));
      }, { native: false });
    }
  }
});

test('empty ReplaceSource delegates direct map identity to its child', () => {
  const map = rawMap();
  const child = new api.SourceMapSource('let a=1;\n', 'generated.js', map);
  const replaced = new api.ReplaceSource(child);
  assert.strictEqual(replaced.map(), map);
  assert.strictEqual(replaced.sourceAndMap().map, map);
  replaced.insert(0, 'prefix');
  const edited = replaced.sourceAndMap();
  replaced.getReplacements().length = 0;
  assert.equal(edited.source, 'prefixlet a=1;\n');
  assert.deepEqual(replaced.sourceAndMap(), edited);
});
