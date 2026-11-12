'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const api = require('../dist');
const binding = require('../dist/binding');
const ref = require('webpack-sources');

test('constructors bind native state before the first read', () => {
  binding.debugSourceStats(true);
  const original = new api.OriginalSource('abc', 'input.js');
  const replaced = new api.ReplaceSource(original, 'edited');
  assert.equal(binding.debugSourceStats().creations, 2);
  assert.equal(binding.debugSourceStats().compiledNodes, 2);
  assert.equal(binding.replaceGetField(replaced, '_name'), 'edited');
  const before = binding.debugSourceStats().compiledNodes;
  replaced.map(); replaced.map({ columns: false });
  assert.equal(binding.debugSourceStats().compiledNodes, before);
  replaced.replace(0, 0, 'X');
  assert.equal(binding.debugSourceStats().mutations, 1);
  assert.equal(binding.debugSourceStats().compiledNodes, before);
  assert.equal(replaced.sourceAndMap().source, 'Xbc');
  assert.equal(binding.debugSourceStats().compiledNodes, before + 1);
});

test('ConcatSource binds one mutable Rust source to the JS receiver', () => {
  const raw = new api.RawSource('a');
  const before = binding.debugSourceStats().creations;
  const source = new api.ConcatSource(raw);
  assert.equal(binding.debugSourceStats().creations, before + 1);
  assert.deepEqual(binding.concatGetChildren(source), [raw]);
  binding.concatAdd(source, 'b');
  assert.equal(source.source(), 'ab');
  source.addAllSkipOptimizing([raw]);
  assert.equal(binding.concatSource(source), 'aba');
  assert.throws(() => binding.concatAdd(raw, 'x'), /Invalid Source receiver/);
});

test('edits to a children snapshot never change the source or a later snapshot', () => {
  const child = new api.CompatSource({ source: () => 'custom' });
  const source = new api.ConcatSource('a', child);
  const first = source.getChildren();
  const second = source.getChildren();
  assert.notStrictEqual(first, second);
  first.splice(0, 2, 'b', 'c');
  assert.strictEqual(second[1], child);
  assert.equal(source.source(), 'acustom');
  source.add('!');
  source.addAllSkipOptimizing([child]);
  assert.equal(second.length, 2);
  assert.deepEqual(source.getChildren().map(c => c.source()), ['a', 'custom', '!', 'custom']);
});

test('getChildren preserves distinct and shared RawSource wrappers across native reads', () => {
  const first = new api.RawSource('x');
  const second = new api.RawSource('x');
  const source = new api.ConcatSource('a', 'b', first, second, first);
  assert.equal(source.source(), 'abxxx');
  const children = source.getChildren();
  assert.equal(children.length, 4);
  assert.ok(children[0] instanceof api.RawSource);
  assert.equal(children[0].source(), 'ab');
  assert.strictEqual(children[1], first);
  assert.strictEqual(children[2], second);
  assert.strictEqual(children[3], first);
  assert.notStrictEqual(source.getChildren(), children);
  assert.strictEqual(source.getChildren()[0], children[0]);
});

test('all concrete constructors bind their state immediately', () => {
  const raw = new api.RawSource('x');
  const cached = new api.CachedSource(raw);
  assert.strictEqual(cached.originalLazy(), raw);
  assert.equal(binding.cachedSize(cached), 1);
  for (const [source, read, field, expected] of [
    [new api.PrefixSource('> ', raw), binding.prefixGetField, '_prefix', '> '],
    [new api.SizeOnlySource(10), binding.sizeOnlyGetField, '_size', 10],
    [new api.CompatSource(raw), binding.compatGetField, '_sourceLike', raw],
    [new api.SourceMapSource('x', 'x.js', {version: 3, sources: [], names: [], mappings: ''}), binding.sourceMapGetField, '_name', 'x.js'],
  ]) assert.strictEqual(read(source, field), expected);
});

test('native CachedSource resolves lazy factories with the original receiver', () => {
  let calls = 0;
  const cached = new api.CachedSource(function () {
    assert.strictEqual(this, cached);
    calls++;
    return new api.RawSource('factory');
  });
  cached.clearCache();
  assert.equal(calls, 0);
  assert.equal(cached.source(), 'factory');
  assert.strictEqual(cached.original(), cached.original());
  assert.equal(calls, 1);
});

