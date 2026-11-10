import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyReport } from './verification.mjs';

const [known] = JSON.parse(readFileSync(new URL('./known-mismatches.json', import.meta.url)));
const failure = { ...known, referenceResult: known.expected, valid: false };

test('CI excludes only the exact recorded implementation mismatch', () => {
  assert.equal(verifyReport({ rows: [failure] }, { ci: true }).excluded.length, 1);
  for (const change of [
    { id: 'new/failure' }, { error: 'reference-replay-mismatch' },
    { referenceResult: 'changed-reference' }, { actualResult: 'changed-bug' },
  ]) assert.throws(() => verifyReport({ rows: [{ ...failure, ...change }] }, { ci: true, validOnly: true }));
});

test('fixed operations automatically return to the measured set', () => {
  const report = { rows: [{ ...failure, valid: true, error: undefined, actualResult: known.expected }] };
  const verified = verifyReport(report, { ci: true });
  assert.ok(verified.validIds.has(known.id));
  assert.deepEqual(verified.resolved, [known.id]);
  assert.equal(verified.excluded.length, 0);
});

test('local validation fails by default and requires an explicit valid-only exclusion', () => {
  assert.throws(() => verifyReport({ rows: [failure] }));
  assert.equal(verifyReport({ rows: [failure] }, { validOnly: true }).excluded.length, 1);
});
