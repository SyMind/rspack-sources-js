'use strict';
const { createHash } = require('node:crypto');

const sourceKinds = ['RawSource', 'OriginalSource', 'SourceMapSource', 'ConcatSource', 'ReplaceSource', 'CachedSource', 'PrefixSource', 'SizeOnlySource', 'CompatSource', 'Source'];
class UnsupportedGraph extends Error {}

// Reads own data descriptors only. Capturing never calls source(), map(), getters,
// getChildren(), getReplacements(), getCachedData(), or a lazy source factory.
function encodeGraph(root, api) {
  const seen = new Map(), records = [];
  const summary = { sources: 0, edges: 0, sharedSources: 0, strings: 0, codeUnits: 0, bufferBytes: 0, types: {}, cacheFields: 0 };
  const sourceReferences = new Map();
  function encode(value) {
    if (value === undefined) return { undefined: true };
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : { number: String(value), negativeZero: Object.is(value, -0) };
    if (typeof value === 'string') { summary.strings++; summary.codeUnits += value.length; return value; }
    if (typeof value !== 'object') throw new UnsupportedGraph(`Cannot serialize ${typeof value}`);
    if (seen.has(value)) {
      if (value instanceof api.Source) { summary.edges++; sourceReferences.set(value, (sourceReferences.get(value) ?? 1) + 1); }
      return { ref: seen.get(value) };
    }
    const id = records.length;
    seen.set(value, id);
    const record = { type: '', properties: [] };
    records.push(record);
    if (Buffer.isBuffer(value)) { record.type = 'buffer'; record.data = value.toString('base64'); summary.bufferBytes += value.length; return { ref: id }; }
    if (value instanceof Map) { record.type = 'map'; record.entries = Array.from(value, ([key, item]) => [encode(key), encode(item)]); return { ref: id }; }
    if (value instanceof api.Source) {
      const kind = sourceKinds.find(name => api[name] && Object.getPrototypeOf(value) === api[name].prototype);
      if (!kind) throw new UnsupportedGraph(`Unrecognized Source subclass ${value.constructor?.name}`);
      record.type = 'source'; record.kind = kind;
      summary.sources++; summary.edges++; summary.types[kind] = (summary.types[kind] ?? 0) + 1;
      sourceReferences.set(value, 1);
    } else if (value instanceof api.ReplaceSource.Replacement) record.type = 'replacement';
    else if (Array.isArray(value)) { record.type = 'array'; record.length = value.length; }
    else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) { record.type = 'object'; record.nullPrototype = Object.getPrototypeOf(value) === null; }
    else throw new UnsupportedGraph(`Unrecognized data prototype ${value.constructor?.name}`);
    if (Object.getOwnPropertySymbols(value).length) throw new UnsupportedGraph('Symbol properties are not replayable');
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (record.type === 'array' && name === 'length') continue;
      if (!('value' in descriptor)) throw new UnsupportedGraph(`Accessor ${record.kind ?? record.type}.${name}`);
      if (record.type === 'source' && name.startsWith('_cached') && descriptor.value !== undefined) summary.cacheFields++;
      record.properties.push([name, encode(descriptor.value), descriptor.enumerable, descriptor.writable, descriptor.configurable]);
    }
    return { ref: id };
  }
  const reference = encode(root);
  summary.sharedSources = [...sourceReferences.values()].filter(count => count > 1).length;
  summary.edges--;
  return { root: reference, records, summary };
}