test('CachedSource retries a failed factory and reuses its source and map separately', () => {
  const bytes = Buffer.from('abc');
  const original = new api.RawSource(bytes);
  let attempts = 0;
  let maps = 0;
  original.map = () => { maps++; return null; };
  original.sourceAndMap = () => assert.fail('combined method called');
  function factory() {
    assert.strictEqual(this, cached);
    if (++attempts === 1) throw new Error('retry');
    return original;
  }
  const cached = new api.CachedSource(factory);
  assert.strictEqual(cached.originalLazy(), factory);
  assert.throws(() => cached.sourceAndMap(), /retry/);
  assert.strictEqual(cached.originalLazy(), factory);
  assert.strictEqual(binding.cachedSourceAndMap(cached, {}).source, bytes);
  assert.deepEqual(cached.sourceAndMap({}), { source: bytes, map: null });
  assert.strictEqual(cached.originalLazy(), original);
  assert.equal(attempts, 2);
  assert.equal(maps, 1);
});

test('restored CachedSource data satisfies sourceAndMap without invoking the factory', () => {
  const factory = () => assert.fail('resolved original');
  const cached = new api.CachedSource(factory, {
    source: true,
    buffer: Buffer.from('abc'),
    maps: new Map([['{}', { bufferedMap: null }]]),
  });
  assert.deepEqual(cached.sourceAndMap(), { source: 'abc', map: null });
  assert.strictEqual(cached.originalLazy(), factory);
});

test('CachedData preserves map options and edits to an exposed map', () => {
  const source = new api.OriginalSource('const café = 1;\n', 'input.js');
  const cached = new api.CachedSource(source);
  for (const columns of [true, false]) {
    cached.map({ columns });
  }
  cached.map({ columns: true }).mappings = 'A';
  cached.clearCache({ maps: false });
  const data = cached.getCachedData();
  assert.equal(data.buffer.toString(), source.source());
  assert.equal(data.maps.size, 2);
  assert.deepEqual(data.maps.get('{"columns":true}').bufferedMap.mappings, Buffer.from('A'));
  const restored = new api.CachedSource(() => assert.fail('resolved original'), data);
  for (const columns of [true, false]) {
    assert.deepEqual(restored.map({ columns }), cached.map({ columns }));
  }
});

test('exposed replacement sort overrides remain observable', () => {
  function run(w) {
    const replaced = new w.ReplaceSource(new w.OriginalSource('abc', 'x'));
    replaced.insert(0, '!');
    const array = replaced.getReplacements();
    array.sort = () => array;
    replaced.insert(-1, '?');
    return {source: replaced.source(), edits: array.map(e => [e.start, e.content])};
  }
  assert.deepEqual(run(api), run(ref));
});

test('removing a shared child from a snapshot preserves both native edges', () => {
  const child = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  const parent = new api.ConcatSource(child, child);
  parent.map();
  parent.getChildren().pop();
  parent.map();
  child.replace(0, 0, 'X');
  assert.equal(parent.sourceAndMap().source, 'XbcXbc');
});

test('native edges preserve JS identity and JS cycles remain collectible', () => {
  const script = `
    const assert = require('node:assert/strict');
    const api = require(${JSON.stringify(require.resolve('../dist'))});
    const tick = () => new Promise(resolve => setImmediate(resolve));
    (async () => {
      let child = new api.OriginalSource('abc', 'x');
      const weakChild = new WeakRef(child);
      let intermediate = new api.ConcatSource(child);
      const parent = new api.ConcatSource(intermediate);
      child = intermediate = null;
      for (let i = 0; i < 4; i++) { await tick(); global.gc(); }
      assert.ok(weakChild.deref(), 'flattened parent keeps its actual JS child alive');
      assert.strictEqual(parent.getChildren()[0], weakChild.deref());
      let cycleChild = new api.RawSource('cycle');
      let cycleParent = new api.ReplaceSource(cycleChild);
      cycleChild.parent = cycleParent;
      const weakCycle = new WeakRef(cycleParent);
      cycleChild = cycleParent = null;
      let customChild = { source: () => 'custom' };
      let concat = new api.ConcatSource(new api.CompatSource(customChild));
      customChild.parent = concat;
      const weakConcat = new WeakRef(concat);
      concat = customChild = null;
      let collected = false;
      for (let i = 0; i < 30; i++) {
        await tick(); global.gc();
        if (weakCycle.deref() === undefined && weakConcat.deref() === undefined) {
          collected = true;
          break;
        }
      }
      assert.ok(collected, 'native handles must not hide strong JS cycles from V8');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', script], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('ConcatSource rejects unbound children before appending any of them', () => {
  const source = new api.ConcatSource('a');
  const custom = { source: () => 'b' };
  const proxy = new Proxy(new api.ConcatSource(), { get() { assert.fail('read from proxy'); } });
  for (const child of [custom, new api.Source(), proxy]) {
    assert.throws(() => new api.ConcatSource(child), /CompatSource/);
    assert.throws(() => source.add(child), /CompatSource/);
    assert.throws(() => source.addAllSkipOptimizing(['ignored', child]), /CompatSource/);
  }
  source.add(new api.CompatSource(custom));
  assert.equal(source.source(), 'ab');
});
