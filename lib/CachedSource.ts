/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');
import { readMap } from './helpers/cachedSourceMaps';

export class CachedSource extends Source {
  #original: Original;
  #maps: BufferedMaps | undefined;
  #hash: CachedData['hash'];

  constructor(source: Original, cachedData?: CachedData) {
    super();
    const { source: type, buffer, size, maps, hash } = cachedData ?? {};
    this.#original = source;
    this.#maps = maps;
    this.#hash = hash;
    binding.cachedNew(this, type, buffer, size);
  }

  originalLazy(): Original {
    return this.#original;
  }

  original(): Source {
    if (typeof this.#original === "function") this.#original = this.#original();
    return this.#original;
  }

  source(): SourceValue {
    return binding.cachedSource(this);
  }

  buffer(): Buffer<ArrayBufferLike> {
    return binding.cachedBuffer(this);
  }

  buffers(): Buffer<ArrayBufferLike>[] {
    return binding.cachedBuffers(this);
  }

  size(): number {
    return binding.cachedSize(this);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return binding.cachedSourceAndMap(this, options);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    const key = JSON.stringify(options ?? {});
    const entry = this.#maps?.get(key);
    if (entry !== undefined) return readMap(entry);
    const map = this.original().map(options);
    (this.#maps ??= new Map()).set(key, { map, bufferedMap: undefined });
    return map;
  }

  updateHash(hash: HashLike): void {
    const cached = this.#hash;
    if (cached !== undefined) {
      for (const item of cached) hash.update(item);
      return;
    }
    const updates: (string | Buffer)[] = [];
    let currentString: string | undefined;
    const tracker = {
      update(item: string | Buffer): void {
        if (typeof item === "string" && item.length < 10240) {
          currentString = currentString === undefined ? item : currentString + item;
          if (currentString.length > 102400) {
            updates.push(Buffer.from(currentString));
            currentString = undefined;
          }
          return;
        }
        if (currentString !== undefined) {
          updates.push(Buffer.from(currentString));
          currentString = undefined;
        }
        updates.push(item);
      },
    };
    this.original().updateHash(tracker as HashLike);
    if (currentString !== undefined) {
      updates.push(Buffer.from(currentString));
    }
    for (const item of updates) hash.update(item);
    this.#hash = updates;
  }
}

export declare namespace CachedSource {
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, BufferedMap, BufferEntry, BufferedMaps, CachedData, };
}
type Original = Source | (() => Source);
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
type BufferedMap = {
  /**
   * version
   */
  version: number;
  /**
   * sources
   */
  sources: string[];
  /**
   * name
   */
  names: string[];
  /**
   * source root
   */
  sourceRoot?: string | undefined;
  /**
   * sources content
   */
  sourcesContent?: (Buffer | "")[] | undefined;
  /**
   * mappings
   */
  mappings?: Buffer | undefined;
  /**
   * file
   */
  file: string;
};
type BufferEntry = {
  map?: null | RawSourceMap;
  bufferedMap?: null | BufferedMap;
};
type BufferedMaps = Map<string, BufferEntry>;
export type CachedData = {
  /**
   * source
   */
  source?: boolean | undefined;
  /**
   * buffer
   */
  buffer: Buffer;
  /**
   * size
   */
  size?: number | undefined;
  /**
   * maps
   */
  maps: BufferedMaps;
  /**
   * hash
   */
  hash?: (string | Buffer)[] | undefined;
};
