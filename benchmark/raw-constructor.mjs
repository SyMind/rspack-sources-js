import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Bench } from 'tinybench';
import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { getCodspeedRunnerMode, getV8Flags } from '@codspeed/core';

const require = createRequire(import.meta.url);
const api = require('../dist');
const { contextOf } = require('../dist/nativeContext');
const binding = require('../dist/binding');
const { internString } = require('../dist/helpers/stringBufferUtils');
if (typeof binding.rawBenchmarkGenericNew !== 'function') {
  throw new Error('Build the benchmark control first: RSPACK_SOURCES_FEATURES=benchmark-legacy-api pnpm build');
}
const variant = process.argv.find(arg => arg.startsWith('--variant='))?.slice(10) ?? 'generic';
const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice(9) ?? '';
if (!['generic', 'raw-new'].includes(variant)) throw new Error('--variant must be generic or raw-new');
const mode = getCodspeedRunnerMode();
if (mode === 'disabled') throw new Error('Measurements require CodSpeed.');
const missing = getV8Flags().filter(flag => !process.execArgv.includes(flag));
if (missing.length) throw new Error(`Missing CodSpeed V8 flags: ${missing.join(' ')}`);
if (typeof global.gc !== 'function') throw new Error('Run with --expose-gc to keep collection outside timed constructor batches.');

// Both wrappers have the same superclass, constructor shape, and string interning.
// Only the native entry differs. No output conversion or map computation is timed.
class GenericRawSource extends api.Source {
  constructor(value, convertToString = false) {
    super();
    if (typeof value === 'string') value = internString(value);
    binding.rawBenchmarkGenericNew(this, contextOf(this), 'raw', [value, convertToString]);
  }
}
class DirectRawSource extends api.Source {
  constructor(value, convertToString = false) {
    super();
    if (typeof value === 'string') value = internString(value);
    binding.rawNew(this, contextOf(this), value, convertToString);
  }
}
for (const Class of [GenericRawSource, DirectRawSource]) {
  Object.setPrototypeOf(Class.prototype, api.RawSource.prototype);
}
const fixtures = [
  { name: 'empty-string', value: '', convert: false },
  { name: 'ascii-32B', value: '0123456789abcdef'.repeat(2), convert: false },
  { name: 'ascii-4KiB', value: 'module.exports = 123456;\n'.repeat(200).slice(0, 4096), convert: false },
  { name: 'ascii-64KiB', value: 'x'.repeat(65536), convert: false },
  { name: 'unicode-4KiB-utf16', value: '中文😀é\n'.repeat(400).slice(0, 2048), convert: false },
  { name: 'buffer-4KiB', value: Buffer.alloc(4096, 97), convert: false },
  { name: 'buffer-4KiB-convert', value: Buffer.alloc(4096, 97), convert: true },
];
const batch = 32;
const Constructor = variant === 'generic' ? GenericRawSource : DirectRawSource;

// Sanity checks belong to benchmark setup, not a general test-suite invocation.
for (const fixture of fixtures) {
  const expected = Buffer.isBuffer(fixture.value) && fixture.convert ? fixture.value.toString('utf8') : fixture.value;
  for (const Class of [GenericRawSource, DirectRawSource]) {
    const instance = new Class(fixture.value, fixture.convert);
    assert.strictEqual(instance.source(), expected);
    assert.equal(instance.isBuffer(), Buffer.isBuffer(fixture.value) && !fixture.convert);
    assert.equal(instance.size(), Buffer.byteLength(fixture.value));
    assert.deepEqual(Object.getOwnPropertyNames(instance), []);
  }
}
global.gc();

const bench = withCodSpeed(new Bench({
  name: 'raw-constructor-entry', time: 0, iterations: 64,
  warmupTime: 0, warmupIterations: 8, setup() {}, teardown() {},
}));
for (const scope of ['native-entry', 'constructor']) {
  for (const fixture of fixtures) {
    const name = `${scope}/${fixture.name}/x${batch}`;
    if (filter && !name.includes(filter)) continue;
    let receivers, stores;
    bench.add(name, () => {
      if (scope === 'constructor') {
        for (let i = 0; i < batch; i++) receivers[i] = new Constructor(fixture.value, fixture.convert);
      } else if (variant === 'generic') {
        for (let i = 0; i < batch; i++) binding.rawBenchmarkGenericNew(receivers[i], stores[i], 'raw', [fixture.value, fixture.convert]);
      } else {
        for (let i = 0; i < batch; i++) binding.rawNew(receivers[i], stores[i], fixture.value, fixture.convert);
      }
    }, {
      beforeEach() {
        receivers = new Array(batch);
        if (scope === 'native-entry') {
          stores = new Array(batch);
          for (let i = 0; i < batch; i++) {
            receivers[i] = Object.create(api.RawSource.prototype);
            stores[i] = contextOf(receivers[i]);
          }
        }
      },
      afterEach() {
        // Include real native allocation/wrapping, exclude collection in both
        // variants; retaining every receiver prevents mid-batch reclamation.
        receivers = stores = undefined;
        global.gc();
      },
    });
  }
}
if (!bench.tasks.length) throw new Error(`No benchmark matches ${filter}`);
console.log(JSON.stringify({
  variant, codspeedMode: mode, batch, platform: `${process.platform}-${process.arch}`, node: process.version,
  semantics: 'native-entry excludes receiver/store preparation; constructor includes it; both construct the same Rust SourceNode and snapshot; GC outside timed batches; divide each measurement by batch for per-source cost',
  fixtures: fixtures.map(({ name, value, convert }) => ({ name, bytes: Buffer.byteLength(value), convert })),
}));
bench.runSync();
