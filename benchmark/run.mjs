import { Bench } from 'tinybench';
import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { getCodspeedRunnerMode, getV8Flags } from '@codspeed/core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { restoreGraph } from './graph.cjs';
import { loadCases, validateCases, replay, reference, implementation, nativeState } from './replay.mjs';
import { verifyReport } from './verification.mjs';

const library = process.argv.find(arg => arg.startsWith('--implementation='))?.slice(17) ?? 'rspack';
const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice(9) ?? '';
const modeFilter = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7);
const state = process.argv.find(arg => arg.startsWith('--state='))?.slice(8) ?? 'cold';
if (!['cold', 'warm', 'lifecycle', 'all'].includes(state)) throw new Error('--state must be cold, warm, lifecycle or all');
const states = state === 'all' ? ['cold', 'warm', 'lifecycle'] : [state];
const selected = loadCases({ filter, mode: modeFilter });
if (!['webpack', 'rspack', 'both'].includes(library)) throw new Error('--implementation must be webpack, rspack or both');
if (process.argv.includes('--list')) {
  console.table(selected.map(row => ({ id: row.id, observedCalls: row.frequency, asset: row.asset, sources: row.graph.summary.sources, cacheFields: row.graph.summary.cacheFields })));
  process.exit(0);
}
const mode = getCodspeedRunnerMode();
if (mode === 'disabled') throw new Error('Measurements require CodSpeed; use pnpm bench:simulation or pnpm bench:walltime.');
const missing = getV8Flags().filter(flag => !process.execArgv.includes(flag));
if (missing.length) throw new Error(`Missing CodSpeed V8 flags: ${missing.join(' ')}`);
const validation = validateCases(selected);
const verification = verifyReport(validation, { ci: process.argv.includes('--ci'), validOnly: process.argv.includes('--valid-only') });
const invalid = verification.excluded;
const cases = selected.filter(row => verification.validIds.has(row.id));
if (!cases.length) throw new Error('No verified operations selected');
mkdirSync('.bench', { recursive: true });
writeFileSync(`.bench/validation-${library}-${mode}.json`, JSON.stringify(validation, null, 2) + '\n');
if (invalid.length) console.log(`EXCLUDED invalid output: ${invalid.map(row => row.id).join(', ')}`);
// A fixed sample count keeps graph rehydration outside the latency timer without
// letting a nanosecond cached read cause millions of expensive setup iterations.
const bench = withCodSpeed(new Bench({ name: 'antd-webpack-source-graphs', time: 0, iterations: 64, warmupTime: 0, warmupIterations: 8, setup() {}, teardown() {} }));
let sink;
for (const current of library === 'both' ? ['webpack', 'rspack'] : [library]) {
  const api = current === 'webpack' ? reference : implementation;
  const stateAdapter = current === 'rspack' ? nativeState : undefined;
  for (const record of cases) {
    for (const currentState of states) {
      const base = library === 'both' ? `${current}/${record.id}` : record.id;
      const name = currentState === 'cold' ? base : `${base}/${currentState}`;
      let instance;
      bench.add(name, () => {
        // Lifecycle includes captured graph restoration and constructor calls.
        if (currentState === 'lifecycle') instance = restoreGraph(record.graph, api, stateAdapter);
        sink = replay(record, instance);
      }, {
        beforeAll() {
          if (currentState === 'warm') {
            instance = restoreGraph(record.graph, api, stateAdapter);
            replay(record, instance);
          }
        },
        beforeEach() {
          if (currentState === 'cold') instance = restoreGraph(record.graph, api, stateAdapter);
        },
        afterAll() { instance = undefined; sink = undefined; },
      });
    }
  }
}
console.log(JSON.stringify({ implementation: library, codspeedMode: mode, platform: `${process.platform}-${process.arch}`, node: process.version, verifiedCases: cases.length, excludedInvalid: invalid.length, state, semantics: 'cold: captured pre-call state, constructors excluded; warm: same instance after one replay; lifecycle: graph restoration plus observed call, not a full webpack build' }));
bench.runSync();
if (mode === 'walltime') console.table(bench.table());
void sink;
