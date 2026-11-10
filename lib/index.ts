import * as sources from './sources';
import * as planner from './planner';
import type { NodeKind } from './nativeTypes';
import type { ClearCacheOptions, MapOptions } from './Source';

type AcceleratedConstructor = typeof sources.OriginalSource | typeof sources.SourceMapSource | typeof sources.ConcatSource | typeof sources.ReplaceSource;

function accelerate<T extends AcceleratedConstructor>(Base: T, kind: NodeKind): T {
  class AcceleratedSource extends (Base as typeof sources.Source) {
    map(options?: MapOptions) {
      // Direct maps preserve object identity, unknown fields, and serialization.
      if ((this instanceof sources.SourceMapSource && !this._hasInnerSourceMap) || (this instanceof sources.ReplaceSource && this._replacements.length === 0)) return super.map(options);
      return planner.nativeRead(this, 'map', options, () => super.map(options));
    }
    sourceAndMap(options?: MapOptions) {
      if ((this instanceof sources.SourceMapSource && !this._hasInnerSourceMap) || (this instanceof sources.ReplaceSource && this._replacements.length === 0)) return super.sourceAndMap(options);
      return planner.nativeRead(this, 'sourceAndMap', options, () => super.sourceAndMap(options));
    }
    clearCache(options?: ClearCacheOptions, visited?: WeakSet<sources.Source>) {
      if (!visited || !visited.has(this)) planner.forget(this);
      return super.clearCache(options, visited);
    }
  }
  Object.defineProperty(AcceleratedSource, 'name', { value: Base.name });
  planner.register(AcceleratedSource, kind);
  return AcceleratedSource as unknown as T;
}

// Streaming and callback dispatch are implemented by the local TypeScript classes.
export { Source, RawSource, CachedSource, PrefixSource, SizeOnlySource, CompatSource, util } from './sources';
export const OriginalSource = accelerate(sources.OriginalSource, 'original');
export type OriginalSource = sources.OriginalSource;
export const SourceMapSource = accelerate(sources.SourceMapSource, 'mapped');
export type SourceMapSource = sources.SourceMapSource;
export const ConcatSource = accelerate(sources.ConcatSource, 'concat');
export type ConcatSource = sources.ConcatSource;
export const ReplaceSource = accelerate(sources.ReplaceSource, 'replace');
export type ReplaceSource = sources.ReplaceSource;
export type { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, ClearCacheOptions } from './Source';
export type { CachedData } from './CachedSource';
export type { SourceLike } from './CompatSource';
export type { Child as ConcatSourceChild } from './ConcatSource';
export type { Replacement } from './ReplaceSource';
export type { GeneratedSourceInfo } from './helpers/getGeneratedSourceInfo';
export type { OnChunk, OnName, OnSource, Options as StreamChunksOptions } from './helpers/streamChunks';
