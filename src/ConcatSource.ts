/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
import { Source, type HashLike, type MapOptions, type RawSourceMap, type SourceAndMap, type SourceValue } from './Source';
import type { SourceLike } from './CompatSource';
import { RawSource } from './RawSource';
import binding = require('./binding');

export class ConcatSource extends Source {
  // Rust holds the SourceRefs; keep their JS wrappers reachable for getChildren().
  readonly #roots: Source[];

  constructor(...args: Child[]) {
    super();
    binding.concatNew(this, args);
    this.#roots = args.filter(item => typeof item !== "string");
  }

  /** Return a shallow snapshot of the current children. */
  getChildren(): Source[] {
    return binding.concatGetChildren(this).map(child => typeof child === "string" ? new RawSource(child) : child);
  }

  add(item: Child): void {
    binding.concatAdd(this, item);
    if (typeof item !== "string") this.#roots.push(item);
  }

  addAllSkipOptimizing(items: Child[]): void {
    const inputs = Array.from(items);
    binding.concatAddAllSkipOptimizing(this, inputs);
    for (const item of inputs) {
      if (typeof item !== "string") this.#roots.push(item);
    }
  }

  buffer(): Buffer {
    return binding.concatBuffer(this);
  }

  source(): SourceValue {
    return binding.concatSource(this);
  }

  size(): number {
    return binding.concatSize(this);
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    return binding.concatMap(this, options?.columns !== false);
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return binding.concatSourceAndMap(this, options?.columns !== false);
  }

  updateHash(hash: HashLike): void {
    const children = this.getChildren();
    const count = children.length;
    hash.update("ConcatSource");
    for (let i = 0; i < count; i++) children[i].updateHash(hash);
  }
}

export declare namespace ConcatSource {
  export { SourceLike, HashLike, MapOptions, RawSourceMap, SourceAndMap, SourceValue, Child, };
}
export type Child = string | Source;
