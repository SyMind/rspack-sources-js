/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
// Character classification via a lookup table.  A single bitmask test
// replaces the multi-comparison chains in each inner loop phase.
//
// BIT layout per character:
//   bit 0 (STOP1 = 1): stops phase-1 scan  (\n ; { })
//   bit 1 (CONT2 = 2): continues phase-2 scan  (; { } space \r \t)
//
// Phase 1: scan regular source chars that are NOT a phase-1 stop.
// Phase 2: consume runs of statement-boundary / whitespace chars.
// Phase 3: consume a trailing \n if present.
const STOP1 = 1;
const CONT2 = 2;
const CF: Uint8Array<ArrayBufferLike> = new Uint8Array(128);
CF[10] = STOP1; // \n  – stops phase 1, NOT consumed in phase 2
CF[59] = STOP1 | CONT2; // ;
CF[123] = STOP1 | CONT2; // {
CF[125] = STOP1 | CONT2; // }
CF[32] = CONT2; // space
CF[13] = CONT2; // \r
CF[9] = CONT2; // \t
/**
 * Streaming core: report each potential token by its `[start, end)` bounds
 * instead of materialising substrings. The single real consumer
 * (`OriginalSource.streamChunks`) slices on demand — and skips slicing
 * entirely when emitting the final source (the `map()` / `sourceAndMap()`
 * paths, which discard the chunk text) — so this avoids both the
 * intermediate results array and every per-token `String.slice` allocation
 * in the dominant case.
 */
const eachPotentialTokenImpl = (str: string, onToken: OnPotentialToken): void => {
    const len = str.length;
    let i = 0;
    outer: while (i < len) {
        const start = i;
        // Phase 1 – skip regular (non-stop) characters
        let cc = str.charCodeAt(i);
        while (cc > 127 || !(CF[cc] & STOP1)) {
            if (++i >= len) {
                onToken(start, i, false);
                break outer;
            }
            cc = str.charCodeAt(i);
        }
        // Phase 2 – consume delimiter / whitespace run (; { } space \r \t)
        while (cc < 128 && CF[cc] & CONT2) {
            if (++i >= len) {
                onToken(start, i, false);
                break outer;
            }
            cc = str.charCodeAt(i);
        }
        // Phase 3 – consume trailing newline
        if (cc === 10) {
            i++;
            onToken(start, i, true);
        }
        else {
            onToken(start, i, false);
        }
    }
};
function splitIntoPotentialTokens(str: string): string[] | null {
    const len = str.length;
    if (len === 0)
        return null;
    const results = [];
    let i = 0;
    outer: while (i < len) {
        const start = i;
        // Phase 1 – skip regular (non-stop) characters
        let cc = str.charCodeAt(i);
        while (cc > 127 || !(CF[cc] & STOP1)) {
            if (++i >= len) {
                results.push(str.slice(start, i));
                break outer;
            }
            cc = str.charCodeAt(i);
        }
        // Phase 2 – consume delimiter / whitespace run (; { } space \r \t)
        while (cc < 128 && CF[cc] & CONT2) {
            if (++i >= len) {
                results.push(str.slice(start, i));
                break outer;
            }
            cc = str.charCodeAt(i);
        }
        // Phase 3 – consume trailing newline
        if (cc === 10) {
            i++;
        }
        results.push(str.slice(start, i));
    }
    return results;
}
export = splitIntoPotentialTokens;
namespace splitIntoPotentialTokens {
    export const eachPotentialToken = eachPotentialTokenImpl;
}
declare namespace splitIntoPotentialTokens {
    export { OnPotentialToken };
}
type OnPotentialToken = (start: number, end: number, newline: boolean) => void;
