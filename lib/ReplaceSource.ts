/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');
import { replacementMap } from './helpers/sourceMapTransforms';
import { contextOf, sharedHelpers } from './nativeContext';

/** Writable view of a replacement returned by getReplacements(). */
export class Replacement {
  declare index: number | undefined;

  constructor(
    public start: number,
    public end: number,
    public content: string,
    public name?: string,
  ) {}
}

const arraySort = Array.prototype.sort;

// since v8 7.0, Array.prototype.sort is stable
const hasStableSort = typeof process === "object" &&
  process.versions &&
  typeof process.versions.v8 === "string" &&
  !/^[0-6]\./.test(process.versions.v8);

/**
 * Stable comparator hoisted to module scope so each `_sortReplacements()`
 * call doesn't allocate a fresh closure.
 */
const compareStable = (a: Replacement, b: Replacement): number => {
  const diff1 = a.start - b.start;
  if (diff1 !== 0)
    return diff1;
  const diff2 = a.end - b.end;
  if (diff2 !== 0)
    return diff2;
  return 0;
};

/**
 * Index-stabilising comparator for v8 < 7.0 (pre-stable Array.prototype.sort).
 * Unreachable on any supported Node — the `hasStableSort` guard always
 * wins so coverage tools never see this execute.
 */
/* istanbul ignore next */
const compareUnstableFallback = (a: Replacement, b: Replacement): number => {
  const diff1 = a.start - b.start;
  if (diff1 !== 0)
    return diff1;
  const diff2 = a.end - b.end;
  if (diff2 !== 0)
    return diff2;
  return (a.index as number) - (b.index as number);
};

function sortReplacements(replacements: Replacement[]): void {
  // Replacements are usually appended in source order (ties keep
  // insertion order, matching a stable sort), so an O(n) pre-scan
  // often lets us skip the sort and its per-element comparator calls.
  let isPresorted = true;
  for (let i = 1; i < replacements.length; i++) {
    const prev = replacements[i - 1];
    const repl = replacements[i];
    if (repl.start < prev.start ||
      (repl.start === prev.start && repl.end < prev.end)) {
      isPresorted = false;
      break;
    }
  }
  if (isPresorted) {
    return;
  }
  if (hasStableSort) {
    replacements.sort(compareStable);
  }
  else {
    // V8 < 7.0 only — unreachable on any supported Node.
    /* istanbul ignore next */
    for (const [i, repl] of replacements.entries())
      repl.index = i;
    /* istanbul ignore next */
    replacements.sort(compareUnstableFallback);
  }
}

export class ReplaceSource extends Source {
  static readonly #helpers = {
    ...sharedHelpers,
    sortReplacements,
    sortAllowed() { return Array.prototype.sort === arraySort; },
    replacement(start: number, end: number, content: string, name?: string) {
      return new Replacement(start, end, content, name);
    },
  };

  get #source(): Source {
    return binding.replaceOriginal(this);
  }

  get #name(): string | undefined {
    return binding.replaceGetName(this);
  }

  get #replacements(): Replacement[] {
    return binding.replaceGetField(this, "_replacements");
  }

  set #isSorted(value: boolean) {
    binding.replaceSetField(this, "_isSorted", value);
  }

  constructor(source: Source, name?: string | undefined) {
    super();
    const native = contextOf(this, ReplaceSource.#helpers);

    binding.replaceNew(this, native, source, name);
  }

  getName(): string | undefined {
    return binding.replaceGetName(this);
  }

  getReplacements(): Replacement[] {
    return binding.replaceGetReplacements(this);
  }

  replace(start: number, end: number, newValue: string, name?: string | undefined): void {
    if (binding.replaceReplace(this, start, end, newValue, name)) return;
    if (typeof newValue !== "string") {
      throw new Error(`insertion must be a string, but is a ${typeof newValue}`);
    }
    this.#replacements.push(new Replacement(start, end, newValue, name));
    this.#isSorted = false;
  }

  insert(pos: number, newValue: string, name?: string | undefined): void {
    if (binding.replaceInsert(this, pos, newValue, name)) return;
    if (typeof newValue !== "string") {
      throw new Error(`insertion must be a string, but is a ${typeof newValue}: ${newValue}`);
    }
    this.#replacements.push(new Replacement(pos, pos - 1, newValue, name));
    this.#isSorted = false;
  }

  source(): SourceValue {
    const value = binding.replaceSource(this);
    if (value !== undefined) return value;
    if (this.#replacements.length === 0) {
      return this.#source.source();
    }
    const current = (this.#source.source() as string);
    let pos = 0;
    const result = [];
    this.#sortReplacements();
    for (const replacement of this.#replacements) {
      const start = Math.floor(replacement.start);
      const end = Math.floor(replacement.end + 1);
      if (pos < start) {
        // slice directly from the original string rather than repeatedly
        // producing smaller intermediate strings, which avoids O(n) copies.
        result.push(current.slice(pos, start));
        pos = start;
      }
      result.push(replacement.content);
      if (pos < end) {
        pos = end;
      }
    }
    if (pos < current.length) {
      result.push(pos === 0 ? current : current.slice(pos));
    }
    return result.join("");
  }

  buffer(): Buffer<ArrayBufferLike> {
    return binding.replaceBuffer(this) ?? this.#bufferFromSource();
  }

  #bufferFromSource(): Buffer {
    if (this.#replacements.length === 0) {
      return this.#source.buffer();
    }
    return super.buffer();
  }

  buffers(): Buffer<ArrayBufferLike>[] {
    return binding.replaceBuffers(this) ?? [this.#bufferFromSource()];
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    const map = binding.replaceMap(this, options);
    if (map !== undefined) return map;
    return this.#replacements.length === 0 ? this.#source.map(options) : this.#replacementMap(options);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    const result = binding.replaceSourceAndMap(this, options);
    if (result !== undefined) return result;
    return this.#replacements.length === 0 ? this.#source.sourceAndMap(options) : { source: this.source(), map: this.#replacementMap(options) };
  }

  #replacementMap(options?: MapOptions) {
    this.#sortReplacements();
    return replacementMap(this.#source, this.#replacements, options);
  }

  original(): Source {
    return binding.replaceOriginal(this);
  }

  #sortReplacements(): void {
    binding.replaceSortReplacements(this);
  }

  updateHash(hash: HashLike): void {
    this.#sortReplacements();
    hash.update("ReplaceSource");
    this.#source.updateHash(hash);
    hash.update(this.#name || "");
    for (const replacement of this.#replacements) {
      hash.update(`${replacement.start}${replacement.end}`);
      hash.update(replacement.content);
      if (replacement.name) hash.update(replacement.name);
    }
  }

  size(): number {
    return binding.replaceSize(this) ?? this.#bufferFromSource().length;
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
