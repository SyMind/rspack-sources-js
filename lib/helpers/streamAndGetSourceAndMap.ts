/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import { createMappingsWriter } from "./createMappingsSerializer";
import streamChunks = require("./streamChunks");
let scopesHelpers: typeof import("./scopes") | undefined;
/**
 * Loads the scopes helpers on first use. They are only reachable through the
 * `scopes` option, so requiring them eagerly would put the encoder in the
 * module graph of every caller that never asks for the field.
 */
const createScopesWriter = (): {
    add: (generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number) => void;
    addSource: (sourceIndex: number, scopeBindings?: ScopeBindings | undefined) => void;
    finish: (map: RawSourceMap, generatedLine: number, generatedColumn?: number | undefined) => void;
} => {
    if (scopesHelpers === undefined)
        scopesHelpers = require("./scopes") as typeof import("./scopes");
    return scopesHelpers.createScopesWriter();
};
function streamAndGetSourceAndMap(inputSource: SourceMaybeWithStreamChunksFunction, options: Options, onChunk: OnChunk, onSource: OnSource, onName: OnName): {
    result: GeneratedSourceInfo;
    source: string;
    map: RawSourceMap | null;
} {
    let code = "";
    const potentialSources: (string | null)[] = [];
    const potentialSourcesContent: (string | null)[] = [];
    const potentialNames: (string | null)[] = [];
    const mappingsWriter = createMappingsWriter({ ...options, columns: true });
    const addMapping = mappingsWriter.add;
    const scopesWriter = options && options.scopes ? createScopesWriter() : undefined;
    const finalSource = Boolean(options && options.finalSource);
    // The caller may have passed `source: false` (getMap does), but this
    // helper caches the source text, so the inner stream must produce it.
    const innerOptions = options && options.source === false
        ? { ...options, source: true }
        : options;
    const { generatedLine, generatedColumn, source } = streamChunks(inputSource, innerOptions, (chunk: string | undefined, generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => {
        if (chunk !== undefined)
            code += chunk;
        addMapping(generatedLine, generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex);
        if (scopesWriter !== undefined) {
            scopesWriter.add(generatedLine, generatedColumn, sourceIndex, originalLine);
        }
        return onChunk(finalSource ? undefined : chunk, generatedLine, generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex);
    }, (sourceIndex: number, source: string | null, sourceContent: string | undefined, scopeBindings: ScopeBindings | undefined) => {
        while (potentialSources.length < sourceIndex) {
            potentialSources.push(null);
        }
        potentialSources[sourceIndex] = source;
        if (sourceContent !== undefined) {
            while (potentialSourcesContent.length < sourceIndex) {
                potentialSourcesContent.push(null);
            }
            potentialSourcesContent[sourceIndex] = sourceContent;
        }
        if (scopesWriter !== undefined) {
            scopesWriter.addSource(sourceIndex, scopeBindings);
        }
        return onSource(sourceIndex, source, sourceContent, scopeBindings);
    }, (nameIndex: number, name: string) => {
        while (potentialNames.length < nameIndex) {
            potentialNames.push(null);
        }
        potentialNames[nameIndex] = name;
        return onName(nameIndex, name);
    });
    const resultSource = source !== undefined ? source : code;
    const mappings = mappingsWriter.finish();
    let map: RawSourceMap | null = null;
    if (mappings.length > 0) {
        map = {
            version: 3,
            file: "x",
            mappings,
            // We handle broken sources as `null`, in spec this field should be string, but no information what we should do in such cases if we change type it will be breaking change
            sources: (potentialSources as string[]),
            sourcesContent: potentialSourcesContent.length > 0
                ? (potentialSourcesContent as string[])
                : undefined,
            names: (potentialNames as string[]),
        };
        if (scopesWriter !== undefined) {
            scopesWriter.finish(map, generatedLine || 0, generatedColumn || 0);
        }
    }
    return {
        result: {
            generatedLine,
            generatedColumn,
            source: finalSource ? resultSource : undefined,
        },
        source: resultSource,
        map,
    };
}
export = streamAndGetSourceAndMap;
declare namespace streamAndGetSourceAndMap {
    export { RawSourceMap, GeneratedSourceInfo, OnChunk, OnName, OnSource, Options, SourceMaybeWithStreamChunksFunction, };
}
type RawSourceMap = import("../Source").RawSourceMap;
type GeneratedSourceInfo = import("./streamChunks").GeneratedSourceInfo;
type OnChunk = import("./streamChunks").OnChunk;
type OnName = import("./streamChunks").OnName;
type OnSource = import("./streamChunks").OnSource;
type Options = import("./streamChunks").Options;
type SourceMaybeWithStreamChunksFunction = import("./streamChunks").SourceMaybeWithStreamChunksFunction;

type ScopeBindings = import("./streamChunks").ScopeBindings;
