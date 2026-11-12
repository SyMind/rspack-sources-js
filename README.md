# rspack-sources-js

JavaScript bindings for Rust's `rspack_sources`, powered by Node-API.

An initial implementation targeting the `webpack-sources@3.6.0` API. Concrete constructors bind native state immediately and call Source-specific native functions such as `rawNew`, `rawSource`, and `replaceReplace`. Rust owns the mutable graph and snapshots; TypeScript provides public classes, streaming callbacks, and compatibility algorithms.

**Experimental.** Compatibility is covered by differential tests, but end-to-end performance improvements have not been measured. The npm package remains private. Prebuilt platform packages are not available yet.

## Build and test

Requires Node.js 22 or later, pnpm (pinned in `package.json`), and a Rust toolchain with a native linker. Previous compatibility validation used macOS arm64 with Node.js 22.22.3 and Rust 1.95.0. The latest constructor and export refactor has compilation checks only; functional tests remain paused.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm test:types
```

`pnpm build` compiles `lib/` TypeScript into JavaScript and declarations under `dist/`, and produces a release library at `native/rspack_sources.node` for the current host. Use `pnpm build:debug` for a debug native library, or `pnpm build:js` to rebuild only TypeScript. `pnpm test` rebuilds TypeScript before running both test suites. Rebuild after changing Rust code; tests load the existing binary. An absent or incompatible binary produces an explicit loading error.

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
| Concrete constructors and methods | Direct Source-specific Node-API exports, implemented under `crates/binding/src/sources/` |
| `OriginalSource` | Rust computes `map()` and `sourceAndMap()` for string and Buffer inputs |
| `ConcatSource`, `ReplaceSource` | Native `map()` / `sourceAndMap()` for supported graphs |
| `SourceMapSource` | Native composition in supported graphs; direct maps preserve JS object identity |
| Source state | Native values and caches; internal JS members use `#` private methods and accessors |
| `CachedSource`, `PrefixSource`, `SizeOnlySource`, `CompatSource` | Native state and typed entry points, with remaining JS compatibility operations |
| `streamChunks()` | Local TypeScript algorithms; callbacks stay in JS |
| Unsupported graphs or options | JS compatibility path |

The public classes, streaming helpers, and compatibility paths are implemented in this repository's `lib/` TypeScript sources, migrated from `webpack-sources@3.6.0`. The package has no npm runtime dependencies. Upstream `webpack-sources@3.6.0` is a development dependency used only by independent differential tests and reference probes. Attribution and the upstream MIT license are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Rust crate is vendored in [crates/rspack_sources](crates/rspack_sources) and builds without a separate Rspack checkout.

Each concrete constructor creates a stable native node, with an initial `SourceRef` snapshot where supported. Each JS `ConcatSource` wraps one mutable Rust `ConcatSource`. Its constructor, `add`, and `addAllSkipOptimizing` accept strings and native-bound Sources. Wrap a custom source in `new CompatSource(sourceLike)`. Each `getChildren()` call returns a fresh array containing the original child objects. Use `add` or `addAllSkipOptimizing` to change the child list. Edits enter Rust immediately. Native reads validate dependencies, reuse unchanged snapshots, and rebuild affected nodes. Composite sources call the JS streaming helper when their bindings return `undefined`. `nativeContext.ts` keeps JS references visible to V8. Streaming and other JS algorithms live in their respective Source classes. `CachedSource` reads cached text, size and source maps from Rust. The cache can serve the finished source map directly.

Replacement ranges are translated from UTF-16 indices to Rust byte offsets. Composite graphs with isolated surrogates, split surrogate pairs, overlapping or unsupported edit ranges, Buffer-backed/exposed Buffer states, or custom Sources use the JS compatibility path. Native computations use bound state; overriding JS `streamChunks()` does not reroute native maps. Source maps with missing/empty content slots, extensions, or unverified input shapes also use JS. Private webpack-sources fields and private module imports are outside the compatibility target.

## Validation and remaining work

The tests compare strings, buffers, sizes, exact maps and serialization, hashes, streaming events, mutations, caches, CJS/ESM imports, and Worker lifetimes. Native-path assertions prevent supported fixtures from passing solely through fallback. `pnpm probe:reference` runs the separate reference-behavior probes.

`pnpm test` runs both the local regression tests (`pnpm test:local`) and the adapted webpack-sources test suite at `b501a3a` (`pnpm test:webpack-sources`). The suite excludes the optional source-map scopes proposal and covers four original snapshots, fixtures, mapping validation, helper tests, cache behavior, and Source combinations up to four layers. Source classes load through this package; helper tests and mapping instrumentation load this repository's compiled helpers from `dist/`. Migration provenance and import adaptations are recorded in [test/webpack-sources/UPSTREAM.md](test/webpack-sources/UPSTREAM.md).

This version prioritizes a working ownership model and compatible results. Graph validation still traverses reachable nodes; JS inputs and Rust snapshots can coexist in memory. Native `sourceAndMap()` currently performs separate source and map traversals. Native allocation accounting, performance measurement, Linux/Windows validation, and platform-package distribution remain future work. Fewer boundary calls alone are not evidence of a speedup.

`pnpm pack` includes the locally built binary for the current platform. It does not create a portable, multi-platform distribution.

## Benchmarks from an official Ant Design example

The benchmark captures actual webpack builds of the Button/DatePicker application from the pinned official `ant-design-examples` repository. It replays the observed Source graphs, replacement ranges, buffers, caches, API calls, and options against both implementations. The application source is unchanged; a fixed webpack adapter replaces the example's original Rsbuild configuration.

```sh
pnpm bench:test
pnpm bench:validate
pnpm bench:list
pnpm bench:simulation --implementation=webpack --valid-only
pnpm bench:simulation --implementation=rspack --valid-only
```

The last recorded replay reproduced all 20 captured upstream operations; this implementation matched 19 before the constructor refactor. The current refactor has been compiled but has not rerun tests or replay. The remaining production JavaScript map differs, so validation fails and measurements require an explicit `--valid-only` exclusion on both sides. Measurements cover individual observed operations with graph rehydration excluded. They do not establish end-to-end build speedups. See the [CodSpeed results](benchmark/RESULTS.md) for measurements and their limits.

The [CodSpeed workflow](.github/workflows/codspeed.yml) builds and tests on Linux, then records both implementations with distinct benchmark names in one simulation report. CI verifies the exact known mismatch with `pnpm bench:validate:ci`; any new or changed failure stops the job. Fixed cases automatically return to the measured set. Public repository uploads use GitHub OIDC; `CODSPEED_TOKEN` is optional. The repository must be enabled in CodSpeed for uploads.

`pnpm bench:raw:simulation --variant=generic` and `--variant=raw-new` compare the generic and dedicated RawSource constructor entries using the same Rust backend. Use `bench:raw:walltime` for normal-JIT measurements. Both native-entry and complete-constructor costs are covered; see the [methodology and measured limits](benchmark/RAW_CONSTRUCTOR.md). Build this isolated historical control with `RSPACK_SOURCES_FEATURES=benchmark-legacy-api pnpm build`. Production constructors use typed exports; the default build excludes the generic benchmark control. The recorded results predate this refactor.
