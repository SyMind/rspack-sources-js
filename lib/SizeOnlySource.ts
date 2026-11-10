/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import Source = require("./Source");
class SizeOnlySource extends Source {
    declare _size: number;
    constructor(size: number) {
        super();
        this._size = size;
    }
    _error() {
        return new Error("Content and Map of this Source is not available (only size() is supported)");
    }
    size(): number {
        return this._size;
    }
    source(): SourceValue {
        throw this._error();
    }
    buffer(): Buffer<ArrayBufferLike> {
        throw this._error();
    }
    buffers(): Buffer<ArrayBufferLike>[] {
        throw this._error();
    }
    // eslint-disable-next-line no-unused-vars
    map(options?: MapOptions | undefined): RawSourceMap | null {
        throw this._error();
    }
    // eslint-disable-next-line no-unused-vars
    updateHash(hash: HashLike): void {
        throw this._error();
    }
}
export = SizeOnlySource;
declare namespace SizeOnlySource {
    export { HashLike, MapOptions, RawSourceMap, SourceValue };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceValue = import("./Source").SourceValue;
