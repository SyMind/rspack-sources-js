import type { Source } from './Source';
import type { ConcatSource } from './ConcatSource';
type Child = ConcatSource.Child;

export interface NativeSource {
  source(): string;

  buffer(): Buffer;

  size(): number;

  map(columns: boolean): Source.RawSourceMap | null;

  sourceAndMap(columns: boolean): Source.SourceAndMap;
}
export interface SourceStats { creations: number; mutations: number; compilations: number; compiledNodes: number; nativeReads: number; fallbacks: number; }
export interface NativeBinding {
  rawNew(receiver: object, store: object, value: string | Buffer, convertToString: boolean): void;

  rawIsBuffer(receiver: object): boolean;

  rawSource(receiver: object): Source.SourceValue;

  rawBuffer(receiver: object): Buffer;

  rawSize(receiver: object): number;

  originalNew(receiver: object, value: string | Buffer<ArrayBufferLike>, name: string): void;

  originalSource(receiver: object, cache: boolean): string;

  originalSize(receiver: object, bufferSize: number | undefined): number;

  originalBuffer(receiver: object, cache: boolean): Buffer<ArrayBufferLike>;

  originalMap(receiver: object, columns: boolean): Source.RawSourceMap | null;

  originalSourceAndMap(receiver: object, columns: boolean): Source.SourceAndMap;

  debugOriginalRestore(receiver: object, text: string | undefined, size: number | undefined): void;

  sourceMapNew(receiver: object, store: object, value: string | Buffer<ArrayBufferLike>, name: string, sourceMap: string | Buffer<ArrayBufferLike> | Source.RawSourceMap | undefined, originalSource: Source.SourceValue | undefined, innerSourceMap: string | Buffer<ArrayBufferLike> | Source.RawSourceMap | null | undefined, removeOriginalSource: boolean | undefined): void;

  sourceMapGetArgsAsBuffers(receiver: object): [
    Buffer<ArrayBufferLike>,
    string,
    Buffer<ArrayBufferLike>,
    Buffer<ArrayBufferLike> | undefined,
    Buffer<ArrayBufferLike> | undefined,
    boolean | undefined
  ];

  sourceMapBuffer(receiver: object): Buffer<ArrayBufferLike>;

  sourceMapBuffers(receiver: object): Buffer[];

  sourceMapSize(receiver: object): number;

  sourceMapSource(receiver: object): Source.SourceValue;

  sourceMapOriginalSourceBuffer(receiver: object): Buffer<ArrayBufferLike> | undefined;

  sourceMapOriginalSourceString(receiver: object): string | undefined;

  sourceMapInnerSourceMapObject(receiver: object): any;

  sourceMapInnerSourceMapBuffer(receiver: object): Buffer<ArrayBufferLike> | undefined;

  sourceMapSourceMapObject(receiver: object): any;

  sourceMapSourceMapBuffer(receiver: object): Buffer<ArrayBufferLike>;

  sourceMapMap(receiver: object, options: Source.MapOptions | undefined): Source.RawSourceMap | null | undefined;

  sourceMapSourceAndMap(receiver: object, options: Source.MapOptions | undefined): Source.SourceAndMap | undefined;

  registerSourceHelpers(helpers: {
    createSourceJsObject(kind: 'RawSource', value: string | Buffer, convertToString: boolean): Source;
    contextOf(receiver: object): object;
  }): void;
  concatNew(receiver: ConcatSource, args: Child[]): void;
  concatGetChildren(receiver: object): Source[];
  concatAdd(receiver: object, item: Child): void;
  concatAddAllSkipOptimizing(receiver: object, items: Child[]): void;
  concatSource(receiver: object): string | undefined;
  concatMap(receiver: object, columns: boolean | undefined): Source.RawSourceMap | null | undefined;
  concatSourceAndMap(receiver: object, columns: boolean | undefined): Source.SourceAndMap | undefined;
  concatBuffers(receiver: object): Buffer[];
  concatSize(receiver: object): number | null;
  concatBuffer(receiver: object): Buffer | null;

