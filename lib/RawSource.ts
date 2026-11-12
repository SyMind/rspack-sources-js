/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');

export class RawSource extends Source {
  constructor(value: string | Buffer, convertToString = false) {
    super();
    binding.rawNew(this, value, convertToString);
  }

  isBuffer(): boolean {
    return binding.rawIsBuffer(this);
  }

  source(): SourceValue {
    return binding.rawSource(this);
  }

  buffer(): Buffer {
    return binding.rawBuffer(this);
  }

  size(): number {
    return binding.rawSize(this);
  }

  map(options?: MapOptions): RawSourceMap | null {
    return binding.rawMap(this, options?.columns !== false);
  }

  sourceAndMap(options?: MapOptions): Source.SourceAndMap {
    return binding.rawSourceAndMap(this, options?.columns !== false);
  }

  updateHash(hash: HashLike): void {
    hash.update("RawSource");
    hash.update(this.buffer());
  }
}

export declare namespace RawSource {
  export { HashLike, MapOptions, RawSourceMap, SourceValue, };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceValue = import("./Source").SourceValue;
