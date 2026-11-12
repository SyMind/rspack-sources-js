'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const api = require('../lib');
const binding = require('../lib/binding');

test('constructors bind native state before the first read', () => {
  binding.debugSourceStats(true);
  const original = new api.OriginalSource('abc', 'input.js');
  const replaced = new api.ReplaceSource(original, 'edited');
  assert.equal(binding.debugSourceStats().creations, 2);
  assert.equal(replaced.getName(), 'edited');
  replaced.map(); replaced.map({ columns: false });
  replaced.replace(0, 0, 'X');
  assert.equal(binding.debugSourceStats().mutations, 1);
  assert.equal(replaced.sourceAndMap().source, 'Xbc');
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
  assert.equal(source.getChildren()[0].source(), 'ab');
});

test('all concrete constructors bind their state immediately', () => {
  const raw = new api.RawSource('x');
  const cached = new api.CachedSource(raw);
  assert.strictEqual(cached.originalLazy(), raw);
  assert.equal(binding.cachedSize(cached), 1);
  const map = { version: 3, sources: [], names: [], mappings: '' };
  assert.equal(binding.prefixSource(new api.PrefixSource('> ', raw)), '> x');
  assert.equal(binding.sizeOnlySize(new api.SizeOnlySource(10)), 10);
  assert.equal(new api.CompatSource(raw).source(), 'x');
  assert.deepEqual(binding.sourceMapMap(new api.SourceMapSource('x', 'x.js', map), true), map);
});

test('constructors bind a SourceRef of the concrete Rust type before the first read', () => {
  const raw = new api.RawSource('x');
  const cached = new api.CachedSource(raw);
  const cases = [
    [raw, 'RawStringSource'],
    [new api.RawSource(Buffer.from('x')), 'RawBufferSource'],
    [new api.OriginalSource(Buffer.from('x'), 'input.js'), 'OriginalSource'],
    [new api.SourceMapSource('x', 'input.js'), 'SourceMapSource'],
    [new api.ConcatSource(raw), 'ConcatSource'],
    [new api.ReplaceSource(raw), 'ReplaceSource'],
    [cached, 'CachedSource'],
    [new api.PrefixSource('> ', raw), 'PrefixSource'],
    [new api.SizeOnlySource(1), 'SizeOnlySource'],
    [new api.CompatSource({ source() { return 'x'; } }), 'CompatSource'],
  ];
  for (const [source, type] of cases) assert.equal(binding.debugBoundSourceType(source), type);
});

test('each typed binding rejects a receiver from another Source class', () => {
  const raw = new api.RawSource('x');
  const original = new api.OriginalSource('x', 'input.js');
  const calls = [
    () => binding.rawSource(original),
    () => binding.originalSource(raw, true),
    () => binding.sourceMapSource(raw),
    () => binding.concatGetChildren(raw),
    () => binding.replaceSource(raw, original),
    () => binding.cachedSource(raw),
    () => binding.prefixSource(raw),
    () => binding.sizeOnlySize(raw),
    () => binding.compatSource(raw, original),
  ];
  for (const call of calls) assert.throws(call, /Invalid Source receiver/);
});

test('SourceMapSource validates its map when constructing the native source', () => {
  assert.throws(() => new api.SourceMapSource('abc', 'input.js', 'invalid JSON'));
});

test('Source state is independent of webpack private properties', () => {
  const original = new api.OriginalSource('abc', 'input.js');
  const cached = new api.CachedSource(original);
  const replaced = new api.ReplaceSource(cached);
  for (const source of [original, cached, replaced]) {
    assert.ok(Object.getOwnPropertyNames(source).every(key => !key.startsWith('_')));
  }
  const unexpected = () => assert.fail('accessed a webpack private property');
  Object.defineProperty(cached, '_cachedSource', { get: unexpected, set: unexpected });
  Object.defineProperty(replaced, '_replacements', { get: unexpected, set: unexpected });
  replaced.replace(1, 1, 'X');
  assert.equal(cached.source(), 'abc');
  assert.equal(replaced.source(), 'aXc');
  assert.ok(Object.keys(binding).every(key => !/(?:Get|Set)Field$/.test(key)));
});

test('CachedSource rejects a factory without invoking it', () => {
  const factory = () => assert.fail('called a Source factory');
  assert.throws(() => new api.CachedSource(factory), /expect.*object.*function/i);
});

