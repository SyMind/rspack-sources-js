/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Alexander Akait @alexander-akait
*/
"use strict";
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Int8Array(128).fill(-1);
for (let index = 0; index < BASE64_CHARS.length; index++) {
    BASE64_VALUES[BASE64_CHARS.charCodeAt(index)] = index;
}
const VLQ_BASE_SHIFT = 5;
const VLQ_BASE_MASK = (1 << VLQ_BASE_SHIFT) - 1;
const VLQ_CONTINUATION_BIT = 1 << VLQ_BASE_SHIFT;
// Item tags of the "Scopes" proposal, base64 digits of their numeric values.
const TAG_EMPTY = "A";
const TAG_ORIGINAL_SCOPE_START = "B";
const TAG_ORIGINAL_SCOPE_END = "C";
const TAG_ORIGINAL_SCOPE_VARIABLES = "D";
const TAG_GENERATED_RANGE_START = "E";
const TAG_GENERATED_RANGE_END = "F";
const TAG_GENERATED_RANGE_BINDINGS = "G";
const ORIGINAL_SCOPE_FLAG_HAS_KIND = 0x2;
const GENERATED_RANGE_FLAG_HAS_LINE = 0x1;
const GENERATED_RANGE_FLAG_HAS_DEFINITION = 0x2;
/**
 * Every scope webpack emits describes one module, which the proposal's
 * JavaScript vocabulary calls a module scope.
 */
const MODULE_SCOPE_KIND = "Module";
const encodeUnsigned = (value: number): string => {
    let result = "";
    let rest = value;
    for (;;) {
        const digit = rest & VLQ_BASE_MASK;
        rest >>>= VLQ_BASE_SHIFT;
        if (rest === 0)
            return result + BASE64_CHARS[digit];
        result += BASE64_CHARS[VLQ_CONTINUATION_BIT + digit];
    }
};
const encodeSigned = (value: number): string => encodeUnsigned(value >= 0 ? 2 * value : 1 - 2 * value);
/**
 * Walks the map's segments in generated order, reporting each one's source and
 * original line. A segment with no source position reports `sourceIndex` -1,
 * which ends whatever run precedes it.
 */
const forEachMapping = (mappings: string, onSegment: (generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number) => void): number => {
    let generatedLine = 0;
    let generatedColumn = 0;
    let sourceIndex = 0;
    let originalLine = 0;
    let position = 0;
    const { length } = mappings;
    const fields: number[] = [];
    while (position < length) {
        const char = mappings.charCodeAt(position);
        if (char === 59 /* ; */) {
            generatedLine++;
            generatedColumn = 0;
            position++;
            continue;
        }
        if (char === 44 /* , */) {
            position++;
            continue;
        }
        fields.length = 0;
        while (position < length) {
            const next = mappings.charCodeAt(position);
            if (next === 59 || next === 44)
                break;
            let value = 0;
            let shift = 0;
            let digit;
            do {
                digit = BASE64_VALUES[mappings.charCodeAt(position++)];
                // A digit outside the alphabet cannot be recovered from, and
                // pretending otherwise would misplace every later segment.
                if (digit < 0)
                    return generatedLine;
                value += (digit & VLQ_BASE_MASK) << shift;
                shift += VLQ_BASE_SHIFT;
            } while (digit & VLQ_CONTINUATION_BIT);
            fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
        }
        if (fields.length === 0)
            continue;
        generatedColumn += fields[0];
        if (fields.length >= 4) {
            sourceIndex += fields[1];
            originalLine += fields[2];
            onSegment(generatedLine, generatedColumn, sourceIndex, originalLine);
        }
        else {
            onSegment(generatedLine, generatedColumn, -1, -1);
        }
    }
    return generatedLine;
};
/**
 * Collects, segment by segment, the generated runs each source explains and how
 * far into it the map reaches. Both lines are counted from zero, so a caller
 * whose lines start at one subtracts before feeding a segment in.
 */
