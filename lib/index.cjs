'use strict';

const reference = require('webpack-sources-reference');
const planner = require('./planner.cjs');

function accelerate(Base, kind) {
  class AcceleratedSource extends Base {
    map(options) {
      // Direct maps preserve object identity, unknown fields, and original serialization.
      if ((kind === 'mapped' && !this._hasInnerSourceMap) || (kind === 'replace' && this._replacements.length === 0)) return super.map(options);
      return planner.nativeRead(this, 'map', options, () => super.map(options));
    }
    sourceAndMap(options) {
      if ((kind === 'mapped' && !this._hasInnerSourceMap) || (kind === 'replace' && this._replacements.length === 0)) return super.sourceAndMap(options);
      return planner.nativeRead(this, 'sourceAndMap', options, () => super.sourceAndMap(options));
    }
    clearCache(options, visited) {
      if (!visited || !visited.has(this)) planner.forget(this);
      return super.clearCache(options, visited);
    }
  }
  Object.defineProperty(AcceleratedSource, 'name', { value: Base.name });
  planner.register(AcceleratedSource, kind);
  return AcceleratedSource;
}

// streamChunks is inherited without a native trampoline. Its callback loop stays in JS.
exports.Source = reference.Source;
exports.RawSource = reference.RawSource;
exports.OriginalSource = accelerate(reference.OriginalSource, 'original');
exports.SourceMapSource = accelerate(reference.SourceMapSource, 'mapped');
exports.ConcatSource = accelerate(reference.ConcatSource, 'concat');
exports.ReplaceSource = accelerate(reference.ReplaceSource, 'replace');
exports.CachedSource = reference.CachedSource;
exports.PrefixSource = reference.PrefixSource;
exports.SizeOnlySource = reference.SizeOnlySource;
exports.CompatSource = reference.CompatSource;
exports.util = reference.util;