test('CachedSource.size reads the native source size', () => {
  const original = new api.RawSource('é');
  original.size = () => assert.fail('called JS size');
  original.source = () => assert.fail('called JS source');
  original.buffer = () => assert.fail('called JS buffer');
  const cached = new api.CachedSource(original);
  assert.equal(cached.size(), 2);
  assert.equal(binding.cachedSize(cached), 2);
});

test('nested CachedSource wrappers hold the child through both parents', () => {
  const child = new api.ReplaceSource(new api.OriginalSource('abc', 'input.js'));
  const cached = new api.CachedSource(new api.CachedSource(child));
  const first = new api.ConcatSource(cached);
  const second = new api.ConcatSource(cached);
  assert.strictEqual(second.getChildren()[0], cached);
  const before = binding.debugSourceSnapshot(first);
  assert.ok(before);
  assert.ok(binding.debugSourceSnapshot(second));
  assert.throws(() => child.replace(0, 0, 'X', 'edited'), /Cannot modify shared ReplaceSource/);
  assert.deepEqual(first.map().names, []);
  assert.deepEqual(second.map().names, []);
  assert.equal(second.source(), 'abc');
  assert.equal(before.source(), 'abc');
});

test('CachedSource.sourceAndMap uses the bound source and returns binary input as a Buffer', () => {
  const bytes = Buffer.from('abc');
  const original = new api.RawSource(bytes);
  original.map = original.sourceAndMap = () => assert.fail('called a JS map method');
  const cached = new api.CachedSource(original);
  assert.deepEqual(cached.sourceAndMap(), { source: bytes, map: null });
  assert.strictEqual(cached.originalLazy(), original);
});

test('CachedSource ignores extra constructor arguments and initializes its own caches', () => {
  const original = new api.OriginalSource('fresh', 'input.js');
  const unused = new Proxy({}, { get() { assert.fail('read the extra constructor argument'); } });
  const cached = new api.CachedSource(original, unused);
  assert.strictEqual(cached.original(), original);
  assert.deepEqual(cached.sourceAndMap(), original.sourceAndMap());
});

test('CachedSource returns independently writable copies of its native maps', () => {
  const original = new api.OriginalSource('const café = 1;', 'input.js');
  const cached = new api.CachedSource(original);
  const parent = new api.ConcatSource(cached);
  const expected = parent.sourceAndMap();
  cached.map().mappings = 'changed';
  assert.deepEqual(cached.map(), original.map());
  assert.deepEqual(cached.sourceAndMap({ columns: false }), original.sourceAndMap({ columns: false }));
  assert.deepEqual(parent.sourceAndMap(), expected);
});

test('getReplacements returns independent arrays and Replacement objects', () => {
  const replaced = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  replaced.insert(2, 'A', 'first');
  replaced.insert(2, 'B', 'second');
  replaced.insert(0, '!');
  const parent = new api.ConcatSource(replaced);
  const first = replaced.getReplacements();
  const second = replaced.getReplacements();
  assert.notStrictEqual(first, second);
  assert.deepEqual(second.map(edit => edit.content), ['!', 'A', 'B']);
  for (const [index, edit] of first.entries()) {
    assert.ok(edit instanceof api.ReplaceSource.Replacement);
    assert.notStrictEqual(edit, second[index]);
  }
  const expected = parent.sourceAndMap();
  assert.equal(expected.source, '!abABc');
  Object.assign(first[1], { start: 0, end: 2, content: 'changed', name: 'changed' });
  first.splice(0, 2);
  first.sort = () => assert.fail('sorted a returned snapshot');
  assert.deepEqual(replaced.getReplacements(), second);
  assert.equal(replaced.size(), Buffer.byteLength(expected.source));
  assert.deepEqual(replaced.buffer(), Buffer.from(expected.source));
  assert.deepEqual(parent.sourceAndMap(), expected);
  assert.throws(() => replaced.replace(0, 0, 'X'), /Cannot modify shared ReplaceSource/);
  assert.equal(parent.source(), '!abABc');
  assert.deepEqual(second.map(edit => edit.content), ['!', 'A', 'B']);
  assert.deepEqual(replaced.getReplacements().map(edit => edit.content), ['!', 'A', 'B']);
});

