import binding = require('./binding');
import { RawSource } from './RawSource';
import { contextOf } from './nativeContext';

binding.registerSourceHelpers({
  createSourceJsObject(kind, value, convertToString) {
    switch (kind) {
      case 'RawSource': return new RawSource(value, convertToString);
      default: throw new TypeError(`Unsupported source kind: ${kind}`);
    }
  },
  contextOf,
});

// Public classes bind their native state at construction.
export { Source, RawSource, OriginalSource, SourceMapSource, ConcatSource, ReplaceSource, CachedSource, PrefixSource, SizeOnlySource, CompatSource, util } from './sources';
export type { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue } from './Source';
export type { CachedData } from './CachedSource';
export type { SourceLike } from './CompatSource';
export type { Child as ConcatSourceChild } from './ConcatSource';
export type { Replacement } from './ReplaceSource';
