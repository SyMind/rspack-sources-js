/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
"use strict";
function getName(sourceMap: RawSourceMap, index: number): string | null | undefined {
    if (index < 0)
        return null;
    const { names } = sourceMap;
    return names[index];
}
export = getName;
declare namespace getName {
    export { RawSourceMap };
}
type RawSourceMap = import("../Source").RawSourceMap;
