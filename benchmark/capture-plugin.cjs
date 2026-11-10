'use strict';
const { encodeGraph, fingerprint, streamFingerprint, UnsupportedGraph } = require('./graph.cjs');
const { mkdirSync, writeFileSync } = require('node:fs');
const { gzipSync } = require('node:zlib');
const { join } = require('node:path');
const sourceKinds = ['RawSource', 'OriginalSource', 'SourceMapSource', 'ConcatSource', 'ReplaceSource', 'CachedSource', 'PrefixSource', 'SizeOnlySource', 'CompatSource', 'Source'];
const methods = ['source', 'buffer', 'buffers', 'size', 'map', 'sourceAndMap', 'updateHash', 'streamChunks'];

class CaptureSourcesPlugin {
  constructor(options) { this.options = options; }
  apply(compiler) {
    const api = compiler.webpack.sources;
    const local = require('webpack-sources');
    if (api.Source !== local.Source) throw new Error('Capture and replay must use the same pinned webpack-sources');
    let phase = 'modules', depth = 0, sequence = 0, rootCounter = 0;
    const ids = new WeakMap(), assets = new WeakMap(), histogram = new Map(), innerHistogram = new Map(), selected = new Map(), unsupported = new Map(), restore = [];
    const trace = [], createHash = compiler.webpack.util.createHash;
    const hashAlgorithm = compiler.options.output.hashFunction;
    if (typeof hashAlgorithm !== 'string') throw new Error('A named webpack hash algorithm is required');
    const classify = value => sourceKinds.find(kind => api[kind] && Object.getPrototypeOf(value) === api[kind].prototype) ?? value.constructor.name;
    const estimate = (source, seen = new Set()) => {
      if (!source || seen.has(source)) return 0;
      if (typeof source === 'string') return source.length;
      seen.add(source);
      const value = source._cachedSource ?? source._valueAsString ?? source._value;
      if (typeof value === 'string' || Buffer.isBuffer(value)) return value.length;
      if (source._cachedBuffer) return source._cachedBuffer.length;
      if (Array.isArray(source._children)) return source._children.reduce((sum, child) => sum + estimate(child, seen), 0);
      return typeof source._source === 'object' ? estimate(source._source, seen) : 0;
    };
    for (const kind of sourceKinds) for (const method of methods) {
      const prototype = api[kind]?.prototype;
      const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, method);
      if (!descriptor || typeof descriptor.value !== 'function') continue;
      const original = descriptor.value;
      Object.defineProperty(prototype, method, { ...descriptor, value: function (...args) {
        const actualKind = classify(this);
        const bucket = `${phase}/${actualKind}/${method}`;
        const table = depth ? innerHistogram : histogram;
        table.set(bucket, (table.get(bucket) ?? 0) + 1);
        if (depth) return original.apply(this, args);
        let rootId = ids.get(this);
        if (rootId === undefined) { rootId = rootCounter++; ids.set(this, rootId); }
        const event = { sequence: sequence++, rootId, phase, kind: actualKind, method, asset: assets.get(this) ?? null, options: ['map', 'sourceAndMap', 'streamChunks'].includes(method) ? args[0] ?? null : null };
        trace.push(event);
        const score = estimate(this);
        const previous = selected.get(bucket);
        let candidate;
        if (!previous || score > previous.score) {
          try { candidate = { ...event, score, graph: encodeGraph(this, api), hashAlgorithm, args: ['map', 'sourceAndMap', 'streamChunks'].includes(method) && args[0] !== undefined ? [structuredClone(args[0])] : [] }; }
          catch (error) { if (!(error instanceof UnsupportedGraph)) throw error; const reason = `${bucket}: ${error.message}`; unsupported.set(reason, (unsupported.get(reason) ?? 0) + 1); }
        }
        let stream, shadow, realHash, originalUpdate, ownUpdate;
        if (candidate && method === 'streamChunks') {
          stream = streamFingerprint();
          const callbacks = args.slice(1, 4);
          args = [args[0], ...callbacks.map((callback, index) => (...values) => {
            stream.callbacks[index](...values);
            return callback(...values);
          })];
        }
        if (candidate && method === 'updateHash') {
          realHash = args[0]; shadow = createHash(hashAlgorithm);
          ownUpdate = Object.getOwnPropertyDescriptor(realHash, 'update'); originalUpdate = realHash.update;
          realHash.update = function (value, encoding) { shadow.update(value, encoding); return originalUpdate.call(this, value, encoding); };
        }
        depth++;
        try {
          const result = original.apply(this, args);
          if (candidate) {
            candidate.expected = shadow ? shadow.digest('hex') : stream ? stream.finish(result) : fingerprint(result);
            selected.set(bucket, candidate);
          }
          return result;
        } finally {
          depth--;
          if (realHash) { if (ownUpdate) Object.defineProperty(realHash, 'update', ownUpdate); else delete realHash.update; }
        }
      } });
      restore.push(() => Object.defineProperty(prototype, method, descriptor));
    }
    compiler.hooks.thisCompilation.tap('CaptureSources', compilation => {
      compilation.hooks.afterCodeGeneration.tap('CaptureSources', () => { phase = 'render'; });
      for (const [name, stage] of [['assets', -2001], ['optimize', 399], ['devtool', 499], ['hash', 2499], ['report', 4999]]) {
        compilation.hooks.processAssets.tap({ name: `CaptureSources:${name}`, stage }, () => {
          phase = name;
          for (const asset of compilation.getAssets()) assets.set(asset.source, asset.name);
        });
      }
    });
    compiler.hooks.emit.tap('CaptureSources', () => { phase = 'emit'; });
    compiler.hooks.done.tap('CaptureSources', () => {
      for (const undo of restore.reverse()) undo();
      const cases = [...selected.entries()].map(([id, value]) => ({ id: `${this.options.mode}/${id}`, ...value, frequency: histogram.get(id) }));
      const data = { schema: 1, ...this.options, webpack: compiler.webpack.version, webpackSources: require('webpack-sources/package.json').version, hashAlgorithm, histogram: Object.fromEntries(histogram), innerHistogram: Object.fromEntries(innerHistogram), unsupported: Object.fromEntries(unsupported), trace, cases };
      mkdirSync(this.options.directory, { recursive: true });
      const file = join(this.options.directory, `${this.options.mode}.json.gz`);
      writeFileSync(file, gzipSync(JSON.stringify(data), { level: 9, mtime: 0 }));
      console.log(`[Source capture] ${trace.length} outer calls, ${cases.length} replay graphs, ${unsupported.size} unsupported categories -> ${file}`);
    });
    compiler.hooks.failed.tap('CaptureSources', () => { for (const undo of restore.reverse()) undo(); });
  }
}
module.exports = CaptureSourcesPlugin;
