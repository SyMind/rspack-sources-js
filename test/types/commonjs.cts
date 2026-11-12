import sources = require('rspack-sources-js');
const original: sources.Source = new sources.OriginalSource('const x = 1;', 'input.js');
const replaced = new sources.ReplaceSource(original);
replaced.replace(6, 6, 'y');
const concat = new sources.ConcatSource('/* prefix */', replaced);
const custom = { source: () => 'custom' };
concat.add(new sources.CompatSource(custom));
// @ts-expect-error ConcatSource requires a bound Source for object children.
concat.add(custom);
const cached = new sources.CachedSource(concat);
const fromFactory: sources.Source = new sources.CachedSource(() => original).original();
// @ts-expect-error A JS CachedSource factory must return its Source synchronously.
new sources.CachedSource(async () => original);
const result: sources.SourceAndMap = cached.sourceAndMap({ columns: true });
const map: sources.RawSourceMap | null = result.map;
const chunks: Buffer[] = cached.buffers();
// @ts-expect-error The public Source API does not expose streaming callbacks.
concat.streamChunks;
const replacement: sources.Replacement = new sources.ReplaceSource.Replacement(0, 0, 'x');
// @ts-expect-error replacement content must be a string
replaced.replace(0, 0, 42);
void [fromFactory, map, chunks, replacement];
