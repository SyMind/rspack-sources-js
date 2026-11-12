/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source, type HashLike, type MapOptions, type RawSourceMap, type SourceAndMap, type SourceValue } from './Source';
import binding = require('./binding');

export class SourceMapSource extends Source {
  constructor(value: string | Buffer<ArrayBufferLike>, name: string, sourceMap?: string | Buffer<ArrayBufferLike> | RawSourceMap | undefined, originalSource?: SourceValue | undefined, innerSourceMap?: string | Buffer<ArrayBufferLike> | RawSourceMap | null | undefined, removeOriginalSource?: boolean | undefined) {
    super();
    binding.sourceMapNew(this, value, name, sourceMap, originalSource, innerSourceMap, removeOriginalSource);
  }

  getArgsAsBuffers(): [
    Buffer,
    string,
    Buffer | undefined,
    Buffer | undefined,
    Buffer | undefined,
    boolean | undefined
  ] {
    return binding.sourceMapGetArgsAsBuffers(this);
  }

  buffer(): Buffer {
    return binding.sourceMapBuffer(this);
  }

  size(): number {
    return binding.sourceMapSize(this);
  }

  source(): SourceValue {
    return binding.sourceMapSource(this);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    return binding.sourceMapMap(this, options?.columns !== false);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return binding.sourceMapSourceAndMap(this, options?.columns !== false);
  }

  updateHash(hash: HashLike): void {
    const [value, , map, original, inner, removeOriginal] = this.getArgsAsBuffers();
    hash.update("SourceMapSource");
    hash.update(value);
    if (map !== undefined) hash.update(map);
    if (original !== undefined) hash.update(original);
    if (inner !== undefined) hash.update(inner);
    hash.update(removeOriginal ? "true" : "false");
  }
}

export declare namespace SourceMapSource {
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, };
}