  replaceNew(receiver: object, store: object, source: Source, name: string | undefined): void;

  replaceGetName(receiver: object): string | undefined;

  replaceGetReplacements(receiver: object): import('./ReplaceSource').Replacement[];

  replaceReplace(receiver: object, start: number, end: number, newValue: string, name: string | undefined): boolean;

  replaceInsert(receiver: object, pos: number, newValue: string, name: string | undefined): boolean;

  replaceSource(receiver: object): Source.SourceValue | undefined;

  replaceBuffer(receiver: object): Buffer<ArrayBufferLike> | undefined;

  replaceBuffers(receiver: object): Buffer<ArrayBufferLike>[] | undefined;

  replaceMap(receiver: object, options: Source.MapOptions | undefined): Source.RawSourceMap | null | undefined;

  replaceSourceAndMap(receiver: object, options: Source.MapOptions | undefined): Source.SourceAndMap | undefined;

  replaceOriginal(receiver: object): Source;

  replaceSortReplacements(receiver: object): void;

  replaceSize(receiver: object): number | undefined;

  cachedNew(receiver: object, sourceType: boolean | undefined, buffer: Buffer | undefined, size: number | undefined): void;

  cachedSourceAndMap(receiver: object, options: Source.MapOptions | undefined): Source.SourceAndMap;

  cachedSource(receiver: object): Source.SourceValue;

  cachedBuffer(receiver: object): Buffer<ArrayBufferLike>;

  cachedBuffers(receiver: object): Buffer<ArrayBufferLike>[];

  cachedSize(receiver: object): number;

  prefixNew(receiver: object, store: object, prefix: string, source: string | Buffer<ArrayBufferLike> | Source): void;

  prefixGetPrefix(receiver: object): string;

  prefixOriginal(receiver: object): Source;

  prefixSource(receiver: object): Source.SourceValue | undefined;

  prefixMap(receiver: object, options: Source.MapOptions | undefined): Source.RawSourceMap | null | undefined;

  prefixSourceAndMap(receiver: object, options: Source.MapOptions | undefined): Source.SourceAndMap | undefined;

  prefixBuffer(receiver: object): Buffer | undefined;

  prefixBuffers(receiver: object): Buffer[] | undefined;

  prefixSize(receiver: object): number | undefined;

  sizeOnlyNew(receiver: object, store: object, size: number): void;

  sizeOnlySize(receiver: object): number;

  compatNew(receiver: object, store: object, sourceLike: import('./CompatSource').SourceLike): void;

  compatSource(receiver: object): Source.SourceValue;

  compatBuffer(receiver: object): Buffer<ArrayBufferLike>;

  compatBuffers(receiver: object): Buffer<ArrayBufferLike>[];

  compatSize(receiver: object): number;

  compatMap(receiver: object, options: Source.MapOptions | undefined): Source.RawSourceMap | null;

  compatSourceAndMap(receiver: object, options: Source.MapOptions | undefined): Source.SourceAndMap;

  rawText(receiver: object): string;

  sourceMapGetField(receiver: object, field: string): any;

  sourceMapSetField(receiver: object, field: string, value: unknown): void;

  replaceGetField(receiver: object, field: string): any;

  replaceSetField(receiver: object, field: string, value: unknown): void;

  prefixGetField(receiver: object, field: string): any;

  prefixSetField(receiver: object, field: string, value: unknown): void;

  sizeOnlyGetField(receiver: object, field: string): any;

  sizeOnlySetField(receiver: object, field: string, value: unknown): void;

  compatGetField(receiver: object, field: string): any;

  compatSetField(receiver: object, field: string, value: unknown): void;

  debugSourceStats(reset?: boolean): SourceStats;

  debugSourceSnapshot(receiver: object): NativeSource | null;

  debugSourceGetField(receiver: object, field: string): any;

  debugSourceSetField(receiver: object, field: string, value: unknown): void;
}
