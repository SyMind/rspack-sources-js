/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source, type HashLike, type MapOptions, type RawSourceMap, type SourceAndMap, type SourceValue } from './Source';
import binding = require('./binding');

export class OriginalSource extends Source {

  constructor(value: string | Buffer<ArrayBufferLike>, name: string) {
    super();
    binding.originalNew(this, value, name);
  }

  getName(): string {
    return binding.originalGetName(this);
  }

  source(): SourceValue {
    return binding.originalSource(this);
  }

  buffer(): Buffer {
    return binding.originalBuffer(this);
  }

  size(): number {
    return binding.originalSize(this);
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
    hash.update(binding.originalGetName(this));
  }
}

export declare namespace OriginalSource {
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, };
}
