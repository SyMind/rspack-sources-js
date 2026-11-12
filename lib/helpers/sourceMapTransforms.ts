import type { MapOptions, RawSourceMap, Source, SourceAndMap } from "../Source";
import type { Replacement } from "../ReplaceSource";
import { RawSource } from "../RawSource";
import binding = require("../binding");
import { createMappingsWriter } from "./createMappingsSerializer";
import getSource = require("./getSource");
import readMappings = require("./readMappings");
import splitIntoLines = require("./splitIntoLines");

// The compatibility path works on completed source/map pairs, in JS UTF-16 coordinates.
function readChild(child: Source, options?: MapOptions): SourceAndMap {
  if (child instanceof RawSource) return { source: binding.rawText(child), map: null };
  return child.sourceAndMap(options);
}

type Segment = {
  column: number;
  source: number;
  line: number;
  originalColumn: number;
  name: number;
};

function decodedLines(text: string[], map: RawSourceMap, columns: boolean) {
  const lines = text.map(() => [] as Segment[]);
  readMappings(map.mappings, (line, column, source, originalLine, originalColumn, name) => {
    const entries = lines[line - 1];
    if (!entries) return;
    if (!columns) {
      if (source < 0 || entries.length) return;
      column = 0;
      name = -1;
    } else if (column >= text[line - 1].length) return;
    entries.push({ column, source, line: originalLine, originalColumn, name });
  });
  return lines;
}

class MapBuilder {
  readonly sources: string[] = [];
  readonly contents: (string | null)[] = [];
  readonly names: string[] = [];
  private readonly sourceIndices = new Map<string | null, number>();
  private readonly nameIndices = new Map<string, number>();
  readonly writer;

  constructor(options?: MapOptions) {
    this.writer = createMappingsWriter(options);
  }

  addSource(map: RawSourceMap, index: number, content = map.sourcesContent?.[index]) {
    const source = getSource(map, index);
    const known = this.sourceIndices.get(source);
    if (known !== undefined) return known;
    index = this.sources.length;
    this.sources.push(source as string);
    this.sourceIndices.set(source, index);
    if (content) {
      while (this.contents.length < index) this.contents.push(null);
      this.contents.push(content);
    }
    return index;
  }

  addName(name: string) {
    const known = this.nameIndices.get(name);
    if (known !== undefined) return known;
    const index = this.names.length;
    this.names.push(name);
    this.nameIndices.set(name, index);
    return index;
  }

  finish(): RawSourceMap | null {
    const mappings = this.writer.finish();
    return mappings ? {
      version: 3, file: "x", mappings, sources: this.sources,
      sourcesContent: this.contents.length ? this.contents as string[] : undefined, names: this.names,
    } : null;
  }
}

export function concatSourceAndMap(children: Source[], options?: MapOptions): SourceAndMap {
  const builder = new MapBuilder(options);
  const columns = options?.columns !== false;
  const parts = [];
  let line = 1;
  let column = 0;
  let closeMapping = false;
  for (const child of children) {
    const { source, map } = readChild(child, options);
    const text = source.toString();
    parts.push(text);
    if (!text) continue;
    const lines = splitIntoLines(text);
    const segments = map && decodedLines(lines, map, columns);
    const sources = map?.sources.map((_, i) => builder.addSource(map, i)) ?? [];
    const names = columns ? map?.names?.map(name => builder.addName(name)) ?? [] : [];
    if (closeMapping && segments?.[0]?.[0]?.column !== 0) {
      builder.writer.add(line, column, -1, -1, -1, -1);
    }
    closeMapping = false;
    for (let i = 0; i < lines.length; i++) {
      for (const seg of segments?.[i] ?? []) {
        const sourceIndex = sources[seg.source] ?? -1;
        builder.writer.add(line, column + seg.column, sourceIndex, seg.line, seg.originalColumn, names[seg.name] ?? -1);
        closeMapping = sourceIndex >= 0;
      }
      if (lines[i].endsWith("\n")) {
        line++;
        column = 0;
        closeMapping = false;
      } else column += lines[i].length;
    }
  }
  return { source: parts.join(""), map: builder.finish() };
}

export function prefixSourceAndMap(child: Source, prefix: string, options?: MapOptions) {
  const { source, map } = readChild(child, options);
  const text = source.toString();
  const columns = options?.columns !== false;
  if (!map || !text) return { text, map: null };
  const builder = new MapBuilder(options);
  const sources = map.sources.map((_, i) => builder.addSource(map, i));
  const names = columns ? map.names?.map(name => builder.addName(name)) ?? [] : [];
  const lines = decodedLines(splitIntoLines(text), map, columns);
  for (const [index, segments] of lines.entries()) {
    for (const seg of segments) {
      builder.writer.add(index + 1, columns ? prefix.length + seg.column : 0,
        sources[seg.source] ?? -1, seg.line, seg.originalColumn, names[seg.name] ?? -1);
    }
  }
  return { text, map: builder.finish() };
}

