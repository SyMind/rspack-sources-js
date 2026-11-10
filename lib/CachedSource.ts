/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import Source = require("./Source");
import streamAndGetSourceAndMap = require("./helpers/streamAndGetSourceAndMap");
import streamChunksOfRawSource = require("./helpers/streamChunksOfRawSource");
import streamChunksOfSourceMap = require("./helpers/streamChunksOfSourceMap");
import { isDualStringBufferCachingEnabled, } from "./helpers/stringBufferUtils";
const mapToBufferedMap = (map: RawSourceMap | null): BufferedMap | null => {
    if (typeof map !== "object" || !map)
        return map;
    const bufferedMap = (({ ...map } as unknown) as BufferedMap);
    if (map.mappings) {
        bufferedMap.mappings = Buffer.from(map.mappings, "utf8");
    }
    if (map.sourcesContent) {
        bufferedMap.sourcesContent = map.sourcesContent.map((str: string) => str && Buffer.from(str, "utf8"));
    }
    return bufferedMap;
};
/**
 * Encodes every string a recorded hash update holds as a buffer, so cached data
 * handed to a caller carries no big string: a string goes into the serialized
 * payload, where it is copied in and rebuilt on every deserialization, while a
 * buffer is carried alongside it. Hashing reads a string as utf8, so the
 * encoded update hashes the same. It encodes in place, so a source handed out
 * repeatedly is encoded once, and one that never is keeps its string uncopied.
 */
const bufferHashUpdate = (update?: (string | Buffer<ArrayBufferLike>)[] | undefined): (string | Buffer<ArrayBufferLike>)[] | undefined => {
    if (update === undefined)
        return undefined;
    for (let index = 0; index < update.length; index++) {
        const item = update[index];
        if (typeof item === "string")
            update[index] = Buffer.from(item, "utf8");
    }
    return update;
};
const bufferedMapToMap = (bufferedMap: BufferedMap | null): RawSourceMap | null => {
    if (typeof bufferedMap !== "object" || !bufferedMap)
        return bufferedMap;
    const map = (({ ...bufferedMap } as unknown) as RawSourceMap);
    if (bufferedMap.mappings) {
        map.mappings = bufferedMap.mappings.toString("utf8");
    }
    if (bufferedMap.sourcesContent) {
        map.sourcesContent = bufferedMap.sourcesContent.map((buffer: "" | Buffer<ArrayBufferLike>) => buffer && buffer.toString("utf8"));
    }
    return map;
};
const CACHE_KEY_EMPTY = "{}";
const CACHE_KEY_COLUMNS_FALSE = '{"columns":false}';
const CACHE_KEY_COLUMNS_TRUE = '{"columns":true}';
/**
 * Fast-path replacement for `JSON.stringify(options)` when used as a cache
 * key. MapOptions / streamChunks Options are both small boolean-only shapes
 * and the overwhelmingly common shapes (`undefined`, `{}`, `{columns}`) can
 * be keyed without calling `JSON.stringify`, which dominates short-circuit
 * cache lookups. Falls back to `JSON.stringify` for any other shape so keys
 * remain compatible with previously cached `BufferedMaps` entries.
 */
