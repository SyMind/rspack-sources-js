import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Bench } from 'tinybench';
import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { getCodspeedRunnerMode, getV8Flags } from '@codspeed/core';

const require = createRequire(import.meta.url);
const api = require('../lib');
const binding = require('../lib/binding');
const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice(9) ?? '';
const mode = getCodspeedRunnerMode();
if (mode === 'disabled') throw new Error('Measurements require CodSpeed.');
const missing = getV8Flags().filter(flag => !process.execArgv.includes(flag));
if (missing.length) throw new Error(`Missing CodSpeed V8 flags: ${missing.join(' ')}`);
if (typeof global.gc !== 'function') throw new Error('Run with --expose-gc to keep collection outside timed constructor batches.');

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

// Sanity checks belong to benchmark setup, not a general test-suite invocation.
for (const fixture of fixtures) {
  const expected = Buffer.isBuffer(fixture.value) && fixture.convert ? fixture.value.toString('utf8') : fixture.value;
  const instance = new api.RawSource(fixture.value, fixture.convert);
  assert.deepStrictEqual(instance.source(), expected);
  assert.equal(instance.isBuffer(), Buffer.isBuffer(fixture.value) && !fixture.convert);
  assert.equal(instance.size(), Buffer.byteLength(fixture.value));
  assert.deepEqual(Object.getOwnPropertyNames(instance), []);
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
    let receivers;
    bench.add(name, () => {
      if (scope === 'constructor') {
        for (let i = 0; i < batch; i++) receivers[i] = new api.RawSource(fixture.value, fixture.convert);
      } else {
        for (let i = 0; i < batch; i++) binding.rawNew(receivers[i], fixture.value, fixture.convert);
      }
    }, {
      beforeEach() {
        receivers = new Array(batch);
        if (scope === 'native-entry') {
          for (let i = 0; i < batch; i++) {
            receivers[i] = Object.create(api.RawSource.prototype);
          }
        }
      },
      afterEach() {
        // Retain every receiver to keep collection outside the timed batch.
        receivers = undefined;
        global.gc();
      },
    });
  }
}
if (!bench.tasks.length) throw new Error(`No benchmark matches ${filter}`);
console.log(JSON.stringify({
  codspeedMode: mode, batch, platform: `${process.platform}-${process.arch}`, node: process.version,
  semantics: 'native-entry measures rawNew with receivers prepared outside timing; constructor measures new RawSource; GC outside timed batches; divide each measurement by batch for per-source cost',
  fixtures: fixtures.map(({ name, value, convert }) => ({ name, bytes: Buffer.byteLength(value), convert })),
}));
bench.runSync();
