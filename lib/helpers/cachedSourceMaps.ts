/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
import type { CachedSource } from "../CachedSource";

type RawSourceMap = CachedSource.RawSourceMap;
type BufferEntry = CachedSource.BufferEntry;

export function readMap(entry: BufferEntry): RawSourceMap | null {
  if (entry.map !== undefined) return entry.map;
  const buffered = entry.bufferedMap;
  if (buffered === undefined) return null;
  if (buffered === null) return (entry.map = null);
  const map = { ...buffered } as unknown as RawSourceMap;
  if (buffered.mappings) map.mappings = buffered.mappings.toString("utf8");
  if (buffered.sourcesContent) map.sourcesContent = buffered.sourcesContent.map(text => text && text.toString("utf8"));
  return (entry.map = map);
}