const getCacheKey = (options: MapOptions | Options | undefined): string => {
    if (!options)
        return CACHE_KEY_EMPTY;
    const { columns } = options;
    if ((options as Options).source === undefined &&
        (options as Options).finalSource === undefined &&
        (options as MapOptions).module === undefined &&
        (options as MapOptions).scopes === undefined) {
        if (columns === undefined)
            return CACHE_KEY_EMPTY;
        return columns ? CACHE_KEY_COLUMNS_TRUE : CACHE_KEY_COLUMNS_FALSE;
    }
    return JSON.stringify(options);
};
class CachedSource extends Source {
    declare _source: Source | (() => Source);
    declare _cachedSource: undefined | string;
    declare _cachedSourceType: boolean | undefined;
    declare _cachedBuffer: Buffer | undefined;
    declare _cachedSize: number | undefined;
    declare _cachedMaps: BufferedMaps | undefined;
    declare _cachedHashUpdate: (string | Buffer)[] | undefined;
    declare _cachedBuffers: Buffer<ArrayBufferLike>[] | undefined;
    constructor(source: Source | (() => Source), cachedData?: CachedData | undefined) {
        super();
        this._source = source;
        this._cachedSource = undefined;
        // Split on `cachedData` once instead of re-evaluating the ternary for
        // every field. Under the interpreter (and CodSpeed's simulation) each
        // ternary is a separate branch; consolidating cuts the per-instance
        // branch count roughly in half.
        if (cachedData) {
            this._cachedSourceType = cachedData.source;
            this._cachedBuffer = cachedData.buffer;
            this._cachedSize = cachedData.size;
            this._cachedMaps = cachedData.maps;
            this._cachedHashUpdate = cachedData.hash;
        }
        else {
            this._cachedSourceType = undefined;
            this._cachedBuffer = undefined;
            this._cachedSize = undefined;
            this._cachedMaps = undefined;
            this._cachedHashUpdate = undefined;
        }
    }
    /**
     * The map cache, created on first use: a source nobody asks a map of holds
     * none, since V8 allocates a Map's hash table whether or not it is filled.
     */
    _getOrCreateCachedMaps(): BufferedMaps {
        const cachedMaps = this._cachedMaps;
        if (cachedMaps !== undefined)
            return cachedMaps;
        return (this._cachedMaps = new Map());
    }
    getCachedData(): CachedData {
        const bufferedMaps: BufferedMaps = new Map();
        if (this._cachedMaps !== undefined) {
            for (const pair of this._cachedMaps) {
                const [, cacheEntry] = pair;
                if (cacheEntry.bufferedMap === undefined) {
                    cacheEntry.bufferedMap = mapToBufferedMap(this._getMapFromCacheEntry(cacheEntry));
                }
                const bufferEntry: BufferEntry = {
                    map: undefined,
                    bufferedMap: cacheEntry.bufferedMap,
                };
                // Keep the bindings a `scopes` request recorded, so a source
                // restored from this data replays them without its original.
                if (cacheEntry.scopes !== undefined) {
                    bufferEntry.scopes = cacheEntry.scopes;
                }
                bufferedMaps.set(pair[0], bufferEntry);
            }
        }
        return {
            // `CachedData.buffer` is required (it is the on-disk
            // serialization format consumed by the
            // `new CachedSource(source, cachedData)` constructor).
            // `_cachedBuffer` is populated by `buffer()` calls but a
            // caller may invoke `getCachedData()` after `clearCache()`
            // has dropped it; `this.buffer()` rehydrates via the
            // wrapped source so the contract holds in every state.
            buffer: this.buffer(),
            source: this._cachedSourceType !== undefined
                ? this._cachedSourceType
                : typeof this._cachedSource === "string"
                    ? true
                    : Buffer.isBuffer(this._cachedSource)
                        ? false
                        : undefined,
            size: this._cachedSize,
            maps: bufferedMaps,
            hash: bufferHashUpdate(this._cachedHashUpdate),
        };
    }
    originalLazy() {
        return this._source;
    }
    original() {
        if (typeof this._source === "function")
            this._source = this._source();
        return this._source;
    }
    source(): SourceValue {
        // Fully inlined _getCachedSource: both warm- and cold-cache paths skip
        // the prototype method lookup / stack frame the interpreter would
        // otherwise pay on every call.
        if (this._cachedSource !== undefined)
            return this._cachedSource;
        const cachedBuffer = this._cachedBuffer;
        const cachedSourceType = this._cachedSourceType;
        if (cachedBuffer !== undefined && cachedSourceType !== undefined) {
            const value = cachedSourceType
                ? cachedBuffer.toString("utf8")
                : cachedBuffer;
            if (isDualStringBufferCachingEnabled()) {
                this._cachedSource = (value as string);
            }
            return (value as string);
        }
        return (this._cachedSource =
            (this.original().source() as string));
    }
    _getMapFromCacheEntry(cacheEntry: BufferEntry): RawSourceMap | null {
        if (cacheEntry.map !== undefined) {
            return cacheEntry.map;
        }
        else if (cacheEntry.bufferedMap !== undefined) {
            return (cacheEntry.map = bufferedMapToMap(cacheEntry.bufferedMap));
        }
        return null;
    }
    _getCachedSource(): string | undefined {
        if (this._cachedSource !== undefined)
            return this._cachedSource;
        if (this._cachedBuffer && this._cachedSourceType !== undefined) {
            const value = this._cachedSourceType
                ? this._cachedBuffer.toString("utf8")
                : this._cachedBuffer;
            if (isDualStringBufferCachingEnabled()) {
                this._cachedSource = (value as string);
            }
            return (value as string);
        }
    }
    buffer(): Buffer<ArrayBufferLike> {
        if (this._cachedBuffer !== undefined)
            return this._cachedBuffer;
        if (this._cachedBuffers !== undefined) {
            return (this._cachedBuffer = Buffer.concat(this._cachedBuffers));
        }
        if (this._cachedSource !== undefined) {
            const value = Buffer.isBuffer(this._cachedSource)
                ? this._cachedSource
                : Buffer.from(this._cachedSource, "utf8");
            if (isDualStringBufferCachingEnabled()) {
                this._cachedBuffer = value;
            }
            return value;
        }
        if (typeof this.original().buffer === "function") {
            return (this._cachedBuffer = this.original().buffer());
        }
        const bufferOrString = this.source();
        if (Buffer.isBuffer(bufferOrString)) {
            return (this._cachedBuffer = bufferOrString);
        }
        const value = Buffer.from(bufferOrString, "utf8");
        if (isDualStringBufferCachingEnabled()) {
            this._cachedBuffer = value;
        }
        return value;
    }
    buffers(): Buffer<ArrayBufferLike>[] {
        if (this._cachedBuffers !== undefined)
            return this._cachedBuffers;
        if (this._cachedBuffer !== undefined) {
            return (this._cachedBuffers = [this._cachedBuffer]);
        }
        const original = this.original();
        if (typeof original.buffers === "function") {
            return (this._cachedBuffers = original.buffers());
        }
        return (this._cachedBuffers = [this.buffer()]);
    }
    size(): number {
        if (this._cachedSize !== undefined)
            return this._cachedSize;
        if (this._cachedBuffer !== undefined) {
            return (this._cachedSize = this._cachedBuffer.length);
        }
        const source = this._getCachedSource();
        if (source !== undefined) {
            return (this._cachedSize = Buffer.byteLength(source));
        }
        return (this._cachedSize = this.original().size());
    }
    sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
        const key = getCacheKey(options);
        const cachedMaps = this._cachedMaps;
        const cacheEntry = cachedMaps === undefined ? undefined : cachedMaps.get(key);
        // Look for a cached map
        if (cacheEntry !== undefined) {
            // We have a cached map in some representation
            const map = this._getMapFromCacheEntry(cacheEntry);
            // Either get the cached source or compute it
            return { source: this.source(), map };
        }
        // Look for a cached source
        let source = this._getCachedSource();
        // Compute the map
        let map;
        if (source !== undefined) {
            map = this.original().map(options);
        }
        else {
            // Compute the source and map together.
            const sourceAndMap = this.original().sourceAndMap(options);
            source = (sourceAndMap.source as string);
            map = sourceAndMap.map;
            this._cachedSource = source;
        }
        this._getOrCreateCachedMaps().set(key, {
            map,
            bufferedMap: undefined,
        });
        return { source, map };
    }
    streamChunks(options: Options, onChunk: OnChunk, onSource: OnSource, onName: OnName): GeneratedSourceInfo {
        const key = getCacheKey(options);
        const scopes = Boolean(options && (options as MapOptions).scopes);
        const cachedMaps = this._cachedMaps;
        const cacheEntry = cachedMaps === undefined ? undefined : cachedMaps.get(key);
        if (cacheEntry !== undefined &&
            // An entry filled without streaming never saw the bindings, so a
            // scopes request streams the original once to record them.
            (!scopes || cacheEntry.scopes !== undefined) &&
            (this._cachedBuffer !== undefined || this._cachedSource !== undefined)) {
            const { source, map } = this.sourceAndMap(options);
            if (map) {
                const replay = scopes ? cacheEntry.scopes : undefined;
                return streamChunksOfSourceMap((source as string), replay !== undefined && map.names.length > replay.names
                    ? { ...map, names: map.names.slice(0, replay.names) }
                    : map, onChunk, replay !== undefined
                    ? (sourceIndex: number, source: string | null, sourceContent: string | undefined) => onSource(sourceIndex, source, sourceContent, replay.bindings[sourceIndex])
                    : onSource, onName, Boolean(options && options.finalSource), true);
            }
            return streamChunksOfRawSource((source as string), onChunk, onSource, onName, Boolean(options && options.finalSource));
        }
        const replay: ScopesReplay | undefined = scopes ? { bindings: [], names: 0 } : undefined;
        const sourceAndMap = streamAndGetSourceAndMap(this.original(), options, onChunk, replay !== undefined
            ? (sourceIndex: number, source: string | null, sourceContent: string | undefined, bindings: ScopeBindings | undefined) => {
                replay.bindings[sourceIndex] = bindings;
                onSource(sourceIndex, source, sourceContent, bindings);
            }
            : onSource, replay !== undefined
            ? (nameIndex: number, name: string) => {
                if (nameIndex >= replay.names)
                    replay.names = nameIndex + 1;
                onName(nameIndex, name);
            }
            : onName);
        this._cachedSource = sourceAndMap.source;
        this._getOrCreateCachedMaps().set(key, {
            map: (sourceAndMap.map as RawSourceMap),
            bufferedMap: undefined,
            scopes: replay,
        });
        return sourceAndMap.result;
    }
    map(options?: MapOptions | undefined): RawSourceMap | null {
        const key = getCacheKey(options);
        const cachedMaps = this._cachedMaps;
        const cacheEntry = cachedMaps === undefined ? undefined : cachedMaps.get(key);
        if (cacheEntry !== undefined) {
            return this._getMapFromCacheEntry(cacheEntry);
        }
        const map = this.original().map(options);
        this._getOrCreateCachedMaps().set(key, {
            map,
            bufferedMap: undefined,
        });
        return map;
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
        const clearSource = !options || options.source !== false;
        const clearMaps = !options || options.maps !== false;
        if (clearSource) {
            this._cachedSource = undefined;
            this._cachedSourceType = undefined;
            this._cachedBuffer = undefined;
            this._cachedBuffers = undefined;
        }
        if (clearMaps && this._cachedMaps !== undefined) {
            // Reusing the Map avoids per-call allocation churn when builds
            // call clearCache thousands of times.
            this._cachedMaps.clear();
        }
        if (typeof this._source !== "function") {
            let v = visited;
            if (v === undefined)
                v = new WeakSet();
            v.add(this);
            this._source.clearCache(options, v);
        }
        else if (visited !== undefined) {
            visited.add(this);
        }
    }
    updateHash(hash: HashLike): void {
        if (this._cachedHashUpdate !== undefined) {
            for (const item of this._cachedHashUpdate)
                hash.update(item);
            return;
        }
        const update: (string | Buffer<ArrayBufferLike>)[] = [];
        let currentString: string | undefined;
        const tracker = {
            update: (item: string | Buffer<ArrayBufferLike>): void => {
                if (typeof item === "string" && item.length < 10240) {
                    if (currentString === undefined) {
                        currentString = item;
                    }
                    else {
                        currentString += item;
                        if (currentString.length > 102400) {
                            update.push(Buffer.from(currentString));
                            currentString = undefined;
                        }
                    }
                }
                else {
                    if (currentString !== undefined) {
                        update.push(Buffer.from(currentString));
                        currentString = undefined;
                    }
                    update.push(item);
                }
            },
        };
        this.original().updateHash((tracker as HashLike));
        if (currentString !== undefined) {
            update.push(Buffer.from(currentString));
        }
        for (const item of update)
            hash.update(item);
        this._cachedHashUpdate = update;
    }
}
export = CachedSource;
declare namespace CachedSource {
    export { ClearCacheOptions, HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, GeneratedSourceInfo, OnChunk, OnName, OnSource, Options, ScopeBindings, BufferedMap, ScopesReplay, BufferEntry, BufferedMaps, CachedData, };
}
type ClearCacheOptions = import("./Source").ClearCacheOptions;
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
type GeneratedSourceInfo = import("./helpers/getGeneratedSourceInfo").GeneratedSourceInfo;
type OnChunk = import("./helpers/streamChunks").OnChunk;
type OnName = import("./helpers/streamChunks").OnName;
type OnSource = import("./helpers/streamChunks").OnSource;
type Options = import("./helpers/streamChunks").Options;
type ScopeBindings = import("./helpers/streamChunks").ScopeBindings;
type BufferedMap = {
    /**
     * version
     */
    version: number;
    /**
     * sources
     */
    sources: string[];
    /**
     * name
     */
    names: string[];
    /**
     * source root
     */
    sourceRoot?: string | undefined;
    /**
     * sources content
     */
    sourcesContent?: (Buffer | "")[] | undefined;
    /**
     * mappings
     */
    mappings?: Buffer | undefined;
    /**
     * file
     */
    file: string;
};
type ScopesReplay = {
    /**
     * bindings by source index
     */
    bindings: (ScopeBindings | undefined)[];
    /**
     * number of names the stream reported
     */
    names: number;
};
type BufferEntry = {
    map?: null | RawSourceMap;
    bufferedMap?: null | BufferedMap;
    scopes?: ScopesReplay;
};
type BufferedMaps = Map<string, BufferEntry>;
type CachedData = {
    /**
     * source
     */
    source?: boolean | undefined;
    /**
     * buffer
     */
    buffer: Buffer;
    /**
     * size
     */
    size?: number | undefined;
    /**
     * maps
     */
    maps: BufferedMaps;
    /**
     * hash
     */
    hash?: (string | Buffer)[] | undefined;
};
