import sources, { OriginalSource, ConcatSource, type SourceAndMap } from 'rspack-sources-js';
const original = new OriginalSource('x', 'x.js');
const result: SourceAndMap = new ConcatSource(original, ';').sourceAndMap();
const cached = new sources.CachedSource(original);
void [result, cached];
