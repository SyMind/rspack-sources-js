/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');
import { contextOf } from './nativeContext';
import { internString } from './helpers/stringBufferUtils';

export class RawSource extends Source {
  constructor(value: string | Buffer, convertToString = false) {
    super();
    if (typeof value === 'string') value = internString(value);
    binding.rawNew(this, contextOf(this), value, convertToString);
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
