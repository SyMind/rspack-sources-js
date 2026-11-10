'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reference = require('webpack-sources');
const implementation = require('../dist/index.js');
const { encodeGraph, restoreGraph, UnsupportedGraph } = require('./graph.cjs');

test('replay preserves shared Source identity, replacement positions, buffers and populated map caches', () => {
  const original = new reference.OriginalSource('A😀B\n', 'unicode.js');
  const replaced = new reference.ReplaceSource(original);
  replaced.replace(1, 2, '🙂');
  const cached = new reference.CachedSource(replaced);
  cached.sourceAndMap({ columns: true });
  cached.buffer();
  const graph = new reference.ConcatSource(cached, '\n', cached);
  const encoded = JSON.parse(JSON.stringify(encodeGraph(graph, reference)));
  assert.equal(encoded.summary.sharedSources, 1);
  assert.ok(encoded.summary.cacheFields > 0);
  for (const api of [reference, implementation]) {
    const replay = restoreGraph(encoded, api);
    assert.strictEqual(replay._children[0], replay._children[2]);
    assert.ok(replay._children[0]._cachedBuffer instanceof Buffer);
    assert.ok(replay._children[0]._cachedMaps instanceof Map);
    assert.deepStrictEqual(replay.sourceAndMap({ columns: true }), graph.sourceAndMap({ columns: true }));
  }
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
