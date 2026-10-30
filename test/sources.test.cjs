'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const ref = require('webpack-sources-reference');
const api = require('../lib/index.cjs');
const planner = require('../lib/planner.cjs');
const binding = require('../lib/binding.cjs');

function digest(source) {
  const hash = createHash('sha256');
  source.updateHash(hash);
  return hash.digest('hex');
}
function stream(source, options) {
  const events = [];
  const result = source.streamChunks(options,
    (...args) => events.push(['chunk', ...args]),
    (...args) => events.push(['source', ...args]),
    (...args) => events.push(['name', ...args]));
  return { events, result };
}
function compare(build, { native = true } = {}) {
  for (const options of [undefined, {}, { columns: true }, { columns: false }]) {
    const a = build(api), b = build(ref);
    planner.resetStats();
    assert.deepStrictEqual(a.map(options), b.map(options));
    assert.equal(JSON.stringify(a.map(options)), JSON.stringify(b.map(options)));
    assert.deepStrictEqual(a.sourceAndMap(options), b.sourceAndMap(options));
    if (native) assert.ok(planner.stats.nativeReads > 0, 'fixture must exercise Rust');
    assert.equal(a.source(), b.source());
    assert.deepStrictEqual(a.buffer(), b.buffer());
    assert.equal(a.size(), b.size());
    assert.equal(digest(a), digest(b));
    assert.deepStrictEqual(a.buffers(), b.buffers());
    for (const flags of [{}, { finalSource: true }, { source: false, finalSource: true }]) {
      planner.resetStats();
      assert.deepStrictEqual(stream(a, { ...options, ...flags }), stream(b, { ...options, ...flags }));
      assert.equal(planner.stats.nativeReads, 0, 'streamChunks stays entirely in JS');
      assert.equal(planner.stats.compilations, 0, 'streamChunks does not compile native graphs');
    }
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

test('snapshot reuse and child mutation rebuild only affected nodes', () => {
  const child = new api.ReplaceSource(new api.OriginalSource('abc', 'in.js'));
  const parent = new api.ConcatSource('[', child, ']');
  planner.resetStats();
  assert.equal(parent.sourceAndMap().source, '[abc]');
  const old = planner.prepare(parent);
  const count = planner.stats.compiledNodes;
  parent.map();
  assert.equal(planner.stats.compiledNodes, count);
  child.replace(0, 0, 'X');
  assert.equal(parent.sourceAndMap().source, '[Xbc]');
  assert.equal(old.source(), '[abc]', 'old Rust snapshot stays alive and immutable');
  assert.equal(planner.stats.compiledNodes - count, 2, 'only Replace and parent rebuilt');
  const bytes = old.buffer(); bytes[0] = 0;
  assert.equal(old.source(), '[abc]', 'returned Buffer does not alias Rust data');
});

test('no native calls while accumulating edits; one compilation batch on read', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('a'.repeat(1000), 'in.js'));
  planner.resetStats();
  for (let i = 0; i < 1000; i++) r.replace(i, i, 'b');
  assert.equal(planner.stats.compilations, 0);
  assert.equal(r.sourceAndMap().source, 'b'.repeat(1000));
  assert.equal(planner.stats.compilations, 1);
});

test('shared DAG children are compiled once', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('x', 'x.js'));
  const a = new api.ConcatSource(r, r, r);
  planner.resetStats(); a.map();
  assert.equal(planner.stats.compiledNodes, 3);
  r.insert(0, 'a');
  assert.equal(a.sourceAndMap().source, 'axaxax');
});

test('nested ConcatSource captures children when flattened', () => {
  const a = new api.ConcatSource('a'); const b = new api.ConcatSource(a);
  a.add('b'); assert.equal(b.sourceAndMap().source, 'a');
});

