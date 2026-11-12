/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
function getSource(sourceMap: RawSourceMap, index: number): string | null {
  if (index < 0)
    return null;
  const { sourceRoot, sources } = sourceMap;
  const source = sources[index];
  if (!sourceRoot)
    return source;
  if (sourceRoot.endsWith("/"))
    return sourceRoot + source;
  return `${sourceRoot}/${source}`;
}
export = getSource;
declare namespace getSource {
  export { RawSourceMap };
}
type RawSourceMap = import("../Source").RawSourceMap;
