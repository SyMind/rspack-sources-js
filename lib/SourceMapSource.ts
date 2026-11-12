/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
import { types } from 'node:util';
import { Source } from './Source';
import binding = require('./binding');
import { composeMap } from './helpers/sourceMapTransforms';
import { contextOf, sharedHelpers } from './nativeContext';

export class SourceMapSource extends Source {
  static readonly #helpers = {
    ...sharedHelpers,
    mapInput(value: any) {
      if (!value || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return;
      const allowed = ['version', 'mappings', 'sources', 'sourcesContent', 'names', 'file', 'sourceRoot'];
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.keys(descriptors).some(key => !allowed.includes(key) || !('value' in descriptors[key]))) return;
      const isText = (v: unknown): v is string => typeof v === 'string' && v.isWellFormed();
      if (value.version !== 3 || !isText(value.mappings)) return;
      for (const key of ['sources', 'sourcesContent', 'names']) {
        const entries = value[key] ?? [];
        if (!sharedHelpers.plainArray(entries) || !entries.every(isText)) return;
      }
      const sourcesContent = value.sourcesContent ?? [];
      if (sourcesContent.length !== (value.sources ?? []).length || sourcesContent.some((v: string) => !v)) return;
      if (value.file !== undefined && !isText(value.file) || value.sourceRoot !== undefined && !isText(value.sourceRoot)) return;
      return {
        mappings: value.mappings,
        sources: value.sources ?? [],
        sourcesContent,
        names: value.names ?? [],
        file: value.file,
        sourceRoot: value.sourceRoot,
      };
    },
  };

  get #name(): string {
    return binding.sourceMapGetField(this, "_name");
  }

  get #hasOriginalSource(): boolean {
    return binding.sourceMapGetField(this, "_hasOriginalSource");
  }

  get #hasInnerSourceMap(): boolean {
    return binding.sourceMapGetField(this, "_hasInnerSourceMap");
  }

  get #removeOriginalSource(): boolean | undefined {
    return binding.sourceMapGetField(this, "_removeOriginalSource");
  }

  constructor(value: string | Buffer<ArrayBufferLike>, name: string, sourceMap?: string | Buffer<ArrayBufferLike> | RawSourceMap | undefined, originalSource?: SourceValue | undefined, innerSourceMap?: string | Buffer<ArrayBufferLike> | RawSourceMap | null | undefined, removeOriginalSource?: boolean | undefined) {
    super();
    const native = contextOf(this, SourceMapSource.#helpers);

    binding.sourceMapNew(this, native, value, name, sourceMap, originalSource, innerSourceMap, removeOriginalSource);
  }

  getArgsAsBuffers(): [
    Buffer<ArrayBufferLike>,
    string,
    Buffer<ArrayBufferLike>,
    Buffer<ArrayBufferLike> | undefined,
    Buffer<ArrayBufferLike> | undefined,
    boolean | undefined
  ] {
    return binding.sourceMapGetArgsAsBuffers(this);
  }

  buffer(): Buffer<ArrayBufferLike> {
    return binding.sourceMapBuffer(this);
  }

  buffers(): Buffer[] {
    return binding.sourceMapBuffers(this);
  }

  size(): number {
    return binding.sourceMapSize(this);
  }

  source(): SourceValue {
    return binding.sourceMapSource(this);
  }

  #originalSourceString(): string | undefined {
    return binding.sourceMapOriginalSourceString(this);
  }

  #innerSourceMapObject(): any {
    return binding.sourceMapInnerSourceMapObject(this);
  }

  #sourceMapObject(): any {
    return binding.sourceMapSourceMapObject(this);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    const map = binding.sourceMapMap(this, options);
    return map === undefined ? this.#composedMap(this.source() as string, options) : map;
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    const result = binding.sourceMapSourceAndMap(this, options);
    if (result !== undefined) return result;
    const source = this.source() as string;
    return { source, map: this.#composedMap(source, options) };
  }

  #composedMap(source: string, options?: MapOptions) {
    return composeMap(source, this.#sourceMapObject(), this.#name, this.#originalSourceString(),
      this.#innerSourceMapObject(), this.#removeOriginalSource, options);
  }

  updateHash(hash: HashLike): void {
    hash.update("SourceMapSource");
    hash.update(this.buffer());
    hash.update(binding.sourceMapSourceMapBuffer(this));
    if (this.#hasOriginalSource) {
      hash.update(binding.sourceMapOriginalSourceBuffer(this)!);
    }
    if (this.#hasInnerSourceMap) {
      hash.update(binding.sourceMapInnerSourceMapBuffer(this)!);
    }
    hash.update(this.#removeOriginalSource ? "true" : "false");
  }
}

export declare namespace SourceMapSource {
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
