/*
    MIT License http://www.opensource.org/licenses/mit-license.php
    Author Tobias Koppers @sokra
*/
export class Source {
  source(): SourceValue {
    throw new Error("Abstract");
  }

  buffer(): Buffer<ArrayBufferLike> {
    const source = this.source();
    if (Buffer.isBuffer(source))
      return source;
    return Buffer.from(source, "utf8");
  }

  buffers(): Buffer<ArrayBufferLike>[] {
    return [this.buffer()];
  }

  size(): number {
    return this.buffer().length;
  }

  // eslint-disable-next-line no-unused-vars
  map(options?: MapOptions | undefined): RawSourceMap | null {
    return null;
  }

  sourceAndMap(options?: MapOptions | undefined): SourceAndMap {
    return {
      source: this.source(),
      map: this.map(options),
    };
  }

  // eslint-disable-next-line no-unused-vars
  updateHash(hash: HashLike): void {
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
  sourcesContent?: string[] | undefined;
  /**
   * mappings
   */
  mappings: string;
  /**
   * file
   */
  file: string;
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
   * make hash update
   */
  update: (data: string | Buffer, inputEncoding?: string) => HashLike;
  /**
   * get hash digest
   */
  digest: (encoding?: string) => string | Buffer;
};