const createScopeCollector = (sourceCount?: number | undefined): {
    add: (generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number) => void;
    finish: (lastLine: number, lastColumn?: number | undefined) => SourceScope[];
} => {
    const scopes: Map<number, SourceScope> = new Map();
    let openSource = -1;
    let openScope: SourceScope | undefined;
    const closeRun = (line: number, column: number): void => {
        if (openScope === undefined)
            return;
        openScope.rangeEnds.push({ line, column });
        openScope = undefined;
        openSource = -1;
    };
    return {
        add(generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number) {
            // A segment naming no source reports -1, which is also what no open
            // run reports, so the run has to be there before it is extended.
            if (openScope !== undefined && sourceIndex === openSource) {
                openScope.originalEnd.line = Math.max(openScope.originalEnd.line, originalLine + 1);
                return;
            }
            closeRun(generatedLine, generatedColumn);
            if (sourceIndex < 0 ||
                (sourceCount !== undefined && sourceIndex >= sourceCount)) {
                return;
            }
            let scope = scopes.get(sourceIndex);
            if (scope === undefined) {
                scope = {
                    sourceIndex,
                    variables: [],
                    values: [],
                    originalEnd: { line: originalLine + 1, column: 0 },
                    rangeStarts: [],
                    rangeEnds: [],
                };
                scopes.set(sourceIndex, scope);
            }
            else {
                scope.originalEnd.line = Math.max(scope.originalEnd.line, originalLine + 1);
            }
            scope.rangeStarts.push({ line: generatedLine, column: generatedColumn });
            openScope = scope;
            openSource = sourceIndex;
        },
        finish(lastLine: number, lastColumn: number | undefined = 0) {
            closeRun(lastLine, lastColumn);
            return [...scopes.values()].sort((a: SourceScope, b: SourceScope) => a.sourceIndex - b.sourceIndex);
        },
    };
};
/**
 * Groups a finished map's segments into one entry per source. Prefer the
 * collector when the segments are still being written, which saves decoding
 * back what was just encoded.
 */
const collectSourceScopes = (mappings: string, sourceCount: number): SourceScope[] => {
    const collector = createScopeCollector(sourceCount);
    const lastLine = forEachMapping(mappings, collector.add);
    return collector.finish(lastLine + 1);
};
/**
 * Encodes the scope tree into the `scopes` field of the proposal, appending any
 * name it needs to the map's `names`.
 */
const encodeScopes = (scopes: SourceScope[], sourceCount: number, names: string[]): string => {
    const nameToIndex: Map<string, number> = new Map();
    for (let index = 0; index < names.length; index++) {
        if (!nameToIndex.has(names[index]))
            nameToIndex.set(names[index], index);
    }
    const nameIndex = (name: string): number => {
        const existing = nameToIndex.get(name);
        if (existing !== undefined)
            return existing;
        const added = names.length;
        names.push(name);
        nameToIndex.set(name, added);
        return added;
    };
    const scopeBySource: Map<number, SourceScope> = new Map();
    for (const scope of scopes)
        scopeBySource.set(scope.sourceIndex, scope);
    const items: string[] = [];
    // The three running indices the proposal encodes names and definitions
    // against. Only the position pair restarts per source.
    let lastKind = 0;
    let lastVariable = 0;
    let lastDefinition = 0;
    let scopeCount = 0;
    const scopeIndexBySource: Map<number, number> = new Map();
    for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex++) {
        const scope = scopeBySource.get(sourceIndex);
        if (scope === undefined || scope.variables.length === 0) {
            items.push(TAG_EMPTY);
            continue;
        }
        const kind = nameIndex(MODULE_SCOPE_KIND);
        items.push(TAG_ORIGINAL_SCOPE_START +
            encodeUnsigned(ORIGINAL_SCOPE_FLAG_HAS_KIND) +
            encodeUnsigned(0) +
            encodeUnsigned(0) +
            encodeSigned(kind - lastKind));
        lastKind = kind;
        let variables = TAG_ORIGINAL_SCOPE_VARIABLES;
        for (const variable of scope.variables) {
            const index = nameIndex(variable);
            variables += encodeSigned(index - lastVariable);
            lastVariable = index;
        }
        items.push(variables);
        items.push(TAG_ORIGINAL_SCOPE_END +
            encodeUnsigned(scope.originalEnd.line) +
            encodeUnsigned(scope.originalEnd.column));
        scopeIndexBySource.set(sourceIndex, scopeCount++);
    }
    const ranges: {
        start: ScopePosition;
        end: ScopePosition;
        scope: SourceScope;
    }[] = [];
    for (const scope of scopes) {
        if (!scopeIndexBySource.has(scope.sourceIndex))
            continue;
        for (let index = 0; index < scope.rangeStarts.length; index++) {
            ranges.push({
                start: scope.rangeStarts[index],
                end: scope.rangeEnds[index],
                scope,
            });
        }
    }
    ranges.sort((a: {
        start: ScopePosition;
        end: ScopePosition;
        scope: SourceScope;
    }, b: {
        start: ScopePosition;
        end: ScopePosition;
        scope: SourceScope;
    }) => a.start.line - b.start.line || a.start.column - b.start.column);
    let lastLine = 0;
    let lastColumn = 0;
    /**
     * Encodes a position against the running one, reporting whether it needed a
     * line of its own. A line is only carried when it moved forward, and then
     * the column is absolute rather than relative.
     */
    const encodePosition = (position: ScopePosition): [
        boolean,
        string
    ] => {
        const line = position.line - lastLine;
        const carriesLine = line > 0;
        const column = carriesLine ? position.column : position.column - lastColumn;
        lastLine = position.line;
        lastColumn = position.column;
        return [
            carriesLine,
            (carriesLine ? encodeUnsigned(line) : "") + encodeUnsigned(column),
        ];
    };
    for (const { start, end, scope } of ranges) {
        const definition = (scopeIndexBySource.get(scope.sourceIndex) as number);
        const [startCarriesLine, startDigits] = encodePosition(start);
        items.push(TAG_GENERATED_RANGE_START +
            encodeUnsigned(GENERATED_RANGE_FLAG_HAS_DEFINITION |
                (startCarriesLine ? GENERATED_RANGE_FLAG_HAS_LINE : 0)) +
            startDigits +
            encodeSigned(definition - lastDefinition));
        lastDefinition = definition;
        let bindings = TAG_GENERATED_RANGE_BINDINGS;
        for (const value of scope.values) {
            bindings += encodeUnsigned(value === "" ? 0 : nameIndex(value) + 1);
        }
        items.push(bindings);
        // An end item carries no flags: one digit is a column, two a line and a
        // column, which is what tells the reader whether the line moved.
        items.push(TAG_GENERATED_RANGE_END + encodePosition(end)[1]);
    }
    return items.join(",");
};
/**
 * Adds the `scopes` field of the "Scopes" proposal to a source map, naming for
 * each source the bindings a debugger cannot resolve on its own and the
 * generated expression each one evaluates to. Does nothing when no source
 * contributes a binding.
 */