test('native replacements round-trip UTF-16 ranges and reject a split surrogate', () => {
  const edited = new api.ReplaceSource(new api.OriginalSource('A😀é中Z', 'x'));
  const records = () => edited.getReplacements().map(r => [r.start, r.end, r.content, r.name]);
  edited.insert(5, '!', '');
  edited.replace(1, 2, '🙂', 'emoji');
  edited.insert(5, '?');
  const initial = [[1, 2, '🙂', 'emoji'], [5, 4, '!', ''], [5, 4, '?', undefined]];
  assert.deepEqual(records(), initial);
  assert.equal(edited.source(), 'A🙂é中!?Z');

  assert.throws(() => edited.insert(2, 'x'), /Invalid UTF-16/);
  assert.deepEqual(records(), initial);
  assert.equal(edited.source(), 'A🙂é中!?Z');
});

test('replaceSource edits decoded text at UTF-16 character boundaries', () => {
  const bytes = Buffer.from('éZ');
  const source = new api.ReplaceSource(new api.RawSource(bytes));
  assert.deepEqual(binding.replaceSource(source), bytes);
  source.insert(1, ':');
  bytes.fill(0);
  assert.equal(source.source(), 'é:Z');
});

test('ReplaceSource adapts a custom input once', () => {
  let reads = 0;
  const child = { source() { reads++; return 'abc'; } };
  const source = new api.ReplaceSource(child);
  source.replace(0, 0, 'A');
  assert.equal(source.source(), 'Abc');
  assert.equal(reads, 1);
});

test('replaceSourceAndMap returns the native content and map for the same edits', () => {
  const source = new api.ReplaceSource(new api.OriginalSource('A😀B', 'input.js'));
  source.replace(1, 2, 'X', 'emoji');
  assert.deepEqual(binding.replaceSourceAndMap(source, false), {
    source: 'AXB', map: source.map({ columns: false }),
  });
});

test('replacement coordinates must be representable and can extend past the input', () => {
  const source = new api.ReplaceSource(new api.RawSource('abc'));
  for (const [start, end] of [[-1, 0], [0, Number.MIN_VALUE], [0, Infinity]]) {
    assert.throws(() => source.replace(start, end, 'x'), /Invalid UTF-16/);
  }
  source.replace(1, 9, 'x');
  assert.equal(source.getReplacements()[0].end, 9);
  assert.equal(source.source(), 'ax');
  assert.equal(source.size(), 2);
});

test('removing a shared child from a snapshot preserves both native edges', () => {
  const child = new api.ReplaceSource(new api.OriginalSource('abc', 'x'));
  const parent = new api.ConcatSource(child, child);
  parent.map();
  parent.getChildren().pop();
  parent.map();
  assert.throws(() => child.replace(0, 0, 'X'), /Cannot modify shared ReplaceSource/);
  assert.equal(parent.sourceAndMap().source, 'abcabc');
});

test('skip-optimizing retains a nested concat and rejects both append methods', () => {
  const child = new api.ConcatSource('a');
  const parent = new api.ConcatSource();
  parent.addAllSkipOptimizing([child]);
  assert.throws(() => child.add('b'), /Cannot modify shared ConcatSource/);
  assert.throws(() => child.addAllSkipOptimizing(['c']), /Cannot modify shared ConcatSource/);
  assert.strictEqual(parent.getChildren()[0], child);
  assert.equal(parent.source(), 'a');
});

test('CachedSource shares its input as soon as it is constructed', () => {
  const source = new api.ReplaceSource(new api.RawSource('abc'));
  source.replace(0, 0, 'x');
  const cache = new api.CachedSource(source);
  assert.throws(() => source.replace(1, 1, 'y'), /Cannot modify shared ReplaceSource/);
  const parent = new api.ConcatSource(cache);
  assert.strictEqual(cache.original(), source);
  assert.throws(() => source.insert(0, '!'), /Cannot modify shared ReplaceSource/);
  assert.equal(parent.source(), 'xbc');
});

test('fixture restoration also requires a uniquely owned OriginalSource', () => {
  const original = new api.OriginalSource(Buffer.from('a'), 'a.js');
  binding.debugOriginalRestore(original, 'b', 1);
  const parent = new api.PrefixSource('> ', original);
  assert.throws(() => binding.debugOriginalRestore(original, 'c', 8), /Cannot modify shared OriginalSource/);
  assert.equal(original.source(), 'b');
  assert.equal(original.size(), 1);
  assert.equal(parent.source(), '> b');
});

