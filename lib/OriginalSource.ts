/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import Source = require("./Source");
import { getMap, getSourceAndMap } from "./helpers/getFromStreamChunks";
import getGeneratedSourceInfo = require("./helpers/getGeneratedSourceInfo");
import { eachPotentialToken } from "./helpers/splitIntoPotentialTokens";
import { isDualStringBufferCachingEnabled, } from "./helpers/stringBufferUtils";
class OriginalSource extends Source {
    declare _value: undefined | string;
    declare _valueAsBuffer: undefined | Buffer;
    declare _name: string;
    declare _scopeBindings: undefined | ScopeBindings;
    declare _cachedSize: number | undefined;
    /**
     * evaluates to in the generated code, for the map's `scopes` field
     */
    constructor(value: string | Buffer<ArrayBufferLike>, name: string, scopeBindings?: ScopeBindings | undefined) {
        super();
        const isBuffer = Buffer.isBuffer(value);
        this._value = isBuffer ? undefined : value;
        this._valueAsBuffer = isBuffer ? value : undefined;
        this._name = name;
        this._scopeBindings = scopeBindings;
    }
    getName() {
        return this._name;
    }
    source(): SourceValue {
        if (this._value === undefined) {
            const value = (this._valueAsBuffer as Buffer<ArrayBufferLike>).toString("utf8");
            if (isDualStringBufferCachingEnabled()) {
                this._value = value;
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
        return (this._cachedSize = Buffer.byteLength((this._value as string), "utf8"));
    }
    map(options?: MapOptions | undefined): RawSourceMap | null {
        return getMap(this, options);
    }
    sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
        return getSourceAndMap(this, options);
    }
    streamChunks(options: Options, onChunk: OnChunk, onSource: OnSource, _onName: OnName): GeneratedSourceInfo {
        if (this._value === undefined) {
            this._value =
                (this._valueAsBuffer as Buffer<ArrayBufferLike>).toString("utf8");
        }
        onSource(0, this._name, this._value, this._scopeBindings);
        const finalSource = Boolean(options && options.finalSource);
        if (!options || options.columns !== false) {
            // With column info we need to walk every potential token. The
            // scan is streamed by offset (see `eachPotentialToken`) so we
            // only allocate a chunk substring when one is actually emitted —
            // and `map()` / `sourceAndMap()` set `finalSource`, in which case
            // the chunk is dropped and no substring is allocated at all.
            const value = this._value;
            let line = 1;
            let column = 0;
            eachPotentialToken(value, (start: number, end: number, newline: boolean) => {
                const length = end - start;
                if (newline && length === 1) {
                    if (!finalSource)
                        onChunk("\n", line, column, -1, -1, -1, -1);
                }
                else {
                    const chunk = finalSource ? undefined : value.slice(start, end);
                    onChunk(chunk, line, column, 0, line, column, -1);
                }
                if (newline) {
                    line++;
                    column = 0;
                }
                else {
                    column += length;
                }
            });
            return {
                generatedLine: line,
                generatedColumn: column,
                source: finalSource ? value : undefined,
            };
        }
        else if (finalSource) {
            // Without column info and with final source we only
            // need meta info to generate mapping
            const result = getGeneratedSourceInfo(this._value);
            const { generatedLine, generatedColumn } = result;
            if (generatedColumn === 0) {
                for (let line = 1; line < (generatedLine as number); line++) {
                    onChunk(undefined, line, 0, 0, line, 0, -1);
                }
            }
            else {
                for (let line = 1; line <= (generatedLine as number); line++) {
                    onChunk(undefined, line, 0, 0, line, 0, -1);
                }
            }
            return result;
        }
        // Without column info, but also without final source.
        // We only get here when (options.columns === false && !finalSource),
        // so the source field is always undefined and the chunk arg is always
        // the line text. Single-pass scan over newlines avoids the
        // splitIntoLines array allocation.
        const value = this._value;
        const len = value.length;
        if (len === 0) {
            return { generatedLine: 1, generatedColumn: 0, source: undefined };
        }
        let line = 1;
        let i = 0;
        while (i < len) {
            const n = value.indexOf("\n", i);
            if (n === -1) {
                const lastLine = i === 0 ? value : value.slice(i);
                onChunk(lastLine, line, 0, 0, line, 0, -1);
                return {
                    generatedLine: line,
                    generatedColumn: lastLine.length,
                    source: undefined,
                };
            }
            const chunk = n === i ? "\n" : value.slice(i, n + 1);
            onChunk(chunk, line, 0, 0, line, 0, -1);
            line++;
            i = n + 1;
        }
        // Source ended with a newline.
        return { generatedLine: line, generatedColumn: 0, source: undefined };
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
        if (this._value !== undefined && this._valueAsBuffer !== undefined) {
            // When both forms are cached, drop the string (UTF-16 in V8 is
            // ~2 bytes/char) and keep the more compact buffer. source() will
            // rehydrate the string on demand.
            this._value = undefined;
        }
    }
    updateHash(hash: HashLike): void {
        hash.update("OriginalSource");
        // Same as RawSource: utf8 is what `buffer()` would have encoded to,
        // and one of the two forms is always set.
        if (this._valueAsBuffer === undefined) {
            hash.update((this._value as string));
        }
        else {
            hash.update(this._valueAsBuffer);
        }
        hash.update(this._name || "");
    }
}
export = OriginalSource;
declare namespace OriginalSource {
    export { ClearCacheOptions, HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, GeneratedSourceInfo, OnChunk, OnName, OnSource, Options, ScopeBindings, };
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
