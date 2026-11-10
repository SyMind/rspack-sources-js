import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(new URL('./fixtures/antd-official/', import.meta.url));
const captures = readdirSync(directory).filter(name => name.endsWith('.json.gz')).sort().map(name =>
  JSON.parse(gunzipSync(readFileSync(join(directory, name)))));
const summary = captures.map(capture => ({
  mode: capture.mode,
  outerCalls: capture.trace.length,
  nestedCalls: Object.values(capture.innerHistogram).reduce((sum, count) => sum + count, 0),
  unsupported: capture.unsupported,
  cases: capture.cases.map(record => ({
    id: record.id, asset: record.asset, observedCalls: record.frequency,
    options: record.args, ...record.graph.summary,
  })),
}));
writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
for (const capture of summary) {
  console.log(`${capture.mode}: ${capture.outerCalls} outer calls, ${capture.nestedCalls} nested calls`);
  console.table(capture.cases.map(({ id, observedCalls, sources, sharedSources, cacheFields, asset }) =>
    ({ id, observedCalls, sources, sharedSources, cacheFields, asset })));
}
