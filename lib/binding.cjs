'use strict';
try {
  module.exports = require('../native/rspack_sources.node');
} catch (cause) {
  throw new Error('Unable to load rspack-sources-js native binding. Run "pnpm build" first.', { cause });
}
