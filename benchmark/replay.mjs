import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { restoreGraph, fingerprint } from './graph.cjs';
import { verifyReport } from './verification.mjs';

const require = createRequire(import.meta.url);
export const reference = require('webpack-sources');
export const implementation = require('../lib/index.js');
export const nativeState = require('./native-state.cjs');
const binding = require('../lib/binding.js');
const createHash = require('webpack').util.createHash;
export const fixtureDirectory = fileURLToPath(new URL('./fixtures/antd-official/', import.meta.url));

export function loadCases({ filter = '', mode } = {}) {
  const records = [];
  for (const name of readdirSync(fixtureDirectory).filter(name => name.endsWith('.json.gz'))) {
    const capture = JSON.parse(gunzipSync(readFileSync(join(fixtureDirectory, name))));
    if (capture.schema !== 1 || capture.webpackSources !== require('webpack-sources/package.json').version) throw new Error('Capture version differs from replay reference');
    if (mode && capture.mode !== mode) continue;
    records.push(...capture.cases.filter(item => item.method !== 'streamChunks' && item.method !== 'buffers' && item.id.includes(filter)));
  }
  if (!records.length) throw new Error(`No captured calls match ${JSON.stringify({ filter, mode })}`);
  return records;
}

export function replay(record, source, { verify = false } = {}) {
  const args = record.args ?? [];
  if (record.method === 'updateHash') {
    const hash = createHash(record.hashAlgorithm);
    source.updateHash(hash);
    return hash.digest('hex');
  }
  const result = source[record.method](...args);
  return verify ? fingerprint(result) : result;
}

export function validateCases(records) {
  const rows = [];
  for (const record of records) {
    let referenceResult, actualResult, error;
    binding.debugSourceStats(true);
    try {
      const graph = restoreGraph(record.graph, reference);
      referenceResult = replay(record, graph, { verify: true });
      if (JSON.stringify(referenceResult) !== JSON.stringify(record.expected)) error = 'reference-replay-mismatch';
      const source = restoreGraph(record.graph, implementation, nativeState);
      actualResult = replay(record, source, { verify: true });
      if (!error && JSON.stringify(actualResult) !== JSON.stringify(referenceResult)) error = 'implementation-output-mismatch';
    } catch (cause) { error = `${cause.name}: ${cause.message}`; }
    rows.push({ id: record.id, valid: !error, error, referenceResult, actualResult, expected: record.expected, stats: binding.debugSourceStats(), frequency: record.frequency, ...record.graph.summary });
  }
  return { webpackSources: require('webpack-sources/package.json').version, rustSources: '0.103.0', node: process.version, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice(9) ?? '';
  const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7);
  const report = validateCases(loadCases({ filter, mode }));
  mkdirSync('.bench', { recursive: true });
  writeFileSync('.bench/antd-replay-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.table(report.rows.map(row => ({ id: row.id, valid: row.valid, sources: row.sources, shared: row.sharedSources, cachedFields: row.cacheFields, nativeReads: row.stats.nativeReads, fallbacks: row.stats.fallbacks, error: row.error ?? '' })));
  const valid = report.rows.filter(row => row.valid).length;
  console.log(`${valid}/${report.rows.length} captured operations reproduce webpack build output and match rspack-sources-js. .bench/antd-replay-validation.json`);
  if (process.argv.includes('--ci')) {
    const verification = verifyReport(report, { ci: true });
    for (const row of verification.excluded) console.log(`KNOWN MISMATCH, not measured: ${row.id}`);
    for (const id of verification.resolved) console.log(`RESOLVED known mismatch: ${id}`);
  } else if (valid !== report.rows.length) process.exitCode = 1;
}
