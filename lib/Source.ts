/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
class Source {
    source(): SourceValue {
        throw new Error("Abstract");
    }
    buffer(): Buffer<ArrayBufferLike> {
        const source = this.source();
        if (Buffer.isBuffer(source))
            return source;
        return Buffer.from(source, "utf8");
    }
    buffers(): Buffer<ArrayBufferLike>[] {
        return [this.buffer()];
    }
    size(): number {
        return this.buffer().length;
    }
    // eslint-disable-next-line no-unused-vars
    map(options?: MapOptions | undefined): RawSourceMap | null {
        return null;
    }
    sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
        return {
            source: this.source(),
            map: this.map(options),
        };
    }
    // eslint-disable-next-line no-unused-vars
    updateHash(hash: HashLike): void {
        throw new Error("Abstract");
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
    // eslint-disable-next-line no-unused-vars
    clearCache(options?: ClearCacheOptions | undefined, visited?: WeakSet<Source> | undefined): void { }
}
export = Source;
declare namespace Source {
    export { MapOptions, RawSourceMap, SourceValue, SourceAndMap, HashLike, ClearCacheOptions, };
}
type MapOptions = {
    /**
     * need columns?
     */
    columns?: boolean | undefined;
    /**
     * is module
     */
    module?: boolean | undefined;
    /**
     * emit the `scopes` field from the bindings the sources declare
     */
    scopes?: boolean | undefined;
};
type RawSourceMap = {
    /**
     * version
     */
    version: number;
    /**
     * sources
     */
    sources: string[];
    /**
     * names
     */
    names: string[];
    /**
     * source root
     */
    sourceRoot?: string | undefined;
    /**
     * sources content
     */
    sourcesContent?: string[] | undefined;
    /**
     * mappings
     */
    mappings: string;
    /**
     * file
     */
    file: string;
    /**
     * debug id
     */
    debugId?: string | undefined;
    /**
     * ignore list
     */
    ignoreList?: number[] | undefined;
    /**
     * encoded `scopes` field of the "Scopes" proposal
     */
    scopes?: string | undefined;
};
type SourceValue = string | Buffer;
type SourceAndMap = {
    /**
     * source
     */
    source: SourceValue;
    /**
     * map
     */
    map: RawSourceMap | null;
};
type HashLike = {
    /**
     * make hash update
     */
    update: (data: string | Buffer, inputEncoding?: string) => HashLike;
    /**
     * get hash digest
     */
    digest: (encoding?: string) => string | Buffer;
};
type ClearCacheOptions = {
    /**
     * drop cached source maps (default `true`)
     */
    maps?: boolean | undefined;
    /**
     * drop cached source/buffer copies (default `true`)
     */
    source?: boolean | undefined;
    /**
     * drop the parsed object form of cached source maps on `SourceMapSource` instances (default `false` — re-parsing JSON is significantly more expensive than `toString`). Only takes effect when a serialized form (buffer or string) is also retained, so the data remains recoverable.
     */
    parsedMap?: boolean | undefined;
};
