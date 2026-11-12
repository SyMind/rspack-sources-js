// Compatibility diagnostics for development tools. Graph planning lives in Rust.
import binding = require('./binding');
export const stats = new Proxy({} as ReturnType<typeof binding.debugSourceStats>, {
  get(_target, key) { return binding.debugSourceStats()[key as keyof ReturnType<typeof binding.debugSourceStats>]; },
});

export function resetStats() { binding.debugSourceStats(true); }

export function prepare(source: object) { return binding.debugSourceSnapshot(source); }
