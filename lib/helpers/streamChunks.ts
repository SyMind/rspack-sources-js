/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import streamChunksOfRawSource = require("./streamChunksOfRawSource");
import streamChunksOfSourceMap = require("./streamChunksOfSourceMap");
function streamChunks(source: SourceMaybeWithStreamChunksFunction, options: Options, onChunk: OnChunk, onSource: OnSource, onName: OnName): GeneratedSourceInfo {
    if (typeof source.streamChunks === "function") {
        return source.streamChunks(options, onChunk, onSource, onName);
    }
    const sourceAndMap = source.sourceAndMap(options);
    if (sourceAndMap.map) {
        return streamChunksOfSourceMap((sourceAndMap.source as string), sourceAndMap.map, onChunk, onSource, onName, Boolean(options && options.finalSource), Boolean(options && options.columns !== false));
    }
    return streamChunksOfRawSource((sourceAndMap.source as string), onChunk, onSource, onName, Boolean(options && options.finalSource));
}
export = streamChunks;
declare namespace streamChunks {
    export { Source, GeneratedSourceInfo, OnChunk, ScopeBindings, OnSource, OnName, Options, StreamChunksFunction, SourceMaybeWithStreamChunksFunction, };
}
type Source = import("../Source");
type GeneratedSourceInfo = import("./getGeneratedSourceInfo").GeneratedSourceInfo;
type OnChunk = (chunk: string | undefined, generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => void;
type ScopeBindings = Map<string, string>;
type OnSource = (sourceIndex: number, source: string | null, sourceContent: string | undefined, scopeBindings?: ScopeBindings) => void;
type OnName = (nameIndex: number, name: string) => void;
type Options = {
    source?: boolean;
    finalSource?: boolean;
    columns?: boolean;
    scopes?: boolean;
};
type StreamChunksFunction = (options: Options, onChunk: OnChunk, onSource: OnSource, onName: OnName) => GeneratedSourceInfo;
type SourceMaybeWithStreamChunksFunction = Source & {
    streamChunks?: StreamChunksFunction;
};
