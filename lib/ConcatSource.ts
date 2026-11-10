/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import RawSource = require("./RawSource");
import Source = require("./Source");
import { getMap, getSourceAndMap } from "./helpers/getFromStreamChunks";
import streamChunks = require("./helpers/streamChunks");
const stringsAsRawSources = new WeakSet();
class ConcatSource extends Source {
    declare _children: Child[];
    declare _isOptimized: boolean;
    constructor(...args: Child[]) {
        super();
        this._children = [];
        // Indexed loops avoid the iterator-protocol overhead `for...of`
        // pays per element. Hot during webpack's emit when many
        // ConcatSources are constructed/flattened.
        for (let i = 0, l = args.length; i < l; i++) {
            const item = args[i];
            if (item instanceof ConcatSource) {
                const children = item._children;
                for (let j = 0, jl = children.length; j < jl; j++) {
                    this._children.push(children[j]);
                }
            }
            else {
                this._children.push(item);
            }
        }
        this._isOptimized = args.length === 0;
    }
    getChildren(): Source[] {
        if (!this._isOptimized)
            this._optimize();
        return (this._children as Source[]);
    }
    add(item: Child): void {
        if (item instanceof ConcatSource) {
            const children = item._children;
            for (let i = 0, l = children.length; i < l; i++) {
                this._children.push(children[i]);
            }
        }
        else {
            this._children.push(item);
        }
        this._isOptimized = false;
    }
    addAllSkipOptimizing(items: Child[]): void {
        for (let i = 0, l = items.length; i < l; i++) {
            this._children.push(items[i]);
        }
    }
    buffer(): Buffer<ArrayBufferLike> {
        return Buffer.concat(this.buffers());
    }
    buffers(): Buffer<ArrayBufferLike>[] {
        if (!this._isOptimized)
            this._optimize();
        const children = (this._children as SourceLike[]);
        const childCount = children.length;
        const buffers: Buffer<ArrayBufferLike>[] = [];
        // Indexed loop + manual splat avoids the iterator allocation per
        // child and the inner for-of allocation per child.buffers() call.
        // Hot path during webpack's emit on deeply-nested ConcatSources.
        for (let ci = 0; ci < childCount; ci++) {
            const child = children[ci];
            if (typeof child.buffers === "function") {
                const childBuffers = child.buffers();
                for (let bi = 0, blen = childBuffers.length; bi < blen; bi++) {
                    buffers.push(childBuffers[bi]);
                }
            }
            else if (typeof child.buffer === "function") {
                buffers.push(child.buffer());
            }
            else {
                const bufferOrString = child.source();
                if (Buffer.isBuffer(bufferOrString)) {
                    buffers.push(bufferOrString);
                }
                else {
                    // This will not happen
                    buffers.push(Buffer.from(bufferOrString, "utf8"));
                }
            }
        }
        return buffers;
    }
    source(): SourceValue {
        if (!this._isOptimized)
            this._optimize();
        const children = (this._children as Source[]);
        const childCount = children.length;
        let source = "";
        for (let ci = 0; ci < childCount; ci++) {
            source += children[ci].source();
        }
        return source;
    }
    size(): number {
        if (!this._isOptimized)
            this._optimize();
        const children = (this._children as Source[]);
        const childCount = children.length;
        let size = 0;
        for (let ci = 0; ci < childCount; ci++) {
            size += children[ci].size();
        }
        return size;
    }
    map(options?: MapOptions | undefined): RawSourceMap | null {
        return getMap(this, options);
    }
    sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
        return getSourceAndMap(this, options);
    }
    streamChunks(options: Options, onChunk: OnChunk, onSource: OnSource, onName: OnName): GeneratedSourceInfo {
        if (!this._isOptimized)
            this._optimize();
        if (this._children.length === 1) {
            return (this._children as ConcatSource[])[0].streamChunks(options, onChunk, onSource, onName);
        }
        let currentLineOffset = 0;
        let currentColumnOffset = 0;
        const sourceMapping = new Map<string | null, number>();
        const nameMapping = new Map<string, number>();
        const finalSource = Boolean(options && options.finalSource);
        let code = "";
        let needToCloseMapping = false;
        const children = (this._children as Source[]);
        const childCount = children.length;
        for (let ci = 0; ci < childCount; ci++) {
            const item = children[ci];
            const sourceIndexMapping: number[] = [];
            const nameIndexMapping: number[] = [];
            let lastMappingLine = 0;
            const { generatedLine, generatedColumn, source } = streamChunks(item, options,
            // eslint-disable-next-line no-loop-func
            (chunk: string | undefined, generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => {
                const line = generatedLine + currentLineOffset;
                const column = generatedLine === 1
                    ? generatedColumn + currentColumnOffset
                    : generatedColumn;
                if (needToCloseMapping) {
                    if (generatedLine !== 1 || generatedColumn !== 0) {
                        onChunk(undefined, currentLineOffset + 1, currentColumnOffset, -1, -1, -1, -1);
                    }
                    needToCloseMapping = false;
                }
                const resultSourceIndex = sourceIndex < 0 || sourceIndex >= sourceIndexMapping.length
                    ? -1
                    : sourceIndexMapping[sourceIndex];
                let _chunk;
                // When using finalSource, we process the entire source code at once at the end, rather than chunk by chunk
                if (finalSource) {
                    if (chunk !== undefined)
                        code += chunk;
                }
                else {
                    _chunk = chunk;
                }
                if (resultSourceIndex < 0) {
                    lastMappingLine = 0;
                    onChunk(_chunk, line, column, -1, -1, -1, -1);
                }
                else {
                    // Only compute the remapped name index when the chunk
                    // actually carries a source mapping; otherwise it is
                    // unused.
                    const resultNameIndex = nameIndex < 0 || nameIndex >= nameIndexMapping.length
                        ? -1
                        : nameIndexMapping[nameIndex];
                    lastMappingLine = generatedLine;
                    onChunk(_chunk, line, column, resultSourceIndex, originalLine, originalColumn, resultNameIndex);
                }
            }, (i: number, source: string | null, sourceContent: string | undefined, scopeBindings: ScopeBindings | undefined) => {
                let globalIndex = sourceMapping.get(source);
                if (globalIndex === undefined) {
                    sourceMapping.set(source, (globalIndex = sourceMapping.size));
                    onSource(globalIndex, source, sourceContent, scopeBindings);
                }
                sourceIndexMapping[i] = globalIndex;
            }, (i: number, name: string) => {
                let globalIndex = nameMapping.get(name);
                if (globalIndex === undefined) {
                    nameMapping.set(name, (globalIndex = nameMapping.size));
                    onName(globalIndex, name);
                }
                nameIndexMapping[i] = globalIndex;
            });
            if (source !== undefined)
                code += source;
            if (needToCloseMapping &&
                (generatedLine !== 1 || generatedColumn !== 0)) {
                onChunk(undefined, currentLineOffset + 1, currentColumnOffset, -1, -1, -1, -1);
                needToCloseMapping = false;
            }
            if ((generatedLine as number) > 1) {
                currentColumnOffset = (generatedColumn as number);
            }
            else {
                currentColumnOffset += (generatedColumn as number);
            }
            needToCloseMapping =
                needToCloseMapping ||
                    (finalSource && lastMappingLine === generatedLine);
            currentLineOffset += (generatedLine as number) - 1;
        }
        return {
            generatedLine: currentLineOffset + 1,
            generatedColumn: currentColumnOffset,
            source: finalSource ? code : undefined,
        };
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
        const children = this._children;
        const { length } = children;
        let v = visited;
        if (v === undefined && length > 0)
            v = new WeakSet();
        if (v !== undefined)
            v.add(this);
        for (let i = 0; i < length; i++) {
            const child = children[i];
            if (typeof child !== "string" && typeof child.clearCache === "function") {
                child.clearCache(options, v);
            }
        }
    }
    updateHash(hash: HashLike): void {
        if (!this._isOptimized)
            this._optimize();
        const children = (this._children as Source[]);
        const childCount = children.length;
        hash.update("ConcatSource");
        for (let ci = 0; ci < childCount; ci++) {
            children[ci].updateHash(hash);
        }
    }
    _optimize() {
        const newChildren = [];
        let currentString;
        let currentRawSources: string | [
            string,
            string
        ] | SourceLike | undefined;
        const addStringToRawSources = (string: string): void => {
            if (currentRawSources === undefined) {
                currentRawSources = string;
            }
            else if (Array.isArray(currentRawSources)) {
                currentRawSources.push(string);
            }
            else {
                currentRawSources = [
                    typeof currentRawSources === "string"
                        ? currentRawSources
                        : (currentRawSources.source() as string),
                    string,
                ];
            }
        };
        const addSourceToRawSources = (source: SourceLike): void => {
            if (currentRawSources === undefined) {
                currentRawSources = source;
            }
            else if (Array.isArray(currentRawSources)) {
                currentRawSources.push((source.source() as string));
            }
            else {
                currentRawSources = [
                    typeof currentRawSources === "string"
                        ? currentRawSources
                        : (currentRawSources.source() as string),
                    (source.source() as string),
                ];
            }
        };
        const mergeRawSources = () => {
            if (Array.isArray(currentRawSources)) {
                const rawSource = new RawSource(currentRawSources.join(""));
                stringsAsRawSources.add(rawSource);
                newChildren.push(rawSource);
            }
            else if (typeof currentRawSources === "string") {
                const rawSource = new RawSource(currentRawSources);
                stringsAsRawSources.add(rawSource);
                newChildren.push(rawSource);
            }
            else {
                newChildren.push(currentRawSources);
            }
        };
        const children = this._children;
        for (let ci = 0, cl = children.length; ci < cl; ci++) {
            const child = children[ci];
            if (typeof child === "string") {
                if (currentString === undefined) {
                    currentString = child;
                }
                else {
                    currentString += child;
                }
            }
            else {
                if (currentString !== undefined) {
                    addStringToRawSources(currentString);
                    currentString = undefined;
                }
                if (stringsAsRawSources.has(child)) {
                    addSourceToRawSources((child as SourceLike));
                }
                else {
                    if (currentRawSources !== undefined) {
                        mergeRawSources();
                        currentRawSources = undefined;
                    }
                    newChildren.push(child);
                }
            }
        }
        if (currentString !== undefined) {
            addStringToRawSources(currentString);
        }
        if (currentRawSources !== undefined) {
            mergeRawSources();
        }
        this._children = newChildren;
        this._isOptimized = true;
    }
}
export = ConcatSource;
declare namespace ConcatSource {
    export { SourceLike, ClearCacheOptions, HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, GeneratedSourceInfo, OnChunk, OnName, OnSource, Options, Child, };
}
type SourceLike = import("./CompatSource").SourceLike;
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
type Child = string | Source | SourceLike;

type ScopeBindings = import("./helpers/streamChunks").ScopeBindings;
