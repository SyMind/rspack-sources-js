/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');
import { prefixSourceAndMap } from './helpers/sourceMapTransforms';
import { contextOf } from './nativeContext';

// `/\n/g` (no lookahead) lets V8's regex compiler take its
// literal-character fast path; the previous `/\n(?=.|\s)/g` form
// disabled it. Output stays identical because `buildPrefixed` strips
// the spurious trailing prefix when the input ended with a newline.
const NEWLINE_REGEX = /\n/g;

/**
 * Prepend `prefix` and insert `prefix` after every newline that has
 * content following — the original `/\n(?=.|\s)/g` semantics, but
 * implemented as a fast-path regex + tail-strip.
 */
const buildPrefixed = (prefix: string, node: string): string => {
  if (prefix.length === 0)
    return node;
  const replaced = node.replace(NEWLINE_REGEX, `\n${prefix}`);
  const len = node.length;
  // `/\n/g` matches the trailing newline too, so the replace appended
  // a spurious prefix at the end. Trim it.
  if (len > 0 && node.charCodeAt(len - 1) === 10) {
    return prefix + replaced.slice(0, replaced.length - prefix.length);
  }
  return prefix + replaced;
};

export class PrefixSource extends Source {
  get #prefix(): string {
    return binding.prefixGetPrefix(this);
  }

  get #source(): Source {
    return binding.prefixOriginal(this);
  }

  constructor(prefix: string, source: string | Buffer<ArrayBufferLike> | Source) {
    super();
    const native = contextOf(this);

    binding.prefixNew(this, native, prefix, source);
  }

  getPrefix(): string {
    return binding.prefixGetPrefix(this);
  }

  original(): Source {
    return binding.prefixOriginal(this);
  }

  source(): SourceValue {
    const value = binding.prefixSource(this);
    if (value !== undefined) return value;
    return buildPrefixed(this.#prefix, (this.#source.source() as string));
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    const map = binding.prefixMap(this, options);
    return map === undefined ? prefixSourceAndMap(this.#source, this.#prefix, options).map : map;
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    const result = binding.prefixSourceAndMap(this, options);
    if (result !== undefined) return result;
    const { text, map } = prefixSourceAndMap(this.#source, this.#prefix, options);
    return { source: buildPrefixed(this.#prefix, text), map };
  }

  updateHash(hash: HashLike): void {
    hash.update("PrefixSource");
    this.#source.updateHash(hash);
    hash.update(this.#prefix);
  }

  buffer(): Buffer {
    return binding.prefixBuffer(this) ?? super.buffer();
  }

  buffers(): Buffer[] {
    return binding.prefixBuffers(this) ?? [super.buffer()];
  }

  size(): number {
    return binding.prefixSize(this) ?? super.buffer().length;
  }
}

export declare namespace PrefixSource {
  export { HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, };
}
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
