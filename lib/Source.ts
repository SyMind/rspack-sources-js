/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
export class Source {
  source(): SourceValue {
    throw new Error("Abstract");
  }

  /** Treat the returned bytes as read-only. Use Buffer.from(source.buffer()) for a writable copy. */
  buffer(): Buffer {
    const source = this.source();
    if (Buffer.isBuffer(source))
      return source;
    return Buffer.from(source, "utf8");
  }

  size(): number {
    return this.buffer().length;
  }

  map(_options?: MapOptions): RawSourceMap | null {
    return null;
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return {
      source: this.source(),
      map: this.map(options),
    };
  }

  updateHash(_hash: HashLike): void {
    throw new Error("Abstract");
  }
}

export declare namespace Source {
  export { MapOptions, RawSourceMap, SourceValue, SourceAndMap, HashLike, };
}
export type MapOptions = {
  /**
   * need columns?
   */
  columns?: boolean | undefined;
  /**
   * is module
   */
  module?: boolean | undefined;
};
export type RawSourceMap = {
  /**
   * version
   */
  version: number;
  /**
   * sources
   */
  sources: string[];
  /**
   * names
   */
  names: string[];
  /**
   * source root
   */
  sourceRoot?: string | undefined;
  /**
   * sources content
   */
  sourcesContent?: (string | null)[] | undefined;
  /**
   * mappings
   */
  mappings: string;
  /**
   * file
   */
  file?: string | undefined;
  /**
   * debug id
   */
  debugId?: string | undefined;
  /**
   * ignore list
   */
  ignoreList?: number[] | undefined;
};
export type SourceValue = string | Buffer;
export type SourceAndMap = {
  /**
   * source
   */
  source: SourceValue;
  /**
   * map
   */
  map: RawSourceMap | null;
};
export type HashLike = {
  /**
   * Consume read-only bytes. Copy with Buffer.from(data) before writing.
   */
  update: (data: string | Buffer, inputEncoding?: string) => HashLike;
  /**
   * get hash digest
   */
  digest: (encoding?: string) => string | Buffer;
};
