import type { Replacement } from './ReplaceSource';
import type { Source } from './Source';
import type { ConcatSource } from './ConcatSource';
type Child = ConcatSource.Child;

export interface NativeSource {
  source(): Source.SourceValue;

  buffer(): Buffer;

  size(): number;

  map(columns: boolean): Source.RawSourceMap | null;

  sourceAndMap(columns: boolean): Source.SourceAndMap;
}
export interface SourceStats { creations: number; mutations: number; nativeReads: number; fallbacks: number; }
export interface NativeBinding {
  rawNew(receiver: object, value: string | Buffer, convertToString: boolean): void;

  rawIsBuffer(receiver: object): boolean;

  rawSource(receiver: object): Source.SourceValue;

  rawBuffer(receiver: object): Buffer;

  rawSize(receiver: object): number;

  rawMap(receiver: object, columns: boolean): Source.RawSourceMap | null;

  rawSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;

  originalNew(receiver: object, value: string | Buffer<ArrayBufferLike>, name: string): void;

  originalGetName(receiver: object): string;

  originalSource(receiver: object): string;

  originalSize(receiver: object): number;

  originalBuffer(receiver: object): Buffer<ArrayBufferLike>;

  originalMap(receiver: object, columns: boolean): Source.RawSourceMap | null;

  originalSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;

  debugOriginalRestore(receiver: object, text: string | undefined): void;

  sourceMapNew(receiver: object, value: string | Buffer<ArrayBufferLike>, name: string, sourceMap: string | Buffer<ArrayBufferLike> | Source.RawSourceMap | undefined, originalSource: Source.SourceValue | undefined, innerSourceMap: string | Buffer<ArrayBufferLike> | Source.RawSourceMap | null | undefined, removeOriginalSource: boolean | undefined): void;

  sourceMapGetArgsAsBuffers(receiver: object): [
    Buffer<ArrayBufferLike>,
    string,
    Buffer<ArrayBufferLike> | undefined,
    Buffer<ArrayBufferLike> | undefined,
    Buffer<ArrayBufferLike> | undefined,
    boolean | undefined
  ];

  sourceMapBuffer(receiver: object): Buffer;

  sourceMapSize(receiver: object): number;

  sourceMapSource(receiver: object): Source.SourceValue;

  sourceMapMap(receiver: object, columns: boolean): Source.RawSourceMap | null;

  sourceMapSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;

  concatNew(receiver: ConcatSource, args: Child[]): void;
  concatGetChildren(receiver: object): Child[];
  concatAdd(receiver: object, item: Child): void;
  concatAddAllSkipOptimizing(receiver: object, items: Child[]): void;
  concatSource(receiver: object): Source.SourceValue;
  concatMap(receiver: object, columns: boolean): Source.RawSourceMap | null;
  concatSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;
  concatBuffers(receiver: object): Buffer[];
  concatSize(receiver: object): number;
  concatBuffer(receiver: object): Buffer;

  replaceNew(receiver: object, source: Source): void;

  replaceGetReplacements(receiver: object, constructor: typeof Replacement): Replacement[];

  replaceReplace(receiver: object, start: number, end: number, newValue: string, name: string | undefined): void;

  replaceInsert(receiver: object, pos: number, newValue: string, name: string | undefined): void;

  replaceSource(receiver: object): Source.SourceValue;

  replaceBuffer(receiver: object): Buffer;

  replaceMap(receiver: object, columns: boolean): Source.RawSourceMap | null;

  replaceSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;

  replaceSize(receiver: object): number;

  cachedNew(receiver: object, original: Source): void;

  cachedMap(receiver: object, columns: boolean): Source.RawSourceMap | null;

  cachedSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;

  cachedSource(receiver: object): Source.SourceValue;

  cachedBuffer(receiver: object): Buffer;

  cachedSize(receiver: object): number;

  prefixNew(receiver: object, prefix: string, source: Source): void;

  prefixGetPrefix(receiver: object): string;

  prefixSource(receiver: object): Source.SourceValue;

  prefixMap(receiver: object, columns: boolean): Source.RawSourceMap | null;

  prefixSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;

  prefixBuffer(receiver: object): Buffer;

  prefixSize(receiver: object): number;

  sizeOnlyNew(receiver: object, size: number): void;

  sizeOnlySize(receiver: object): number;

  compatNew(receiver: object, sourceLike: import('./CompatSource').SourceLike): void;

  compatSource(receiver: object): Source.SourceValue;

  compatBuffer(receiver: object): Buffer;

  compatSize(receiver: object): number;

  compatMap(receiver: object, columns: boolean): Source.RawSourceMap | null;

  compatSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;

  debugSourceStats(reset?: boolean): SourceStats;

  debugBoundSourceType(receiver: object): string;
  debugSourceSnapshot(receiver: object): NativeSource | null;
}