test('JS parents retain the original child wrappers and cycles remain collectible', () => {
  const script = `
    const assert = require('node:assert/strict');
    const api = require(${JSON.stringify(require.resolve('../lib'))});
    const tick = () => new Promise(resolve => setImmediate(resolve));
    (async () => {
      let original = new api.OriginalSource('edited', 'input.js');
      const weakOriginal = new WeakRef(original);
      const replacement = new api.ReplaceSource(original);
      original = null;
      let child = new api.OriginalSource('abc', 'x');
      const weakChild = new WeakRef(child);
      let intermediate = new api.ConcatSource(child);
      const parent = new api.ConcatSource(intermediate);
      child = intermediate = null;
      for (let i = 0; i < 4; i++) { await tick(); global.gc(); }
      assert.ok(weakOriginal.deref());
      assert.strictEqual(replacement.original(), weakOriginal.deref());
      assert.ok(weakChild.deref(), 'flattened parent keeps its actual JS child alive');
      assert.strictEqual(parent.getChildren()[0], weakChild.deref());
      const editable = new api.ReplaceSource(new api.RawSource('a'));
      let owner = new api.ConcatSource(editable);
      assert.throws(() => editable.insert(0, '!'), /Cannot modify shared ReplaceSource/);
      const weakOwner = new WeakRef(owner);
      owner = null;
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
        if (weakCycle.deref() === undefined && weakConcat.deref() === undefined && weakOwner.deref() === undefined) {
          collected = true;
          break;
        }
      }
      assert.ok(collected, 'native handles must not hide strong JS cycles from V8');
      await tick();
      editable.insert(0, '!');
      assert.equal(editable.source(), '!a');
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

test('external backing stores keep the native graph alive until the last view is collected', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { setImmediate: tick } = require('node:timers/promises');
    const { CachedSource, RawSource, ReplaceSource } = require(${JSON.stringify(require.resolve('../lib'))});
    async function collectUntil(predicate) {
      for (let i = 0; i < 50; i++) {
        await tick();
        global.gc();
        await tick();
        if (predicate()) return;
      }
      assert.fail('objects were not released');
    }
    (async () => {
      const child = new ReplaceSource(new RawSource('a雪z'));
      function exportView() {
        const parent = new CachedSource(child);
        const bytes = parent.buffer();
        const part = bytes.subarray(1, 4);
        return {
          parent: new WeakRef(parent), bytes: new WeakRef(bytes),
          view: new DataView(part.buffer, part.byteOffset, part.byteLength)
        };
      }
      const held = exportView();
      await collectUntil(() => !held.parent.deref() && !held.bytes.deref());
      assert.equal(held.view.getUint8(0), 0xe9);
      if (!Number(process.config.variables.v8_enable_sandbox || 0)) {
        assert.throws(() => child.insert(0, '!'), /Cannot modify shared/);
      }
      held.view = null;
      await collectUntil(() => {
        try { child.insert(0, '!'); return true; }
        catch (error) { if (/Cannot modify shared/.test(error.message)) return false; throw error; }
      });
      assert.equal(child.source(), '!a雪z');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('editing a source preserves outstanding views from before the edit', () => {
  const edited = new api.ReplaceSource(new api.RawSource('abc'));
  edited.replace(1, 1, '雪');
  const original = edited.buffer();
  edited.insert(0, '!');
  assert.equal(original.toString(), 'a雪c');
  assert.equal(edited.buffer().toString(), '!a雪c');

  const concat = new api.ConcatSource('first');
  const first = concat.buffer().subarray(1);
  concat.add('second');
  assert.equal(first.toString(), 'irst');
  assert.equal(concat.source(), 'firstsecond');
});

test('CompatSource captures custom buffer bytes independently of the source text', () => {
  const bytes = Buffer.from([0xff, 0x80]);
  const source = new api.CompatSource({
    source: () => 'text',
    buffer: () => bytes,
    get buffers() { assert.fail('unexpected lookup of the removed method'); },
  });
  bytes.fill(0);
  assert.equal(source.source(), 'text');
  assert.deepEqual(new api.PrefixSource('', source).buffer(), Buffer.from([0xff, 0x80]));
});
