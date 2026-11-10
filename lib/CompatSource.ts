/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import Source = require("./Source");
class CompatSource extends Source {
    declare _sourceLike: SourceLike;
    static from(sourceLike: SourceLike): Source {
        return sourceLike instanceof Source
            ? sourceLike
            : new CompatSource(sourceLike);
    }
    constructor(sourceLike: SourceLike) {
        super();
        this._sourceLike = sourceLike;
    }
    source(): SourceValue {
        return this._sourceLike.source();
    }
    buffer(): Buffer<ArrayBufferLike> {
        if (typeof this._sourceLike.buffer === "function") {
            return this._sourceLike.buffer();
        }
        return super.buffer();
    }
    buffers(): Buffer<ArrayBufferLike>[] {
        if (typeof this._sourceLike.buffers === "function") {
            return this._sourceLike.buffers();
        }
        return super.buffers();
    }
    size(): number {
        if (typeof this._sourceLike.size === "function") {
            return this._sourceLike.size();
        }
        return super.size();
    }
    map(options?: MapOptions | undefined): RawSourceMap | null {
        if (typeof this._sourceLike.map === "function") {
            return this._sourceLike.map(options);
        }
        return super.map(options);
    }
    sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
        if (typeof this._sourceLike.sourceAndMap === "function") {
            return this._sourceLike.sourceAndMap(options);
        }
        return super.sourceAndMap(options);
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
        if (visited !== undefined && visited.has(this))
            return;
        if (visited !== undefined)
            visited.add(this);
        const sourceLike = this._sourceLike;
        if (typeof sourceLike.clearCache === "function") {
            sourceLike.clearCache(options, visited);
        }
    }
    updateHash(hash: HashLike): void {
        if (typeof this._sourceLike.updateHash === "function") {
            return this._sourceLike.updateHash(hash);
        }
        if (typeof this._sourceLike.map === "function") {
            throw new Error("A Source-like object with a 'map' method must also provide an 'updateHash' method");
        }
        hash.update(this.buffer());
    }
}
export = CompatSource;
declare namespace CompatSource {
    export { ClearCacheOptions, HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, SourceLike, };
}
type ClearCacheOptions = import("./Source").ClearCacheOptions;
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
type SourceLike = {
    /**
     * source
     */
    source: () => SourceValue;
    /**
     * buffer
     */
    buffer?: (() => Buffer) | undefined;
    /**
     * buffers
     */
    buffers?: (() => Buffer[]) | undefined;
    /**
     * size
     */
    size?: (() => number) | undefined;
    /**
     * map
     */
    map?: ((options?: MapOptions) => RawSourceMap | null) | undefined;
    /**
     * source and map
     */
    sourceAndMap?: ((options?: MapOptions) => SourceAndMap) | undefined;
    /**
     * hash updater
     */
    updateHash?: ((hash: HashLike) => void) | undefined;
    /**
     * clear cache
     */
    clearCache?: ((options?: ClearCacheOptions, visited?: WeakSet<Source>) => void) | undefined;
};
