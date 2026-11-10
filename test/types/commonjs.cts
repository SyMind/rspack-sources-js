import sources = require('rspack-sources-js');
const original: sources.Source = new sources.OriginalSource('const x = 1;', 'input.js');
const replaced = new sources.ReplaceSource(original);
replaced.replace(6, 6, 'y');
const concat = new sources.ConcatSource('/* prefix */', replaced);
const cached = new sources.CachedSource(concat);
const result: sources.SourceAndMap = cached.sourceAndMap({ columns: true });
const map: sources.RawSourceMap | null = result.map;
const chunks: Buffer[] = cached.buffers();
concat.streamChunks({}, () => {}, () => {}, () => {});
cached.clearCache({ maps: true });
const replacement: sources.Replacement = new sources.ReplaceSource.Replacement(0, 0, 'x');
const onChunk: sources.OnChunk = (chunk, generatedLine, generatedColumn) => {
  const value: string | undefined = chunk;
  const position: number = generatedLine + generatedColumn;
  void [value, position];
};
const info: sources.GeneratedSourceInfo = concat.streamChunks({}, onChunk, () => {}, () => {});
// @ts-expect-error replacement content must be a string
replaced.replace(0, 0, 42);
// @ts-expect-error streaming may omit the emitted chunk
const invalidChunk: sources.OnChunk = (chunk: string) => {};
void [map, chunks, replacement, info, invalidChunk];
