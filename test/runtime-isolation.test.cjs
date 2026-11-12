'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('package loads and maps without loading upstream webpack-sources', async () => {
  const sources = require('rspack-sources-js');
  const esm = await import('../dist/index.mjs');
  assert.strictEqual(esm.default, sources);
  assert.strictEqual(esm.ReplaceSource, sources.ReplaceSource);

  for (const type of ['Source', 'RawSource', 'OriginalSource', 'SourceMapSource', 'ReplaceSource',
    'ConcatSource', 'CachedSource', 'PrefixSource', 'SizeOnlySource', 'CompatSource']) {
    assert.equal('streamChunks' in sources[type].prototype, false, type);
    assert.equal('buffers' in sources[type].prototype, false, type);
  }

  const edited = new sources.ReplaceSource(new sources.OriginalSource('ab\n', 'input.js'));
  edited.replace(1, 1, 'X');
  const cached = new sources.CachedSource(
    new sources.PrefixSource('> ', new sources.ConcatSource(edited, 'tail')),
  );
  assert.equal(cached.sourceAndMap().source, '> aX\n> tail');
  assert.deepStrictEqual(new sources.OriginalSource('x', 'native.js').map().sources, ['native.js']);

  // Each test file runs in its own process, without the differential test oracle.
  const upstreamModules = Object.keys(require.cache).filter(filename =>
    /\/node_modules\/webpack-sources(?:-reference)?\//.test(filename.replaceAll('\\', '/')),
  );
  assert.deepStrictEqual(upstreamModules, []);
});
