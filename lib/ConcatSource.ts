/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
import { Source } from './Source';
import binding = require('./binding');
import { concatSourceAndMap } from './helpers/sourceMapTransforms';
import { sharedHelpers } from './nativeContext';

export class ConcatSource extends Source {
  constructor(...args: Child[]) {
    super();
    binding.concatNew(this, args);
  }

  /** Return a shallow snapshot of the current children. */
  getChildren(): Source[] {
    return binding.concatGetChildren(this);
  }

  add(item: Child): void {
    binding.concatAdd(this, item);
  }

  addAllSkipOptimizing(items: Child[]): void {
    binding.concatAddAllSkipOptimizing(this, items);
  }

  buffer(): Buffer<ArrayBufferLike> {
    return binding.concatBuffer(this) ?? Buffer.concat(this.buffers());
  }

  buffers(): Buffer<ArrayBufferLike>[] {
    return binding.concatBuffers(this);
  }

  source(): SourceValue {
    const value = binding.concatSource(this);
    if (value !== undefined) return value;
    const children = this.getChildren();
    const childCount = children.length;
    let source = "";
    for (let ci = 0; ci < childCount; ci++) {
      source += children[ci].source();
    }
    return source;
  }

  size(): number {
    const value = binding.concatSize(this);
    if (value != null) return value;
    const children = this.getChildren();
    const childCount = children.length;
    let size = 0;
    for (let ci = 0; ci < childCount; ci++) {
      size += children[ci].size();
    }
    return size;
  }

  map(options?: MapOptions | undefined): RawSourceMap | null {
    const map = binding.concatMap(this, sharedHelpers.columns(options));
    return map === undefined ? concatSourceAndMap(this.getChildren(), options).map : map;
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    const result = binding.concatSourceAndMap(this, sharedHelpers.columns(options));
    return result === undefined ? concatSourceAndMap(this.getChildren(), options) : result;
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
type SourceLike = import("./CompatSource").SourceLike;
type HashLike = import("./Source").HashLike;
type MapOptions = import("./Source").MapOptions;
type RawSourceMap = import("./Source").RawSourceMap;
type SourceAndMap = import("./Source").SourceAndMap;
type SourceValue = import("./Source").SourceValue;
export type Child = string | Source;
