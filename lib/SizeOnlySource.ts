/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source, type HashLike, type MapOptions, type RawSourceMap, type SourceValue } from './Source';
import binding = require('./binding');

export class SizeOnlySource extends Source {
  constructor(size: number) {
    super();
    binding.sizeOnlyNew(this, size);
  }

  #error() {
		return new Error(
			"Content and Map of this Source is not available (only size() is supported)",
		);
	}

  size(): number {
    return binding.sizeOnlySize(this);
  }

  source(): SourceValue {
    throw this.#error();
  }

  buffer(): Buffer<ArrayBufferLike> {
    throw this.#error();
  }

  map(_options?: MapOptions | undefined): RawSourceMap | null {
    throw this.#error();
  }

  updateHash(_hash: HashLike): void {
    throw this.#error();
  }
}

export declare namespace SizeOnlySource {
  export { HashLike, MapOptions, RawSourceMap, SourceValue };
}
