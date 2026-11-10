import binding = require('./binding');
import * as sources from './sources';
import { types } from 'node:util';
import type { MapInput, NativeEdit, NativeNode, NativeSource, NodeKind } from './nativeTypes';
import type { MapOptions, RawSourceMap, SourceAndMap } from './Source';
const { isProxy } = types;

interface Snapshot { key: unknown[]; deps: Snapshot[]; children: unknown[]; ref: number; handle?: NativeSource; }
interface Description { record: Omit<NativeNode, 'children'>; key: unknown[]; children: unknown[]; }
interface Frame { node: unknown; description?: Description; }
const snapshots = new WeakMap<object, Snapshot>();
const registered = new Map<object, { kind: NodeKind; methods: unknown[] }>();
const stats = { compilations: 0, compiledNodes: 0, nativeReads: 0, fallbacks: 0 };
const methods = ['source', 'buffer', 'size', 'map', 'sourceAndMap', 'streamChunks', '_optimize', '_sortReplacements', '_sourceMapObject', '_innerSourceMapObject'];
const text = (value: unknown): value is string => typeof value === 'string' && value.isWellFormed();
const equal = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((item, i) => item === b[i]);

export function register(Class: { prototype: object }, kind: NodeKind) {
  const proto = Class.prototype;
  registered.set(proto, { kind, methods: methods.map(name => Reflect.get(proto, name)) });
}

function classification(node: object): NodeKind | null {
  const entry = registered.get(Object.getPrototypeOf(node));
  if (!entry) return null;
  for (let i = 0; i < methods.length; i++) {
    let proto: object | null = node;
    let descriptor: PropertyDescriptor | undefined;
    while (proto && !(descriptor = Object.getOwnPropertyDescriptor(proto, methods[i]))) proto = Object.getPrototypeOf(proto);
    if (descriptor && (!('value' in descriptor) || descriptor.value !== entry.methods[i])) return null;
    if (!descriptor && entry.methods[i] !== undefined) return null;
  }
  return entry.kind;
}

function mapInput(input: unknown, key: unknown[]): MapInput | null {
  if (!input || typeof input !== 'object' || isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const value = input as Record<string, unknown>;
  const allowed = new Set(['version', 'mappings', 'sources', 'sourcesContent', 'names', 'file', 'sourceRoot', 'debugId', 'ignoreList']);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).some(name => !allowed.has(name) || !('value' in descriptors[name]))) return null;
  if (value.version !== 3 || !text(value.mappings)) return null;
  const result: MapInput = { mappings: value.mappings, sources: [], sourcesContent: [], names: [] };
  key.push(value.mappings);
  for (const [js, native] of [['sources', 'sources'], ['sourcesContent', 'sourcesContent'], ['names', 'names']] as const) {
    const values = value[js] ?? [];
    if (!Array.isArray(values) || isProxy(values) || Object.getPrototypeOf(values) !== Array.prototype) return null;
    // Reject sparse arrays/accessors instead of running application code during graph preparation.
    const copy: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const item = Object.getOwnPropertyDescriptor(values, i);
      if (!item || !('value' in item) || !text(item.value)) return null;
      copy.push(item.value);
    }
    key.push(js, copy.length);
    for (const item of copy) key.push(item);
    result[native] = copy;
  }
  // Rust represents missing content slots as empty strings. JS distinguishes null,
  // absent trailing slots, and empty content during composition; retain its path.
  if (result.sourcesContent.length !== result.sources.length || result.sourcesContent.some(value => value === '')) return null;
  for (const name of ['file', 'sourceRoot', 'debugId'] as const) {
    if (value[name] !== undefined && !text(value[name])) return null;
    key.push(name, value[name]);
    if (value[name] !== undefined) result[name] = value[name] as string;
  }
  // Source-map extensions are preserved by the JS path until Rust parity is tested.
  if (value.ignoreList !== undefined || value.debugId !== undefined) return null;
  return result;
}

