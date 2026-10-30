# rspack-sources-js

JavaScript bindings for Rust's `rspack_sources`, powered by Node-API.

An initial implementation targeting the `webpack-sources@3.6.0` API. Eligible `map()` and `sourceAndMap()` computations run in Rust; JavaScript retains mutable objects, lightweight reads, caching, hashing, and streaming callbacks.

**Experimental.** Compatibility is covered by differential tests, but end-to-end performance improvements have not been measured. The npm package remains private. Prebuilt platform packages are not available yet.

## Build and test

Requires Node.js 22 or later, pnpm (pinned in `package.json`), and a Rust toolchain with a native linker. The implementation is currently validated on macOS arm64 with Node.js 22.22.3 and Rust 1.95.0.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm test:types
```

`pnpm build` produces a release library at `native/rspack_sources.node` for the current host. Use `pnpm build:debug` for development. Rebuild after changing Rust code; tests load the existing binary. An absent or incompatible binary produces an explicit loading error.

```js
const { OriginalSource, ReplaceSource, ConcatSource } = require('rspack-sources-js');

const edited = new ReplaceSource(
  new OriginalSource('const answer = 1;\n', 'input.js'),
);
edited.replace(15, 15, '42'); // UTF-16 indices, inclusive end.
const output = new ConcatSource('// generated\n', edited);
console.log(output.sourceAndMap());

edited.insert(0, '/* updated */\n');
console.log(output.sourceAndMap()); // Rebuilds the affected native snapshots.
```

ESM named exports and TypeScript declarations are included.

## Execution paths

| API or source | Current implementation |
| --- | --- |
| `OriginalSource`, `ConcatSource`, `ReplaceSource` | Native `map()` / `sourceAndMap()` for supported graphs |
| `SourceMapSource` | Native composition in supported graphs; direct maps remain in JS to preserve identity |
| `streamChunks()` | JS implementation and JS callback loop; no Rust callback bridge |
| `source()`, `buffer()`, `buffers()`, `size()`, `updateHash()` | JS |
| `RawSource`, `CachedSource`, `PrefixSource`, `SizeOnlySource`, `CompatSource` | JS classes; string RawSource leaves can participate in native graphs |
| Unsupported graphs or options | JS compatibility path |

The pinned runtime dependency `webpack-sources-reference` is an npm alias for `webpack-sources@3.6.0`. It supplies the JS behavior layer and fallback implementation. Rust uses the published `rspack_sources@0.103.0`; no local Rspack checkout is needed.

Native snapshots hold `BoxSource` (`Arc<dyn Source>`). Edits accumulate in JS without per-edit native calls. On a native read, the planner validates the reachable graph, reuses unchanged snapshots, and compiles changed nodes in one batch. The first read uses a compilation call followed by a read call. Later reads reuse handles when possible. A modified child rebuilds its affected ancestors; existing native snapshots remain immutable. `CachedSource` retains its separate, explicit webpack caching behavior.

Replacement ranges are translated from UTF-16 indices to Rust byte offsets. Isolated surrogates, split surrogate pairs, overlapping or unsupported edit ranges, Buffer-backed/exposed Buffer states, custom Sources, method overrides, and scopes use the JS path. Source maps with missing/empty content slots, extensions, or unverified input shapes also use JS. Private webpack-sources fields and private module imports are outside the compatibility target.

## Validation and remaining work

The tests compare strings, buffers, sizes, exact maps and serialization, hashes, streaming events, mutations, caches, CJS/ESM imports, and Worker lifetimes. Native-path assertions prevent supported fixtures from passing solely through fallback. `pnpm probe:reference` runs the separate reference-behavior probes.

This version prioritizes a working ownership model and compatible results. Graph validation still traverses reachable nodes; JS inputs and Rust snapshots can coexist in memory. Native `sourceAndMap()` currently performs separate source and map traversals. Native allocation accounting, performance measurement, Linux/Windows validation, and platform-package distribution remain future work. Fewer boundary calls alone are not evidence of a speedup.

`pnpm pack` includes the locally built binary for the current platform. It does not create a portable, multi-platform distribution.
