import { readFileSync } from 'node:fs';

const known = JSON.parse(readFileSync(new URL('./known-mismatches.json', import.meta.url)));

export function verifyReport(report, { ci = false, validOnly = false } = {}) {
  const invalid = report.rows.filter(row => !row.valid);
  const permitted = ci ? invalid.filter(row => known.some(entry =>
    row.id === entry.id && row.error === entry.error &&
    row.expected === entry.expected && row.referenceResult === entry.expected &&
    row.actualResult === entry.actualResult)) : validOnly ? invalid : [];
  const unexpected = invalid.filter(row => !permitted.includes(row));
  if (unexpected.length) throw new Error(`Replay verification failed: ${unexpected.map(row => `${row.id} (${row.error})`).join(', ')}`);
  return {
    validIds: new Set(report.rows.filter(row => row.valid).map(row => row.id)),
    excluded: permitted,
    resolved: known.filter(entry => report.rows.some(row => row.id === entry.id && row.valid)).map(entry => entry.id),
  };
}