function describe(input: unknown): Description | null {
  if (typeof input === 'string') return text(input) ? { record: { kind: 'raw', text: input }, key: [input], children: [] } : null;
  if (!input || typeof input !== 'object' || isProxy(input)) return null;
  const kind = classification(input);
  if (kind === 'raw') {
    const node = input as sources.RawSource;
    if (!text(node._value) || node._valueAsBuffer !== undefined) return null;
    return { record: { kind, text: node._value }, key: [node._value], children: [] };
  }
  if (kind === 'original') {
    const node = input as sources.OriginalSource;
    if (!text(node._value) || !text(node._name) || node._valueAsBuffer !== undefined || node._scopeBindings !== undefined) return null;
    return { record: { kind, text: node._value, name: node._name }, key: [node._value, node._name], children: [] };
  }
  if (kind === 'concat') {
    const node = input as sources.ConcatSource;
    // Preserve the observable child-array replacement and flattening boundary.
    if (!node._isOptimized) node._optimize();
    const children = [];
    for (let i = 0; i < node._children.length; i++) {
      const child = Object.getOwnPropertyDescriptor(node._children, i);
      if (!child || !('value' in child)) return null;
      children.push(child.value);
    }
    return { record: { kind }, key: [], children };
  }
  if (kind === 'replace') {
    const node = input as sources.ReplaceSource;
    for (let i = 0; i < node._replacements.length; i++) {
      const item = Object.getOwnPropertyDescriptor(node._replacements, i);
      if (!item || !('value' in item) || !item.value || isProxy(item.value)) return null;
      for (const field of ['start', 'end', 'content', 'name']) {
        const descriptor = Object.getOwnPropertyDescriptor(item.value, field);
        if (!descriptor || !('value' in descriptor)) return null;
      }
    }
    node._sortReplacements();
    const edits = node._replacements;
    const key: unknown[] = [];
    const converted: NativeEdit[] = [];
    let previousEnd = 0;
    for (const edit of edits) {
      const { start, end, content, name } = edit;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start - 1 || end >= 0xffffffff || start > 0xffffffff || !text(content) || (name !== undefined && !text(name))) return null;
      if (start < previousEnd) return null;
      previousEnd = end + 1;
      key.push(start, end, content, name);
      converted.push({ start, end: end + 1, content, name });
    }
    return { record: { kind, edits: converted }, key, children: [node._source] };
  }
  if (kind === 'mapped') {
    const node = input as sources.SourceMapSource;
    if (!text(node._valueAsString) || !text(node._name) || node._valueAsBuffer !== undefined || node._sourceMapAsBuffer !== undefined || node._innerSourceMapAsBuffer !== undefined || node._originalSourceAsBuffer !== undefined) return null;
    const key = [node._valueAsString, node._name, node._originalSourceAsString, !!node._removeOriginalSource];
    // Strings are parsed by the local implementation at its normal lazy boundary.
    const outer = node._sourceMapObject();
    const sourceMap = mapInput(outer, key);
    if (!sourceMap) return null;
    let innerSourceMap: MapInput | undefined;
    if (node._hasInnerSourceMap) {
      const inner = mapInput(node._innerSourceMapObject(), key);
      if (!inner || (node._hasOriginalSource && !text(node._originalSourceAsString))) return null;
      innerSourceMap = inner;
    }
    key.push(!!node._hasInnerSourceMap);
    return {
      record: { kind, text: node._valueAsString, name: node._name, sourceMap, innerSourceMap,
        originalSource: node._hasOriginalSource ? node._originalSourceAsString : undefined,
        removeOriginalSource: !!node._removeOriginalSource },
      key, children: [],
    };
  }
  return null;
}

