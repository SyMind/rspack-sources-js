'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('package loads, streams, and maps without loading upstream webpack-sources', async () => {
  const sources = require('rspack-sources-js');
  const esm = await import('../dist/index.mjs');
  assert.strictEqual(esm.default, sources);
  assert.strictEqual(esm.ReplaceSource, sources.ReplaceSource);

  const edited = new sources.ReplaceSource(new sources.OriginalSource('ab\n', 'input.js'));
  edited.replace(1, 1, 'X');
  const cached = new sources.CachedSource(
    new sources.PrefixSource('> ', new sources.ConcatSource(edited, 'tail')),
  );
  const chunks = [];
  const info = cached.streamChunks({}, chunk => {
    if (chunk !== undefined) chunks.push(chunk);
  }, () => {}, () => {});
  assert.equal(chunks.join(''), '> aX\n> tail');
  assert.equal(info.generatedLine, 2);
  assert.equal(info.generatedColumn, 6);
  assert.equal(cached.sourceAndMap().source, '> aX\n> tail');
  assert.deepStrictEqual(new sources.OriginalSource('x', 'native.js').map().sources, ['native.js']);

  // Each test file runs in its own process, without the differential test oracle.
  const upstreamModules = Object.keys(require.cache).filter(filename =>
    /\/node_modules\/webpack-sources(?:-reference)?\//.test(filename.replaceAll('\\', '/')),
  );
  assert.deepStrictEqual(upstreamModules, []);
});
