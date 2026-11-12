/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');
import { isDualStringBufferCachingEnabled } from "./helpers/stringBufferUtils";

export class OriginalSource extends Source {
  readonly #name: string;
  #buffer?: Buffer;

  constructor(value: string | Buffer<ArrayBufferLike>, name: string) {
    super();
    this.#name = name;
    if (Buffer.isBuffer(value)) this.#buffer = value;
    binding.originalNew(this, value, name);
  }

  getName(): string {
    return this.#name;
  }

  source(): SourceValue {
    return binding.originalSource(this, isDualStringBufferCachingEnabled());
  }

  buffer(): Buffer<ArrayBufferLike> {
    return this.#getBuffer();
  }

  #getBuffer(): Buffer {
    if (this.#buffer !== undefined) return this.#buffer;
    const cache = isDualStringBufferCachingEnabled();
    const buffer = binding.originalBuffer(this, cache);
    if (cache) this.#buffer = buffer;
    return buffer;
  }

  size(): number {
    return binding.originalSize(this, this.#buffer?.length);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    return binding.originalMap(this, options?.columns !== false);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return binding.originalSourceAndMap(this, options?.columns !== false);
  }

  updateHash(hash: HashLike): void {
    hash.update("OriginalSource");
    hash.update(this.buffer());
    hash.update(this.#name);
  }

  buffers(): Buffer[] {
    return [this.#getBuffer()];
  }
}

export declare namespace OriginalSource {
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
