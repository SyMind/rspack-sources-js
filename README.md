# rspack-sources-js

JavaScript bindings for Rust's `rspack_sources`, powered by Node-API.

An initial implementation targeting the `webpack-sources@3.6.0` API. Concrete constructors bind native state immediately and call Source-specific native functions such as `rawNew`, `rawSource`, and `replaceReplace`. Rust owns each Source and its shared children. TypeScript provides the public classes, retains child wrappers and implements the webpack hash update protocol.

**Experimental.** The differential suite tracks compatibility with webpack-sources. The current native implementation has been build-checked; behavioral parity and end-to-end performance are unverified. The npm package remains private. Prebuilt platform packages are not available yet.

## Build and test

Requires Node.js 22 or later, pnpm (pinned in `package.json`), and a Rust toolchain with a native linker. Previous compatibility validation used macOS arm64 with Node.js 22.22.3 and Rust 1.95.0.

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
edited.insert(0, '/* updated */\n');
const output = new ConcatSource('// generated\n', edited);
console.log(output.sourceAndMap());

// Calling edited.insert() here would throw while output holds edited.
```

ESM named exports and TypeScript declarations are included.

## Execution paths

Each concrete JS constructor attaches its own Rust binding to the receiver with one `napi_wrap`. The binding holds a `SourceRef`. Composite sources share those references, and JS parents keep their original child wrappers alive. Accessors such as `original()` return that JS object.

Content, buffers, byte sizes and maps come from the bound Rust source. For example, `CachedSource.size()` calls Rust's `CachedSource::size()`, and the Rust source owns the cache. `sourceAndMap()` calls the source and map methods in one native entry. Map objects returned to JS are independent values. The supported map option is `columns`. JS `streamChunks()` is unsupported.

**Treat every Buffer returned by a Source or passed to a hash callback as read-only.** These are ordinary Node.js Buffers. JavaScript does not enforce write protection, and the bytes may point directly into a Rust string or byte allocation. Writing to them can cause data races, corrupt source data, or crash the process. This also applies to `buf.slice()`, `buf.subarray()`, and views over `buf.buffer`, which share the same memory. Use `Buffer.from(buf)` to make a writable copy before modifying the bytes or passing them to an API that writes into its input. The backing store keeps the native source alive until its last borrowed view is collected.

`ConcatSource` takes strings and bound Sources. Rust flattens nested concats on ordinary append and retains them on `addAllSkipOptimizing()`. `getChildren()` returns a fresh array. Child objects retain their JS identity, and merged string literals are returned as new `RawSource` objects. Wrap an external Source-like in `CompatSource` to capture its content and optional map at construction. If the input provides `buffer()`, the adapter snapshots its bytes.

`ReplaceSource` stores edits in Rust. The binding converts JS UTF-16 indices and inclusive ends to UTF-8 byte ranges in the original text. Edits must use integer character boundaries. `getReplacements()` returns a sorted snapshot. Finish editing before sharing a source with a parent. Replace and Concat edits require exclusive ownership and throw while another Rust owner holds the node.

`SourceMapSource` parses its map inputs at construction. Its map and buffer accessors serialize the fields represented by the Rust source. The vendored crate builds without a separate Rspack checkout. Attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Validation and remaining work

The tests compare strings, buffers, sizes, exact maps and serialization, hashes, mutations, caches, CJS/ESM imports, and Worker lifetimes. `pnpm probe:reference` runs the separate reference-behavior probes.

`pnpm test` runs both the local regression tests (`pnpm test:local`) and the adapted webpack-sources test suite at `b501a3a` (`pnpm test:webpack-sources`). The suite excludes the optional source-map scopes proposal and covers four original snapshots, fixtures, mapping validation, helper tests, cache behavior, and Source combinations up to four layers. Source classes load through this package; helper tests and mapping instrumentation load this repository's compiled helpers from `dist/`. Migration provenance and import adaptations are recorded in [test/webpack-sources/UPSTREAM.md](test/webpack-sources/UPSTREAM.md).

The native binding refactor has been checked with a release build, Clippy and TypeScript. Behavioral tests and benchmarks are paused. Earlier suite and benchmark results apply to their recorded revisions.

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

The replay compares captured webpack outputs against both implementations. The historical macOS arm64 run matched 20 operations. The current replay adapter warms Rust caches from recorded reads. Measurements cover individual observed operations with graph rehydration excluded. They do not establish end-to-end build speedups. See the [CodSpeed results](benchmark/RESULTS.md) for measurements and their limits.

The [CodSpeed workflow](.github/workflows/codspeed.yml) builds and tests on Linux, then records both implementations with distinct benchmark names in one simulation report. CI checks the captured outputs with `pnpm bench:validate:ci`. Fixed cases automatically return to the measured set. Public repository uploads use GitHub OIDC; `CODSPEED_TOKEN` is optional. The repository must be enabled in CodSpeed for uploads.

`pnpm bench:raw:simulation` measures the current `rawNew` native entry and the complete `RawSource` constructor. Use `pnpm bench:raw:walltime` for normal-JIT measurements. Build with `pnpm build` first. The [historical comparison and measured limits](benchmark/RAW_CONSTRUCTOR.md) describe the earlier generic-entry experiment.
