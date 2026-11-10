/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import RawSource = require("./RawSource");
import Source = require("./Source");
import { getMap, getSourceAndMap } from "./helpers/getFromStreamChunks";
import streamChunks = require("./helpers/streamChunks");
// `/\n/g` (no lookahead) lets V8's regex compiler take its
// literal-character fast path; the previous `/\n(?=.|\s)/g` form
// disabled it. Output stays identical because `buildPrefixed` strips
// the spurious trailing prefix when the input ended with a newline.
const NEWLINE_REGEX = /\n/g;
/**
 * Prepend `prefix` and insert `prefix` after every newline that has
 * content following — the original `/\n(?=.|\s)/g` semantics, but
 * implemented as a fast-path regex + tail-strip.
 */
const buildPrefixed = (prefix: string, node: string): string => {
    if (prefix.length === 0)
        return node;
    const replaced = node.replace(NEWLINE_REGEX, `\n${prefix}`);
    const len = node.length;
    // `/\n/g` matches the trailing newline too, so the replace appended
    // a spurious prefix at the end. Trim it.
    if (len > 0 && node.charCodeAt(len - 1) === 10) {
        return prefix + replaced.slice(0, replaced.length - prefix.length);
    }
    return prefix + replaced;
};
class PrefixSource extends Source {
    declare _prefix: string;
    declare _source: Source;
    constructor(prefix: string, source: string | Buffer<ArrayBufferLike> | Source) {
        super();
        this._prefix = prefix;
        this._source =
            typeof source === "string" || Buffer.isBuffer(source)
                ? new RawSource(source, true)
                : source;
    }
    getPrefix() {
        return this._prefix;
    }
    original() {
        return this._source;
    }
    source(): SourceValue {
        return buildPrefixed(this._prefix, (this._source.source() as string));
    }
    // buffer() / buffers() / size() inherit from Source.prototype.
    // Source.buffer() does Buffer.from(this.source(), "utf8") — cheaper
    // in CodSpeed instruction count than any safe override we tried
    // (caching is unsafe with mutable child; a JS-side splice loop
    // regressed ~5x in instruction count). Speeding up source() via the
    // simpler regex above lifts buffer(), buffers(), size(), and any
    // other `this.source()`-using path with no override needed.
    map(options?: MapOptions | undefined): RawSourceMap | null {
        return getMap(this, options);
    }
    sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
        return getSourceAndMap(this, options);
    }
    streamChunks(options: Options, onChunk: OnChunk, onSource: OnSource, onName: OnName): GeneratedSourceInfo {
        const prefix = this._prefix;
        const prefixOffset = prefix.length;
        const linesOnly = Boolean(options && options.columns === false);
        const { generatedLine, generatedColumn, source } = streamChunks(this._source, options, (chunk: string | undefined, generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => {
            if (generatedColumn !== 0) {
                // In the middle of the line, we just adject the column
                generatedColumn += prefixOffset;
            }
            else if (chunk !== undefined) {
                // At the start of the line, when we have source content
                // add the prefix as generated mapping
                // (in lines only mode we just add it to the original mapping
                // for performance reasons)
                if (linesOnly || sourceIndex < 0) {
                    chunk = prefix + chunk;
                }
                else if (prefixOffset > 0) {
                    onChunk(prefix, generatedLine, generatedColumn, -1, -1, -1, -1);
                    generatedColumn += prefixOffset;
                }
            }
            else if (!linesOnly) {
                // Without source content, we only need to adject the column info
                // expect in lines only mode where prefix is added to original mapping
                generatedColumn += prefixOffset;
            }
            onChunk(chunk, generatedLine, generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex);
        }, onSource, onName);
        return {
            generatedLine,
            generatedColumn: generatedColumn === 0
                ? 0
                : prefixOffset + (generatedColumn as number),
            source: source !== undefined ? buildPrefixed(prefix, source) : undefined,
        };
    }
    updateHash(hash: HashLike): void {
        hash.update("PrefixSource");
        this._source.updateHash(hash);
        hash.update(this._prefix);
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
        let v = visited;
        if (v === undefined)
            v = new WeakSet();
        v.add(this);
        this._source.clearCache(options, v);
    }
}
export = PrefixSource;
declare namespace PrefixSource {
    export { ClearCacheOptions, HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, GeneratedSourceInfo, OnChunk, OnName, OnSource, Options, };
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
