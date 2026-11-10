/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
function getGeneratedSourceInfo(source: string | undefined): GeneratedSourceInfo {
    if (source === undefined) {
        return {};
    }
    const lastLineStart = source.lastIndexOf("\n");
    if (lastLineStart === -1) {
        return {
            generatedLine: 1,
            generatedColumn: source.length,
            source,
        };
    }
    // Use native indexOf to scan for newlines instead of charCodeAt loops.
    // This is significantly faster on large sources since indexOf uses
    // vectorized/native string scanning.
    let generatedLine = 2;
    let idx = source.indexOf("\n");
    while (idx !== -1 && idx < lastLineStart) {
        generatedLine++;
        idx = source.indexOf("\n", idx + 1);
    }
    return {
        generatedLine,
        generatedColumn: source.length - lastLineStart - 1,
        source,
    };
}
export = getGeneratedSourceInfo;
declare namespace getGeneratedSourceInfo {
    export { GeneratedSourceInfo };
}
type GeneratedSourceInfo = {
    /**
     * generated line
     */
    generatedLine?: number | undefined;
    /**
     * generated column
     */
    generatedColumn?: number | undefined;
    /**
     * source
     */
    source?: string | undefined;
};
