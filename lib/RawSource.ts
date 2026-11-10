/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import Source = require("./Source");
import streamChunksOfRawSource = require("./helpers/streamChunksOfRawSource");
import { internString, isDualStringBufferCachingEnabled, } from "./helpers/stringBufferUtils";
class RawSource extends Source {
    declare _valueIsBuffer: boolean;
    declare _value: undefined | string | Buffer;
    declare _valueAsBuffer: undefined | Buffer;
    declare _valueAsString: undefined | string;
    declare _cachedSize: number | undefined;
    constructor(value: string | Buffer<ArrayBufferLike>, convertToString: boolean | undefined = false) {
        super();
        const isBuffer = Buffer.isBuffer(value);
        if (isBuffer) {
            this._valueIsBuffer = !convertToString;
            this._value = convertToString ? undefined : value;
            this._valueAsBuffer = value;
            this._valueAsString = undefined;
        }
        else if (typeof value === "string") {
            const interned = internString(value);
            this._valueIsBuffer = false;
            this._value = interned;
            this._valueAsBuffer = undefined;
            this._valueAsString = interned;
        }
        else {
            throw new TypeError("argument 'value' must be either string or Buffer");
        }
    }
    isBuffer() {
        return this._valueIsBuffer;
    }
    source(): SourceValue {
        if (this._value === undefined) {
            const value = (this._valueAsBuffer as Buffer<ArrayBufferLike>).toString("utf8");
            if (isDualStringBufferCachingEnabled()) {
                this._value = internString(value);
            }
            return value;
        }
        return this._value;
    }
    buffer(): Buffer<ArrayBufferLike> {
        if (this._valueAsBuffer === undefined) {
            const value = Buffer.from((this._value as string), "utf8");
            if (isDualStringBufferCachingEnabled()) {
                this._valueAsBuffer = value;
            }
            return value;
        }
        return this._valueAsBuffer;
    }
    size(): number {
        if (this._cachedSize !== undefined)
            return this._cachedSize;
        if (this._valueAsBuffer !== undefined) {
            return (this._cachedSize = this._valueAsBuffer.length);
        }
        return (this._cachedSize = Buffer.byteLength((this._valueAsString as string), "utf8"));
    }
    // eslint-disable-next-line no-unused-vars
    map(options?: MapOptions | undefined): RawSourceMap | null {
        return null;
    }
    streamChunks(options: Options, onChunk: OnChunk, onSource: OnSource, onName: OnName): GeneratedSourceInfo {
        let strValue = this._valueAsString;
        if (strValue === undefined) {
            const value = this.source();
            strValue = typeof value === "string" ? value : value.toString("utf8");
            if (isDualStringBufferCachingEnabled()) {
                this._valueAsString = internString(strValue);
            }
        }
        return streamChunksOfRawSource(strValue, onChunk, onSource, onName, Boolean(options && options.finalSource));
    }
    /**
     * Release cached data held by this source. clearCache is a memory
     * hint: it never affects correctness or output, only how expensive
     * the next read is. Subclasses override; the base is a no-op so
     * every Source supports the call. Composite sources always recurse
     * into wrapped sources. When the same child is reachable via several
     * parents (e.g. modules shared across webpack chunks), pass a shared
     * `visited` WeakSet so each subtree is walked at most once.
     * Not safe to call concurrently with source/map/sourceAndMap/
     * streamChunks/updateHash on the same instance.
     */
    clearCache(options?: ClearCacheOptions | undefined, visited?: WeakSet<Source> | undefined): void {
        if (visited !== undefined) {
            if (visited.has(this))
                return;
            visited.add(this);
        }
        if (options !== undefined && options.source === false)
            return;
        if (this._valueIsBuffer) {
            // Buffer is the primary representation (and lives in `_value`);
            // only the string form, populated lazily by streamChunks, is
            // safe to drop.
            this._valueAsString = undefined;
        }
        else if (this._valueAsBuffer !== undefined && this._value !== undefined) {
            // The source was constructed from a string (so `_value` and
            // `_valueAsString` reference the same interned string) and the
            // buffer form was materialized later by `buffer()` /
            // `updateHash()`. The buffer is therefore safe to drop.
            this._valueAsBuffer = undefined;
        }
    }
    updateHash(hash: HashLike): void {
        hash.update("RawSource");
        // A string is hashed as utf8, which is what `buffer()` would have
        // encoded it to, so hashing never has to materialize the buffer.
        // One of the two forms is always set: the constructor sets whichever
        // matches its input, and `clearCache` only drops the derived one.
        if (this._valueAsBuffer === undefined) {
            hash.update((this._valueAsString as string));
        }
        else {
            hash.update(this._valueAsBuffer);
        }
    }
}
export = RawSource;
declare namespace RawSource {
    export { ClearCacheOptions, HashLike, MapOptions, RawSourceMap, SourceValue, GeneratedSourceInfo, OnChunk, OnName, OnSource, Options, };
}
type ClearCacheOptions = import("./Source").ClearCacheOptions;
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceValue = import("./Source").SourceValue;
type GeneratedSourceInfo = import("./helpers/getGeneratedSourceInfo").GeneratedSourceInfo;
type OnChunk = import("./helpers/streamChunks").OnChunk;
type OnName = import("./helpers/streamChunks").OnName;
type OnSource = import("./helpers/streamChunks").OnSource;
type Options = import("./helpers/streamChunks").Options;
