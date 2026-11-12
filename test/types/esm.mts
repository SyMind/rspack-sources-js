import sources, { OriginalSource, ConcatSource, type CachedData, type SourceAndMap } from 'rspack-sources-js';
const original = new OriginalSource('x', 'x.js');
const result: SourceAndMap = new ConcatSource(original, ';').sourceAndMap();
const cached = new sources.CachedSource(original);
const data: CachedData = { buffer: cached.buffer(), maps: new Map() };
const restored = new sources.CachedSource(() => original, data);
void [result, restored];
