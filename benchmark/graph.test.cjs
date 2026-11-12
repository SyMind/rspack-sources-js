'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reference = require('webpack-sources');
const implementation = require('../dist/index.js');
const nativeState = require('./native-state.cjs');
const { encodeGraph, restoreGraph, UnsupportedGraph } = require('./graph.cjs');

test('native replay can read a CachedSource captured with either upstream byte cache', () => {
  for (const first of ['buffer', 'buffers']) {
    const source = new reference.CachedSource(new reference.ConcatSource(
      new reference.RawSource('a'), new reference.RawSource('b'),
    ));
    source[first]();
    source.buffer();
    source.buffers();
    const replay = restoreGraph(encodeGraph(source, reference), implementation, nativeState);
    assert.deepEqual(replay.buffer(), source.buffer());
  }
});

test('replay preserves shared Source identity, replacement positions, buffers and populated map caches', () => {
  const original = new reference.OriginalSource('A😀B\n', 'unicode.js');
  const replaced = new reference.ReplaceSource(original);
  replaced.replace(1, 2, '🙂');
  const cached = new reference.CachedSource(replaced);
  const { map } = cached.sourceAndMap({ columns: true });
  const buffer = cached.buffer();
  const updates = [];
  cached.updateHash({ update: item => updates.push(item) });
  const graph = new reference.ConcatSource(cached, '\n', cached);
  const encoded = JSON.parse(JSON.stringify(encodeGraph([graph, buffer, map], reference)));
  assert.equal(encoded.summary.sharedSources, 1);
  assert.ok(encoded.summary.cacheFields > 0);
  for (const api of [reference, implementation]) {
    const state = api === implementation ? nativeState : undefined;
    const [replay, restoredBuffer, restoredMap] = restoreGraph(encoded, api, state);
    const children = replay.getChildren();
    assert.strictEqual(children[0], children[2]);
    assert.strictEqual(children[0].buffer(), restoredBuffer);
    assert.strictEqual(children[0].map({ columns: true }), restoredMap);
    children[0].original().updateHash = () => assert.fail('recomputed a captured hash');
    const restoredUpdates = [];
    children[0].updateHash({ update: item => restoredUpdates.push(item) });
    assert.deepStrictEqual(restoredUpdates, updates);
    assert.deepStrictEqual(replay.sourceAndMap({ columns: true }), graph.sourceAndMap({ columns: true }));
  }
});

test('OriginalSource replay preserves decoded text and a shared writable Buffer', () => {
  const bytes = Buffer.from('old');
  const source = new reference.OriginalSource(bytes, 'input.js');
  source.source();
  bytes.write('new');
  const graph = encodeGraph([source, bytes], reference);
  const [restored, shared] = restoreGraph(graph, implementation, nativeState);
  assert.equal(restored.source(), 'old');
  assert.equal(restored.getName(), 'input.js');
  assert.strictEqual(restored.buffer(), shared);
  assert.equal(shared.toString(), 'new');
});

test('capture refuses unresolved factories and accessors without evaluating them', () => {
  let calls = 0;
  const lazy = new reference.CachedSource(() => { calls++; return new reference.RawSource('x'); });
  assert.throws(() => encodeGraph(lazy, reference), UnsupportedGraph);
  assert.equal(calls, 0);
  const source = new reference.RawSource('x');
  Object.defineProperty(source, '_privateGetter', { get() { calls++; return 'unexpected'; } });
  assert.throws(() => encodeGraph(source, reference), UnsupportedGraph);
  assert.equal(calls, 0);
});
