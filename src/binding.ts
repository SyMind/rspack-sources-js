import type { NativeBinding } from './nativeTypes';

let binding: NativeBinding;
try {
  binding = require('../native/rspack_sources.node') as NativeBinding;
} catch (cause) {
  throw new Error('Unable to load rspack-sources-js native binding. Run "pnpm build" first.', { cause });
}
export = binding;
