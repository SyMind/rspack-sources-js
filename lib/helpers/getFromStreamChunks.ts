/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import { createMappingsWriter } from "./createMappingsSerializer";
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
/**
 * Assign `value` at index `i` of `arr`, padding earlier slots with `null`.
 * Hoisted helper so `getMap` and `getSourceAndMap` share one
 * implementation. Uses `push` rather than `arr.length = i + 1` because the
 * latter forces V8's HOLEY_ELEMENTS kind permanently — push keeps the
 * backing store PACKED, which the downstream source-map serializer iterates
 * over far more efficiently.
 */
const setAtIndex = <T>(arr: (T | null)[], i: number, value: T): void => {
    while (arr.length < i)
        arr.push(null);
    // `arr[i] = value` where `i === arr.length` extends the array exactly
    // like `push` (V8 keeps PACKED_ELEMENTS); after the while-loop
    // `i <= arr.length` always, so the hole case that would force HOLEY is
    // impossible here.
    arr[i] = value;
};
export const getMap = (source: SourceLikeWithStreamChunks, options?: Options | undefined): RawSourceMap | null => {
    const potentialSources: (string | null)[] = [];
    const potentialSourcesContent: (string | null)[] = [];
    const potentialNames: (string | null)[] = [];
    const mappingsWriter = createMappingsWriter(options);
    const addMapping = mappingsWriter.add;
    const scopesWriter = options && options.scopes ? createScopesWriter() : undefined;
    // Chosen once rather than tested per segment: this callback is the whole of
    // the mapping loop, so a branch in it is measurable on every map built.
    const generated = source.streamChunks({ ...options, source: false, finalSource: true }, scopesWriter === undefined
        ? (chunk: string | undefined, generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => {
            addMapping(generatedLine, generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex);
        }
        : (chunk: string | undefined, generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => {
            addMapping(generatedLine, generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex);
            scopesWriter.add(generatedLine, generatedColumn, sourceIndex, originalLine);
        }, (sourceIndex: number, source: string | null, sourceContent: string | undefined, scopeBindings: ScopeBindings | undefined) => {
        setAtIndex(potentialSources, sourceIndex, source);
        if (sourceContent !== undefined) {
            setAtIndex(potentialSourcesContent, sourceIndex, sourceContent);
        }
        if (scopesWriter !== undefined) {
            scopesWriter.addSource(sourceIndex, scopeBindings);
        }
    }, (nameIndex: number, name: string) => {
        setAtIndex(potentialNames, nameIndex, name);
    });
    const mappings = mappingsWriter.finish();
    if (mappings.length === 0)
        return null;
    const map: RawSourceMap = {
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
        scopesWriter.finish(map, generated.generatedLine!, generated.generatedColumn);
    }
    return map;
};
export const getSourceAndMap = (inputSource: SourceLikeWithStreamChunks, options?: Options | undefined): SourceAndMap => {
    let code = "";
    const potentialSources: (string | null)[] = [];
    const potentialSourcesContent: (string | null)[] = [];
    const potentialNames: (string | null)[] = [];
    const mappingsWriter = createMappingsWriter(options);
    const addMapping = mappingsWriter.add;
    const scopesWriter = options && options.scopes ? createScopesWriter() : undefined;
    const generated = inputSource.streamChunks(
    // `source: true` overrides any `source: false` a caller forwarded
    // (e.g. the streamChunks fallback passing getMap options through
    // sourceAndMap) — this helper always consumes the source.
    { ...options, finalSource: true, source: true }, (chunk: string | undefined, generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => {
        if (chunk !== undefined)
            code += chunk;
        addMapping(generatedLine, generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex);
        if (scopesWriter !== undefined) {
            scopesWriter.add(generatedLine, generatedColumn, sourceIndex, originalLine);
        }
    }, (sourceIndex: number, source: string | null, sourceContent: string | undefined, scopeBindings: ScopeBindings | undefined) => {
        if (scopesWriter !== undefined) {
            scopesWriter.addSource(sourceIndex, scopeBindings);
        }
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
    }, (nameIndex: number, name: string) => {
        while (potentialNames.length < nameIndex) {
            potentialNames.push(null);
        }
        potentialNames[nameIndex] = name;
    });
    const mappings = mappingsWriter.finish();
    const { source } = generated;
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
            scopesWriter.finish(map, generated.generatedLine!, generated.generatedColumn);
        }
    }
    return { source: source !== undefined ? source : code, map };
};
export type RawSourceMap = import("../Source").RawSourceMap;
export type SourceAndMap = import("../Source").SourceAndMap;
export type Options = import("./streamChunks").Options;
export type StreamChunksFunction = import("./streamChunks").StreamChunksFunction;
export type SourceLikeWithStreamChunks = {
    streamChunks: StreamChunksFunction;
};

type ScopeBindings = import("./streamChunks").ScopeBindings;
