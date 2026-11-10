import type Source = require('./Source');

export type NodeKind = 'raw' | 'original' | 'concat' | 'replace' | 'mapped';

export interface MapInput {
  mappings: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  sourceRoot?: string;
  file?: string;
  debugId?: string;
}

export interface NativeEdit {
  start: number;
  end: number;
  content: string;
  name?: string;
}

export interface NativeNode {
  kind: NodeKind;
  text?: string;
  name?: string;
  children?: number[];
  edits?: NativeEdit[];
  sourceMap?: MapInput;
  originalSource?: string;
  innerSourceMap?: MapInput;
  removeOriginalSource?: boolean;
}

export interface NativeSource {
  source(): string;
  buffer(): Buffer;
  size(): number;
  map(columns: boolean): Source.RawSourceMap | null;
  sourceAndMap(columns: boolean): { source: string; map: Source.RawSourceMap | null };
}

export interface NativeBinding {
  compileSources(nodes: NativeNode[], existing: NativeSource[]): NativeSource[] | null;
}
