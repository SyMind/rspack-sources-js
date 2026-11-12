// Public classes bind their native state at construction.
export { Source, RawSource, OriginalSource, SourceMapSource, ConcatSource, ReplaceSource, CachedSource, PrefixSource, SizeOnlySource, CompatSource, util } from './sources';
export type { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue } from './Source';
export type { SourceLike } from './CompatSource';
export type { Child as ConcatSourceChild } from './ConcatSource';
export type { Replacement } from './ReplaceSource';