function restoreGraph(graph, api, nativeState) {
  const memo = new Map(), constructing = new Set();
  function decode(value) {
    if (value === null || typeof value !== 'object') return value;
    if (value.undefined) return undefined;
    if (value.number !== undefined) return value.negativeZero ? -0 : Number(value.number);
    if (!('ref' in value)) throw new Error('Invalid graph reference');
    const id = value.ref;
    if (memo.has(id)) return memo.get(id);
    if (constructing.has(id)) throw new Error('Cyclic Source constructor dependency');
    const record = graph.records[id];
    let result;
    if (record.type === 'buffer') result = Buffer.from(record.data, 'base64');
    else if (record.type === 'map') {
      result = new Map(); memo.set(id, result);
      for (const [key, item] of record.entries) result.set(decode(key), decode(item));
      return result;
    } else if (record.type === 'array') result = [];
    else if (record.type === 'object') result = record.nullPrototype ? Object.create(null) : {};
    else {
      constructing.add(id);
      const fields = Object.fromEntries(record.properties.map(([name, item]) => [name, decode(item)]));
      if (record.type === 'replacement') result = new api.ReplaceSource.Replacement(fields.start, fields.end, fields.content, fields.name);
      else switch (record.kind) {
        case 'Source': result = new api.Source(); break;
        case 'RawSource': result = new api.RawSource(fields._value ?? fields._valueAsString ?? fields._valueAsBuffer); break;
        case 'OriginalSource':
          result = nativeState ? nativeState.restoreOriginal(api, fields) : new api.OriginalSource(fields._value ?? fields._valueAsBuffer, fields._name);
          break;
        case 'SourceMapSource': result = new api.SourceMapSource(
          fields._valueAsString ?? fields._valueAsBuffer, fields._name,
          fields._sourceMapAsObject ?? fields._sourceMapAsString ?? fields._sourceMapAsBuffer,
          fields._hasOriginalSource ? fields._originalSourceAsString ?? fields._originalSourceAsBuffer : undefined,
          fields._hasInnerSourceMap ? fields._innerSourceMapAsObject ?? fields._innerSourceMapAsString ?? fields._innerSourceMapAsBuffer : undefined,
          fields._removeOriginalSource); break;
        case 'ConcatSource':
          if (nativeState && fields._isOptimized) {
            result = new api.ConcatSource();
            result.addAllSkipOptimizing(fields._children);
          } else result = new api.ConcatSource(...fields._children);
          break;
        case 'ReplaceSource': result = new api.ReplaceSource(fields._source, fields._name); break;
        case 'CachedSource':
          result = nativeState ? nativeState.restoreCached(api, fields) : new api.CachedSource(fields._source);
          break;
        case 'PrefixSource': result = new api.PrefixSource(fields._prefix, fields._source); break;
        case 'SizeOnlySource': result = new api.SizeOnlySource(fields._size); break;
        case 'CompatSource': result = new api.CompatSource(fields._sourceLike); break;
        default: throw new Error(`Unsupported source kind ${record.kind}`);
      }
      constructing.delete(id);
      // Retain observed caches and storage representation, including absent fields.
      const names = new Set(record.properties.map(([name]) => name));
      if (!nativeState) for (const name of Object.getOwnPropertyNames(result)) if (!names.has(name)) delete result[name];
    }
    memo.set(id, result);
    for (const [name, item, enumerable, writable, configurable] of record.properties ?? []) {
      if (nativeState && (record.kind === 'OriginalSource' || record.kind === 'CachedSource') && name.startsWith('_')) continue;
      if (nativeState && record.kind === 'ConcatSource' && (name === '_children' || name === '_isOptimized')) continue;
      const value = decode(item);
      if (nativeState && record.type === 'source' && name.startsWith('_')) nativeState.set(result, name, value);
      else if (record.type === 'array' && String(result.length) === name && enumerable && writable && configurable) result.push(value);
      else if (name !== '__proto__' && enumerable && writable && configurable) result[name] = value;
      else Object.defineProperty(result, name, { value, enumerable, writable, configurable });
    }
    if (record.type === 'array' && result.length < record.length) result.length = record.length;
    return result;
  }
  return decode(graph.root);
}

function normalize(value) {
  if (value === undefined) return { undefined: true };
  if (Buffer.isBuffer(value)) return { buffer: value.toString('base64') };
  if (value instanceof Map) return { map: [...value].map(([k, v]) => [normalize(k), normalize(v)]) };
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).map(key => [key, normalize(value[key])]));
  return value;
}
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex'); }
module.exports = { encodeGraph, restoreGraph, fingerprint, UnsupportedGraph };
