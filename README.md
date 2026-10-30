# rspack-sources-js

JavaScript bindings for Rust's `rspack_sources`, powered by Node-API.

The goal is to expose source concatenation, replacement, and source map processing through a webpack-sources-compatible API, with better performance on real JavaScript workloads.

**Status: design and reference-behavior research.** No native binding has been implemented, and no performance improvement has been measured. The GitHub repository is public; the npm package is marked private to prevent publishing an unfinished package.

## Run the reference probes

Use pnpm; its version is pinned in `package.json`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run probe:reference
```

The probes use the pinned `webpack-sources@3.6.0` reference. They verify reference behavior; they do not test a binding or measure performance. The npm alias `webpack-sources-reference` keeps the reference dependency separate if an application later aliases `webpack-sources` to this package.

## Design direction

- Keep the public API, lightweight reads, mutable objects, lazy evaluation, and callback semantics in JavaScript. Batch expensive computations in Rust.
- Accumulate `add`, `replace`, and `insert` operations in JavaScript, then submit them to Rust when results are read, avoiding a Node-API call for every edit.
- Keep native Source graphs immutable. Rebuild affected snapshots when the JavaScript graph changes, while preserving webpack's separate `CachedSource` semantics.
- Compute source maps in Rust and materialize results at the JavaScript boundary. Explicitly handle UTF-16 indices, isolated surrogates, mutable Buffers, the hash protocol, and external Sources.
- Establish compatible behavior first, then enable native paths validated by differential tests and end-to-end benchmarks. Performance measurements include language-boundary conversion, graph construction, output materialization, and memory usage.