test('exposed child array and replacement objects invalidate snapshots', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  r.replace(0, 0, 'x');
  const p = new api.ConcatSource(r);
  assert.equal(p.sourceAndMap().source, 'xbc');
  r.getReplacements()[0].content = 'y';
  assert.equal(p.sourceAndMap().source, 'ybc');
  p.getChildren().push(new api.OriginalSource('!', 'end'));
  assert.equal(p.sourceAndMap().source, 'ybc!');
});

test('CachedSource keeps method-local cache semantics and clearCache restores reads', () => {
  const r = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  const cached = new api.CachedSource(r);
  const before = cached.sourceAndMap();
  r.replace(0, 0, 'X');
  planner.resetStats();
  assert.deepStrictEqual(cached.sourceAndMap(), before);
  assert.equal(planner.stats.nativeReads, 0);
  cached.clearCache();
  assert.equal(cached.sourceAndMap().source, 'Xbc');
});

test('CachedSource lazy and cachedData interchange', () => {
  let calls = 0;
  const c = new api.CachedSource(() => { calls++; return new api.OriginalSource('abc', 'x'); });
  c.clearCache(); assert.equal(calls, 0);
  const value = c.sourceAndMap(); digest(c);
  const restored = new ref.CachedSource(() => { throw new Error('must use cache'); }, c.getCachedData());
  assert.deepStrictEqual(restored.sourceAndMap(), value);
  assert.equal(digest(restored), digest(c));
  assert.equal(calls, 1);
});

for (const value of ['\ud800', 'A\ude00B']) {
  test('isolated surrogate JS fallback ' + JSON.stringify(value), () => compare(w => new w.OriginalSource(value, 'x'), { native: false }));
}
for (const [start, end] of [[1, 1], [-1, 0], [0.5, 1], [50, 70], [2, 0]]) {
  test(`unsupported edit fallback ${start}:${end}`, () => compare(w => {
    const r = new w.ReplaceSource(new w.OriginalSource('A😀B', 'x')); r.replace(start, end, 'X'); return r;
  }, { native: false }));
}

test('overlapping edits and insert after replacement use JS semantics', () => compare(w => {
  const r = new w.ReplaceSource(new w.OriginalSource('abcdef', 'x'));
  r.replace(0, 3, 'x');r.replace(2, 4, 'y');return r;
}, { native: false }));

test('mutable Buffer follows reference method-local string caching', () => {
  function run(w) {
    const data = Buffer.from('abc'); const raw = new w.RawSource(data);
    assert.strictEqual(raw.source(), data);
    const p = new w.ConcatSource(new w.OriginalSource('prefix', 'x'), raw);
    const before = p.sourceAndMap();
    data[0] = 88;
    return { before, after: p.sourceAndMap(), raw: raw.source(), buffer: raw.buffer() };
  }
  planner.resetStats();
  assert.deepStrictEqual(run(api), run(ref));
  assert.equal(planner.stats.nativeReads, 0);
});

test('custom Source and overridden streamChunks remain JS', () => {
  class Custom extends api.Source {
    source() { return 'custom'; }
    updateHash(hash) { hash.update('custom'); }
  }
  compare(w => new w.ConcatSource(new Custom(), new w.OriginalSource('a', 'x')), { native: false });
  const o = new api.OriginalSource('x', 'x');
  o.map(); let calls = 0;
  const original = o.streamChunks;
  o.streamChunks = function (...args) { calls++; return original.apply(this, args); };
  planner.resetStats(); o.map();
  assert.equal(calls, 1); assert.equal(planner.stats.nativeReads, 0);
});

test('streamChunks callback exceptions stop immediately without Rust entry', () => {
  const source = new api.ConcatSource(new api.OriginalSource('a\nb\n', 'x'));
  const error = new Error('stop'); let count = 0;
  planner.resetStats();
  assert.throws(() => source.streamChunks({}, () => { count++; throw error; }, () => {}, () => {}), e => e === error);
  assert.equal(count, 1); assert.equal(planner.stats.compilations, 0);
});