const addScopesToSourceMap = (sourceMap: RawSourceMap, getBindings: (sourceIndex: number) => Map<string, string> | undefined): void => {
    if (!sourceMap.mappings || !sourceMap.sources)
        return;
    const sourceCount = sourceMap.sources.length;
    const scopes = collectSourceScopes(sourceMap.mappings, sourceCount);
    let any = false;
    for (const scope of scopes) {
        const bindings = getBindings(scope.sourceIndex);
        if (bindings === undefined || bindings.size === 0)
            continue;
        for (const [name, value] of bindings) {
            scope.variables.push(name);
            scope.values.push(value);
        }
        any = true;
    }
    if (!any)
        return;
    const names = sourceMap.names || (sourceMap.names = []);
    sourceMap.scopes = encodeScopes(scopes, sourceCount, names);
};
/**
 * Builds the `scopes` field while a map is being written, so the segments are
 * read as they are produced rather than decoded back out of `mappings`. Lines
 * are the one-based ones the chunk stream reports; `finish` takes the position
 * the generated code ends at, where the last range closes.
 */
const createScopesWriter = (): {
    add: (generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number) => void;
    addSource: (sourceIndex: number, scopeBindings?: ScopeBindings | undefined) => void;
    finish: (map: RawSourceMap, generatedLine: number, generatedColumn?: number | undefined) => void;
} => {
    const collector = createScopeCollector();
    const bindingsBySource: Map<number, ScopeBindings> = new Map();
    return {
        add(generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number) {
            collector.add(generatedLine - 1, generatedColumn, sourceIndex, originalLine - 1);
        },
        addSource(sourceIndex: number, scopeBindings: ScopeBindings | undefined) {
            if (scopeBindings !== undefined && scopeBindings.size > 0) {
                bindingsBySource.set(sourceIndex, scopeBindings);
            }
        },
        finish(map: RawSourceMap, generatedLine: number, generatedColumn: number | undefined = 0) {
            if (bindingsBySource.size === 0)
                return;
            const scopes = collector.finish(generatedLine - 1, generatedColumn);
            let any = false;
            for (const scope of scopes) {
                const bindings = bindingsBySource.get(scope.sourceIndex);
                if (bindings === undefined)
                    continue;
                for (const [name, value] of bindings) {
                    scope.variables.push(name);
                    scope.values.push(value);
                }
                any = true;
            }
            if (!any)
                return;
            const names = map.names || (map.names = []);
            map.scopes = encodeScopes(scopes, map.sources.length, names);
        },
    };
};
export { addScopesToSourceMap };
export { collectSourceScopes };
export { createScopeCollector };
export { createScopesWriter };
export { encodeScopes };
export type RawSourceMap = import("../Source").RawSourceMap;
export type ScopeBindings = import("./streamChunks").ScopeBindings;
export type ScopePosition = {
    /**
     * line
     */
    line: number;
    /**
     * column
     */
    column: number;
};
export type SourceScope = {
    /**
     * index into the map's `sources`
     */
    sourceIndex: number;
    /**
     * the names the source declares
     */
    variables: string[];
    /**
     * the generated expression each name evaluates to
     */
    values: string[];
    /**
     * end of the original scope, exclusive
     */
    originalEnd: ScopePosition;
    /**
     * start of each generated range, inclusive
     */
    rangeStarts: ScopePosition[];
    /**
     * end of each generated range, exclusive
     */
    rangeEnds: ScopePosition[];
};
