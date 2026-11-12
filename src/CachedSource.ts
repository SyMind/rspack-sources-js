/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source, type HashLike, type MapOptions, type RawSourceMap, type SourceAndMap, type SourceValue } from './Source';
import binding = require('./binding');

type HashUpdates = (string | Buffer)[];

export class CachedSource extends Source {
  readonly #original: Source;
  #hash?: HashUpdates;

  constructor(source: Source) {
    super();
    this.#original = source;
    binding.cachedNew(this, source);
  }

  originalLazy(): Source {
    return this.#original;
  }

  original(): Source {
    return this.#original;
  }

  source(): SourceValue {
    return binding.cachedSource(this);
  }

  buffer(): Buffer {
    return binding.cachedBuffer(this);
  }

  size(): number {
    return binding.cachedSize(this);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return binding.cachedSourceAndMap(this, options?.columns !== false);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    return binding.cachedMap(this, options?.columns !== false);
  }

  updateHash(hash: HashLike): void {
    const cached = this.#hash;
    if (cached !== undefined) {
      for (const item of cached) hash.update(item);
      return;
    }
    const updates: HashUpdates = [];
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
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, };
}