test('scopes stay in JavaScript', () => compare(w => new w.OriginalSource('let a=1;', 'x', new Map([['a', 'a']])), { native: false }));
test('scopes map option is preserved', () => {
  const make = w => new w.ConcatSource(new w.OriginalSource('let a=1;', 'x', new Map([['a', 'a']])));
  planner.resetStats();assert.deepStrictEqual(make(api).map({ scopes: true }), make(ref).map({ scopes: true }));
  assert.equal(planner.stats.nativeReads, 0);
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

test('native input reference bounds are checked', () => {
  assert.throws(() => binding.compileSources([{kind:'concat',children:[0]}], []), /Invalid source reference/);
  assert.throws(() => binding.compileSources([{kind:'concat',children:[-1]}], []), /Invalid source reference/);
});
test('invalid mappings never reach the Rust decoder', () => {
  for(const mappings of ['ggggggggggggggggg', '!', 'ACAA', 'AAAAAA']) {
    assert.equal(binding.compileSources([{kind:'mapped',text:'x',name:'x',sourceMap:{sources:['x'],sourcesContent:['x'],names:[],mappings}}],[]),null);
  }
});

test('ESM entry and public inheritance', async () => {
  const esm = await import('../lib/index.mjs');
  assert.strictEqual(esm.OriginalSource, api.OriginalSource);
  assert.ok(new api.OriginalSource('a','x') instanceof api.Source);
  assert.strictEqual(api.ReplaceSource.Replacement, ref.ReplaceSource.Replacement);
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

test('map sorts the same exposed replacement array as the reference', () => {
  function run(w) {
    const r = new w.ReplaceSource(new w.OriginalSource('abc', 'x'));
    r.insert(2, 'x'); const edits = r.getReplacements();
    r.insert(0, 'y'); r.map();
    return edits.map(e => e.start);
  }
  assert.deepStrictEqual(run(api), run(ref));
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
    const api = require(${JSON.stringify(require.resolve('../lib/index.cjs'))});
    for (let i = 0; i < 100; i++) {
      let child = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
      const parent = new api.ConcatSource('[', child, ']');
      parent.map(); child.replace(0, 0, 'X'); child = null;
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

test('CachedSource streaming is JS for both cold and populated caches', () => {
  for (const warm of [false, true]) {
    const a = new api.CachedSource(new api.OriginalSource('abc\ndef', 'x'));
    const b = new ref.CachedSource(new ref.OriginalSource('abc\ndef', 'x'));
    if (warm) { a.sourceAndMap(); b.sourceAndMap(); }
    planner.resetStats();
    assert.deepStrictEqual(stream(a, {}), stream(b, {}));
    assert.equal(planner.stats.nativeReads, 0);
    assert.equal(planner.stats.compilations, 0);
  }
});

test('PrefixSource stays in JS with matching streaming callbacks', () => compare(w => new w.PrefixSource('> ', new w.OriginalSource('a\nb\n', 'x')), { native: false }));

test('exposed replacement accessors do not run during native eligibility checks', () => {
  function run(w) {
    let reads = 0;
    const r = new w.ReplaceSource(new w.OriginalSource('abc', 'x'));
    r.replace(0, 0, 'x');
    Object.defineProperty(r.getReplacements()[0], 'content', { get() { reads++; return 'x'; } });
    return { result: r.sourceAndMap(), reads };
  }
  planner.resetStats();
  assert.deepStrictEqual(run(api), run(ref));
  assert.equal(planner.stats.nativeReads, 0);
});

test('proxy Sources and options keep application callbacks on the JS path', () => {
  function run(w) {
    let reads = 0;
    const source = new Proxy(new w.OriginalSource('abc', 'x'), { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } });
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
  replaced.insert(0, 'prefix'); replaced.map();
  replaced.getReplacements().length = 0;
  assert.strictEqual(replaced.map(), map);
});
