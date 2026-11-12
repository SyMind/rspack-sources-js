// Development diagnostics for the bound Rust sources.
import binding = require('./binding');
export function getStats() { return binding.debugSourceStats(); }

export function resetStats() { binding.debugSourceStats(true); }

export function prepare(source: object) { return binding.debugSourceSnapshot(source); }
