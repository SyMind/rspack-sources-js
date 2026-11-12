/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');

export class CompatSource extends Source {
  readonly #sourceLike: SourceLike;

  static from(sourceLike: SourceLike): Source {
    return sourceLike instanceof Source
      ? sourceLike
      : new CompatSource(sourceLike);
  }

  constructor(sourceLike: SourceLike) {
    super();
    this.#sourceLike = sourceLike;
    binding.compatNew(this, sourceLike);
  }

  source(): SourceValue {
    return binding.compatSource(this);
  }

  buffer(): Buffer {
    return binding.compatBuffer(this);
  }

  size(): number {
    return binding.compatSize(this);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    return binding.compatMap(this, options?.columns !== false);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return binding.compatSourceAndMap(this, options?.columns !== false);
  }

  updateHash(hash: HashLike): void {
    const source = this.#sourceLike;
    if (typeof source.updateHash === "function") {
      return source.updateHash(hash);
    }
    if (typeof source.map === "function") {
      throw new Error("A Source-like object with a 'map' method must also provide an 'updateHash' method");
    }
    hash.update(this.buffer());
  }
}

export declare namespace CompatSource {
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, SourceLike, };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
export type SourceLike = {
  /**
   * source
   */
  source: () => SourceValue;
  /**
   * buffer
   */
  buffer?: (() => Buffer) | undefined;
  /**
   * buffers
   */
  buffers?: (() => Buffer[]) | undefined;
  /**
   * size
   */
  size?: (() => number) | undefined;
  /**
   * map
   */
  map?: ((options?: MapOptions) => RawSourceMap | null) | undefined;
  /**
   * source and map
   */
  sourceAndMap?: ((options?: MapOptions) => SourceAndMap) | undefined;
  /**
   * hash updater
   */
  updateHash?: ((hash: HashLike) => void) | undefined;
};
