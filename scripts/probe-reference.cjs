'use strict';

// 设计依据：验证参考实现行为，不代表原生 binding 已通过测试。
const assert = require('node:assert/strict');
const w = require('webpack-sources-reference');
const report = {
  reference: require('webpack-sources-reference/package.json').version,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
};
const r = new w.ReplaceSource(new w.RawSource('A😀B'));
r.replace(1, 2, 'X');
assert.equal(r.source(), 'AXB');
report.utf16InclusiveReplacement = r.source();
const split = new w.ReplaceSource(new w.RawSource('A😀B'));
split.replace(1, 1, 'X');
assert.equal(split.source(), 'AX\ude00B');
report.splitSurrogateCodeUnits = Array.from({ length: split.source().length }, (_, i) => split.source().charCodeAt(i));

const lone = new w.RawSource('\ud800');
assert.equal(lone.source().charCodeAt(0), 0xd800);
assert.equal(lone.buffer().toString('hex'), 'efbfbd');
report.loneSurrogate = { stringCodeUnit: lone.source().charCodeAt(0), bytes: lone.buffer().toString('hex') };

const bytes = Buffer.from('abc');
const raw = new w.RawSource(bytes);
assert.strictEqual(raw.source(), bytes);
bytes[0] = 0x78;
assert.equal(raw.buffer().toString(), 'xbc');
report.mutableBuffer = { sameObject: raw.source() === bytes, value: raw.buffer().toString() };

const inner = new w.ConcatSource('a');
const outer = new w.ConcatSource(inner);
inner.add('b');
assert.equal(outer.source(), 'a');
report.concatFlattensAtConstruction = { inner: inner.source(), outer: outer.source() };

const edits = new w.ReplaceSource(new w.RawSource('abc'));
const parent = new w.ConcatSource(edits);
assert.equal(parent.source(), 'abc');
edits.replace(0, 0, 'x');
assert.equal(parent.source(), 'xbc');
report.parentObservesReplacementMutation = parent.source();

const child = new w.ConcatSource('a');
const cached = new w.CachedSource(child);
assert.equal(cached.source(), 'a');
child.add('b');
assert.equal(cached.source(), 'a');
cached.clearCache();
assert.equal(cached.source(), 'ab');
report.cachedSource = { beforeClear: 'a', afterClear: cached.source() };

let calls = 0;
const lazy = new w.CachedSource(() => { calls++; return new w.RawSource('lazy'); });
lazy.clearCache();
assert.equal(calls, 0);
assert.equal(lazy.source(), 'lazy');
lazy.source();
assert.equal(calls, 1);
report.lazyFactoryCalls = calls;

const map = { version: 3, sources: ['a.js'], names: [], mappings: 'AAAA', sourcesContent: ['x'] };
const mapped = new w.SourceMapSource('x', 'a.js', map);
assert.strictEqual(mapped.map(), map);
map.file = 'changed.js';
assert.equal(mapped.map({ columns: false }).file, 'changed.js');
report.directMap = { sameObject: mapped.map() === map, file: mapped.map().file, mappings: mapped.map({ columns: false }).mappings };

const exposed = new w.ReplaceSource(new w.RawSource('abc'));
exposed.replace(0, 0, 'x');
exposed.getReplacements()[0].content = 'y';
assert.equal(exposed.source(), 'ybc');
report.exposedReplacementMutation = exposed.source();

const hashTrace = [];
r.updateHash({ update(value, encoding) { hashTrace.push({ type: Buffer.isBuffer(value) ? 'buffer' : typeof value, value: Buffer.isBuffer(value) ? value.toString('hex') : value, encoding }); return this; } });
report.hashTrace = hashTrace;
assert.equal(hashTrace[0].value, 'ReplaceSource');
const chunks = new w.ConcatSource(new w.RawSource('a'), new w.OriginalSource('b', 'b.js')).buffers();
assert.equal(Buffer.concat(chunks).toString(), 'ab');
report.buffers = chunks.map(x => x.toString());
const scoped = new w.OriginalSource('const a = 1;\n', 'a.js', new Map([['a', 'a']]));
assert.equal(typeof scoped.map({ scopes: true }).scopes, 'string');
report.scopes = { encoded: scoped.map({ scopes: true }).scopes, helpers: Object.keys(w.util.scopes) };
report.exports = Object.keys(w);
console.log(JSON.stringify(report, null, 2));
