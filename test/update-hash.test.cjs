'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  Source, RawSource, SourceMapSource, ConcatSource, PrefixSource, ReplaceSource,
  CachedSource, CompatSource, SizeOnlySource, util,
} = require('../lib');

function updates(source, onUpdate) {
  const chunks = [];
  source.updateHash({
    update(value) {
      chunks.push(value);
      onUpdate?.(value);
      return this;
    },
  });
  return chunks;
}

test('updateHash preserves child order and ignores writes to replacement snapshots', () => {
  const input = Buffer.from([0xff, 0x00]);
  const replace = new ReplaceSource(new RawSource(input), 'file');
  replace.insert(5, 'last');
  replace.replace(0, 1, 'old', 'id');
  const concat = new ConcatSource('a', 'b', new PrefixSource('> ', replace));
  const chunks = updates(concat, value => {
    if (value === 'ConcatSource') concat.add(new RawSource('next call'));
    if (value === 'file') replace.getReplacements()[0].content = 'new';
  });
  assert.deepEqual(chunks, [
    'ConcatSource', 'RawSource', Buffer.from('ab'), 'PrefixSource',
    'ReplaceSource', 'RawSource', input, 'file', '01', 'old', 'id', '54', 'last', '> ',
  ]);
  assert.strictEqual(chunks[6], input);
  assert.deepEqual(updates(concat).slice(-2), ['RawSource', Buffer.from('next call')]);
});

test('SourceMapSource consumes each map only when the caller reaches it', () => {
  const original = Buffer.from('original');
  const inner = Buffer.from('{ "version": 3 }');
  const map = { version: 3, sources: [] };
  const source = new SourceMapSource('x', 'in', map, original, inner, true);
  const chunks = updates(source, value => {
    if (Buffer.isBuffer(value) && value.toString() === 'x') map.sources.push('new');
  });
  assert.deepEqual(chunks, [
    'SourceMapSource', Buffer.from('x'), Buffer.from(JSON.stringify(map)), original, inner, 'true',
  ]);
  assert.strictEqual(chunks[3], original);
  assert.strictEqual(chunks[4], inner);

  const missing = new SourceMapSource('', 'in', '{}', '', null);
  assert.deepEqual(updates(missing), ['SourceMapSource', Buffer.alloc(0), Buffer.from('{}'), 'false']);
  const error = new Error('stop at content');
  const unread = new SourceMapSource('x', 'in', { toJSON: () => assert.fail('read past exception') });
  assert.throws(() => updates(unread, value => { if (Buffer.isBuffer(value)) throw error; }), e => e === error);
});

test('CachedSource retries after a failed replay and preserves input boundaries', () => {
  const small = 's'.repeat(1024);
  const large = 'L'.repeat(10240);
  const bytes = Buffer.from([0xc0]);
  let calls = 0;
  const source = new CachedSource(new CompatSource({
    source: () => 'content',
    updateHash(hash) {
      calls++;
      for (let i = 0; i < 101; i++) hash.update(small);
      hash.update(large);
      hash.update(bytes);
      hash.update('');
    },
  }));
  const error = new Error('retry');
  assert.throws(() => updates(source, () => { throw error; }), e => e === error);
  const first = updates(source);
  assert.deepEqual(first, [Buffer.from(small.repeat(101)), large, bytes, Buffer.alloc(0)]);
  assert.deepEqual(updates(source), first);
  assert.strictEqual(updates(source)[0], first[0]);
  assert.strictEqual(first[2], bytes);
  assert.equal(calls, 2);
});

test('RawSource and CompatSource use the public buffer and preserve unsupported hash errors', () => {
  const bytes = Buffer.from('overridden');
  const raw = new RawSource('x');
  raw.buffer = () => bytes;
  assert.strictEqual(updates(raw)[1], bytes);
  assert.strictEqual(updates(new CompatSource({ buffer: () => bytes }))[0], bytes);
  const unreachable = () => assert.fail('unexpected hash update');
  assert.throws(() => updates(new CompatSource({ map() {} }), unreachable), /must also provide an 'updateHash'/);
  assert.throws(() => updates(new SizeOnlySource(3), unreachable), /only size\(\) is supported/);
  assert.throws(() => updates(new Proxy(new SizeOnlySource(3), {}), unreachable), /only size\(\) is supported/);
  assert.throws(() => updates(new Source(), unreachable), /Abstract/);
});

test('hash bytes remain readable with dual caching disabled', () => {
  const cache = util.stringBufferUtils;
  cache.disableDualStringBufferCaching();
  try {
    for (const text of ['a中😀', 'a\ud800']) {
      for (const source of [new RawSource(text), new SourceMapSource(text, 'in.js', { version: 3, sources: [], names: [], mappings: '' })]) {
        const first = updates(source)[1];
        assert.deepEqual(first, Buffer.from(text));
        Buffer.from(first).fill(0);
        assert.deepEqual(updates(source)[1], Buffer.from(text));
      }
    }
  } finally {
    cache.enableDualStringBufferCaching();
  }
});
