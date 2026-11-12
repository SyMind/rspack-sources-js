/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');

/** An independent copy of an edit returned by getReplacements(). */
export class Replacement {
  declare index: number | undefined;

  constructor(
    public start: number,
    public end: number,
    public content: string,
    public name?: string,
  ) {}
}

export class ReplaceSource extends Source {
  readonly #source: Source;
  readonly #name?: string;

  constructor(source: Source, name?: string) {
    super();
    this.#source = source;
    this.#name = name;
    binding.replaceNew(this, source);
  }

  getName(): string | undefined {
    return this.#name;
  }

  /** Returns a sorted snapshot of the edits recorded so far. */
  getReplacements(): Replacement[] {
    return binding.replaceGetReplacements(this, Replacement);
  }

  replace(start: number, end: number, newValue: string, name?: string | undefined): void {
    if (typeof newValue !== "string") {
      throw new Error(`insertion must be a string, but is a ${typeof newValue}`);
    }
    binding.replaceReplace(this, start, end, newValue, name);
  }

  insert(pos: number, newValue: string, name?: string | undefined): void {
    if (typeof newValue !== "string") {
      throw new Error(`insertion must be a string, but is a ${typeof newValue}: ${newValue}`);
    }
    binding.replaceInsert(this, pos, newValue, name);
  }

  source(): SourceValue {
    return binding.replaceSource(this);
  }

  buffer(): Buffer {
    return binding.replaceBuffer(this);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    return binding.replaceMap(this, options?.columns !== false);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return binding.replaceSourceAndMap(this, options?.columns !== false);
  }

  original(): Source {
    return this.#source;
  }

  updateHash(hash: HashLike): void {
    hash.update("ReplaceSource");
    this.#source.updateHash(hash);
    hash.update(this.#name || "");
    for (const replacement of binding.replaceGetReplacements(this, Replacement)) {
      hash.update(`${replacement.start}${replacement.end}`);
      hash.update(replacement.content);
      if (replacement.name) hash.update(replacement.name);
    }
  }

  size(): number {
    return binding.replaceSize(this);
  }
}

ReplaceSource.Replacement = Replacement;

export declare namespace ReplaceSource {
  export { Replacement, HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
