/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');

function unavailable(): never {
  throw new Error("Content and Map of this Source is not available (only size() is supported)");
}

export class SizeOnlySource extends Source {
  constructor(size: number) {
    super();
    binding.sizeOnlyNew(this, size);
  }

  size(): number {
    return binding.sizeOnlySize(this);
  }

  source(): SourceValue {
    return unavailable();
  }

  buffer(): Buffer<ArrayBufferLike> {
    return unavailable();
  }

  buffers(): Buffer<ArrayBufferLike>[] {
    return unavailable();
  }

  map(_options?: MapOptions | undefined): RawSourceMap | null {
    return unavailable();
  }

  updateHash(_hash: HashLike): void {
    unavailable();
  }
}

export declare namespace SizeOnlySource {
  export { HashLike, MapOptions, RawSourceMap, SourceValue };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceValue = import("./Source").SourceValue;