export function prepare(root: unknown): NativeSource | null {
  const memo = new Map<unknown, Snapshot>();
  const visiting = new Set<unknown>();
  const records: NativeNode[] = [];
  const pending: { node: unknown; entry: Snapshot }[] = [];
  const existing: NativeSource[] = [];
  const existingIds = new Map<NativeSource, number>();
  function refOf(entry: Snapshot): number {
    if (!entry.handle) return entry.ref;
    let id = existingIds.get(entry.handle);
    if (id === undefined) {
      id = -1 - existing.length;
      existingIds.set(entry.handle, id);
      existing.push(entry.handle);
    }
    return id;
  }
  const stack: Frame[] = [{ node: root }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (memo.has(frame.node)) { stack.pop(); continue; }
    if (!frame.description) {
      if (visiting.has(frame.node)) return null;
      const description = describe(frame.node);
      if (!description) return null;
      frame.description = description;
      visiting.add(frame.node);
      const prior = frame.node && typeof frame.node === 'object' ? snapshots.get(frame.node) : undefined;
      if (prior) {
        description.children.forEach((child, i) => {
          if (typeof child === 'string' && !memo.has(child) && prior.children[i] === child) memo.set(child, prior.deps[i]);
        });
      }
      for (let i = description.children.length - 1; i >= 0; i--) {
        const child = description.children[i];
        if (visiting.has(child)) return null;
        if (!memo.has(child)) stack.push({ node: child });
      }
      continue;
    }
    const { record, key, children } = frame.description;
    const deps = children.map(child => memo.get(child)!);
    const old = frame.node && typeof frame.node === 'object' ? snapshots.get(frame.node) : undefined;
    let entry: Snapshot;
    if (old && equal(old.key, key) && equal(old.deps, deps)) {
      entry = old;
    } else {
      entry = { key, deps, children, ref: records.length, handle: undefined };
      records.push({ ...record, children: deps.map(refOf) });
      pending.push({ node: frame.node, entry });
    }
    memo.set(frame.node, entry);
    visiting.delete(frame.node);
    stack.pop();
  }
  if (records.length) {
    stats.compilations++;
    const handles = binding.compileSources(records, existing);
    if (!handles) return null;
    stats.compiledNodes += handles.length;
    pending.forEach(({ node, entry }, index) => {
      entry.handle = handles[index];
      if (node && typeof node === 'object') snapshots.set(node, entry);
    });
  }
  return memo.get(root)!.handle ?? null;
}

export function nativeRead(node: sources.Source, operation: 'map', options: MapOptions | undefined, fallback: () => RawSourceMap | null): RawSourceMap | null;
export function nativeRead(node: sources.Source, operation: 'sourceAndMap', options: MapOptions | undefined, fallback: () => SourceAndMap): SourceAndMap;
export function nativeRead(node: sources.Source, operation: 'map' | 'sourceAndMap', options: MapOptions | undefined, fallback: () => RawSourceMap | null | SourceAndMap): RawSourceMap | null | SourceAndMap {
  // Custom option getters/proxies and scopes remain in the local compatibility path.
  let columns = true;
  if (options !== undefined && options !== null) {
    if (isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype) return fallback();
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (Object.keys(descriptors).some(key => !['columns', 'module', 'scopes'].includes(key) || !('value' in descriptors[key]))) return fallback();
    if (options.scopes) return fallback();
    columns = options.columns !== false;
  }
  const handle = prepare(node);
  if (!handle) { stats.fallbacks++; return fallback(); }
  stats.nativeReads++;
  function normalizeMap(map: RawSourceMap | null): RawSourceMap | null {
    if (map === null) return null;
    return { version: 3, file: 'x', mappings: map.mappings, sources: map.sources,
      sourcesContent: map.sourcesContent, names: map.names };
  }
  if (operation === 'map') return normalizeMap(handle.map(columns));
  const result = handle.sourceAndMap(columns);
  return { source: result.source, map: normalizeMap(result.map) };
}

export function forget(node: object) { snapshots.delete(node); }
export function resetStats() { for (const key of Object.keys(stats) as (keyof typeof stats)[]) stats[key] = 0; }
for (const [Class, kind] of [[sources.RawSource, 'raw'], [sources.OriginalSource, 'original'], [sources.ConcatSource, 'concat'], [sources.ReplaceSource, 'replace'], [sources.SourceMapSource, 'mapped']] as const) register(Class, kind);
export { stats };
