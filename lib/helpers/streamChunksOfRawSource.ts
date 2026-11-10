/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
import getGeneratedSourceInfo = require("./getGeneratedSourceInfo");
/**
 *
 * Single-pass equivalent of `splitIntoLines(source).forEach(emit)` — emits
 * each line via onChunk while scanning for newlines, so we never allocate
 * the intermediate array of lines.
 */
const streamRawChunks = (source: string, onChunk: OnChunk, _onSource: OnSource, _onName: OnName): GeneratedSourceInfo => {
    const len = source.length;
    if (len === 0) {
        return { generatedLine: 1, generatedColumn: 0 };
    }
    let line = 1;
    let i = 0;
    while (i < len) {
        const n = source.indexOf("\n", i);
        if (n === -1) {
            // Trailing partial line (no \n). Emit and return its length as the
            // final column.
            const lastLine = i === 0 ? source : source.slice(i);
            onChunk(lastLine, line, 0, -1, -1, -1, -1);
            return { generatedLine: line, generatedColumn: lastLine.length };
        }
        const chunk = n === i ? "\n" : source.slice(i, n + 1);
        onChunk(chunk, line, 0, -1, -1, -1, -1);
        line++;
        i = n + 1;
    }
    // Source ended with a newline — the next "logical" line is empty.
    return { generatedLine: line, generatedColumn: 0 };
};
function streamChunksOfRawSource(source: string, onChunk: OnChunk, onSource: OnSource, onName: OnName, finalSource: boolean): GeneratedSourceInfo {
    return finalSource
        ? getGeneratedSourceInfo(source)
        : streamRawChunks(source, onChunk, onSource, onName);
}
export = streamChunksOfRawSource;
declare namespace streamChunksOfRawSource {
    export { GeneratedSourceInfo, OnChunk, OnName, OnSource };
}
type GeneratedSourceInfo = import("./getGeneratedSourceInfo").GeneratedSourceInfo;
type OnChunk = import("./streamChunks").OnChunk;
type OnName = import("./streamChunks").OnName;
type OnSource = import("./streamChunks").OnSource;
