/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');
import { RawSource } from './RawSource';

export class PrefixSource extends Source {
  readonly #source: Source;

  constructor(prefix: string, source: string | Buffer<ArrayBufferLike> | Source) {
    super();
    this.#source = typeof source === "string" || Buffer.isBuffer(source) ? new RawSource(source, true) : source;
    binding.prefixNew(this, prefix, this.#source);
  }

  getPrefix(): string {
    return binding.prefixGetPrefix(this);
  }

  original(): Source {
    return this.#source;
  }

  source(): SourceValue {
    return binding.prefixSource(this);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    return binding.prefixMap(this, options?.columns !== false);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return binding.prefixSourceAndMap(this, options?.columns !== false);
  }

  updateHash(hash: HashLike): void {
    hash.update("PrefixSource");
    this.#source.updateHash(hash);
    hash.update(binding.prefixGetPrefix(this));
  }

  buffer(): Buffer {
    return binding.prefixBuffer(this);
  }

  size(): number {
    return binding.prefixSize(this);
  }
}

export declare namespace PrefixSource {
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