export function replacementMap(child: Source, edits: Replacement[], options?: MapOptions) {
  const { source, map } = readChild(child, options);
  if (!map) return null;
  const text = splitIntoLines(source.toString());
  const columns = options?.columns !== false;
  const lines = decodedLines(text, map, columns);
  const builder = new MapBuilder(options);
  const sources = map.sources.map((_, i) => builder.addSource(map, i));
  const names = columns ? map.names?.map(name => builder.addName(name)) ?? [] : [];
  const originals = map.sourcesContent?.map(content => content && splitIntoLines(content));
  let outputLine = 1;
  let outputColumn = 0;
  let nextEdit = 0;
  let skippedUntil = 0;
  let lineStart = 0;

  const write = (value: string, seg: Segment, originalColumn: number, name: number) => {
    for (const line of splitIntoLines(value)) {
      builder.writer.add(outputLine, outputColumn, sources[seg.source] ?? -1, seg.line, originalColumn, name);
      name = -1;
      if (line.endsWith("\n")) {
        outputLine++;
        outputColumn = 0;
      } else outputColumn += line.length;
    }
  };
  const unmapped: Segment = { column: 0, source: -1, line: -1, originalColumn: -1, name: -1 };
  for (const [index, segments] of lines.entries()) {
    const line = text[index];
    if (segments[0]?.column !== 0) segments.unshift(unmapped);
    for (const [j, seg] of segments.entries()) {
      const end = segments[j + 1]?.column ?? line.length;
      let pos = seg.column;
      let originalColumn = seg.originalColumn;
      const original = originals?.[seg.source]?.[seg.line - 1];
      const advance = (until: number, emit: boolean) => {
        if (until <= pos) return;
        const part = line.slice(pos, until);
        if (emit) write(part, seg, originalColumn, names[seg.name] ?? -1);
        if (original?.startsWith(part, originalColumn)) originalColumn += part.length;
        pos = until;
      };
      advance(Math.min(skippedUntil - lineStart, end), false);
      while (pos < end && nextEdit < edits.length && Math.floor(edits[nextEdit].start) < lineStart + end) {
        const edit = edits[nextEdit++];
        advance(Math.floor(edit.start) - lineStart, true);
        const name = seg.source >= 0 && edit.name ? builder.addName(edit.name) : names[seg.name] ?? -1;
        write(edit.content, seg, originalColumn, name);
        skippedUntil = Math.max(skippedUntil, Math.floor(edit.end + 1));
        advance(Math.min(skippedUntil - lineStart, end), false);
      }
      advance(end, true);
    }
    lineStart += line.length;
  }
  for (; nextEdit < edits.length; nextEdit++) write(edits[nextEdit].content, unmapped, -1, -1);
  return builder.finish();
}

// Trace outer positions through the intermediate source using its per-line mapping table.
export function composeMap(text: string, outer: RawSourceMap, intermediateName: string,
  intermediate: string | undefined, inner: RawSourceMap, removeIntermediate: boolean | undefined, options?: MapOptions) {
  const columns = options?.columns !== false;
  const builder = new MapBuilder(options);
  const outerLines = decodedLines(splitIntoLines(text), outer, columns);
  const intermediateIndex = outer.sources.findIndex((_, i) => getSource(outer, i) === intermediateName);
  intermediate ??= outer.sourcesContent?.[intermediateIndex];
  const textLines = splitIntoLines(intermediate ?? "");
  const innerLines = decodedLines(textLines, inner, columns);
  const originals = inner.sourcesContent?.map(content => content && splitIntoLines(content));
  const sources = outer.sources.map((_, i) => i === intermediateIndex ? -1 : builder.addSource(outer, i));
  for (const [index, segments] of outerLines.entries()) {
    for (const seg of segments) {
      let source = sources[seg.source] ?? -1;
      let { line, originalColumn } = seg;
      let name: string | undefined = outer.names?.[seg.name];
      if (seg.source >= 0 && seg.source === intermediateIndex) {
        const entries = innerLines[line - 1] ?? [];
        let low = 0, high = entries.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (entries[mid].column <= originalColumn) low = mid + 1;
          else high = mid;
        }
        const match = entries[low - 1];
        if (match && match.source >= 0) {
          source = builder.addSource(inner, match.source);
          const offset = originalColumn - match.column;
          const prefix = textLines[line - 1].slice(match.column, originalColumn);
          line = match.line;
          originalColumn = match.originalColumn;
          const original = originals?.[match.source]?.[line - 1];
          let innerName: string | undefined = inner.names?.[match.name];
          if (offset && original?.startsWith(prefix, originalColumn) && prefix.length === offset) {
            originalColumn += offset;
            innerName = undefined;
          }
          name = innerName ?? (name && original?.startsWith(name, originalColumn) ? name : undefined);
        } else if (!removeIntermediate) source = builder.addSource(outer, intermediateIndex, intermediate);
      }
      if (source < 0) builder.writer.add(index + 1, seg.column, -1, -1, -1, -1);
      else builder.writer.add(index + 1, seg.column, source, line, originalColumn, name ? builder.addName(name) : -1);
    }
  }
  return builder.finish();
}
