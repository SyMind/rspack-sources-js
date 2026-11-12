# webpack-sources 测试迁移

## 来源与范围

- 当前测试基线为 webpack/webpack-sources 的 `b501a3a172bce3f8424ae99838fdede806407fb2`。[上游 test/](https://github.com/webpack/webpack-sources/tree/b501a3a172bce3f8424ae99838fdede806407fb2/test)
- 初次迁移基于 v3.6.0（`4f49c304ef1b105f52dac6f630ab9d90b0c48088`）。两次提交之间的测试增量涉及三个文件。`SourceMapSource.js` 新增空字符串内容在直接映射和组合映射中的断言，`sourceMap.js` 新增七项 `originalPositionFor()` 用例，`package-entry.js` 检查 `util.sourceMap` 的导出身份与方法。
- 该提交的上游 `test/` 有 25 个文件。本地同步其中 15 个测试文件、4 份 snapshots、2 个 fixtures 和 3 个 helpers。上游的 `scopes.js` 按下文的项目约定排除。测试资产沿用上游 [MIT 许可](LICENSE)。
- snapshots 和 fixtures 保持原始字节；未重新生成 snapshots。
- 保留 `helpers/jest-node-test.js` 作为上游测试资产；本项目使用 Node.js 22 的 `node:test`，无需安装 Jest 或启用兼容适配器。

## 入口适配

适配模块路径和内部状态检查入口，保留用例、断言目标和生成组合的逻辑：

1. 上游包入口 `require("../")` 改为本项目根入口 `require("../..")`。
2. 上游私有 Source 模块导入改为本项目公开的同名 Source 导出，包含 `Fuzzy.js` 中的所有组合。
3. `package-entry.js` 原本比较包入口与私有 Source 模块；本项目未提供这些私有模块，因此改为比较根入口与包的自引用 `require("rspack-sources-js")`，检查 `main` / `exports` 的解析与重复读取身份。
4. helper 导入及相关 JSDoc 类型路径改为本项目的 `dist/...`。测试直接覆盖 `lib/` TypeScript 编译出的本地实现；helper 单元测试的通过不代表 Rust 内部 helpers 已被直接测试。
5. `helpers/validate-mappings.js` 通过 `--require` 在测试加载前替换同一 JS mappings writer，保留上游的逐项映射校验。Rust 生成的映射仍由各用例的预期值、原始快照、SourceMapConsumer 和 sourcemap-validator 校验。
6. 部分 Rust 缓存仍通过 `test/native-internals.cjs` 检查。CachedSource 的 map 和 hash 用例通过原始 Source 的调用次数、构造器传入的 Map 和 `updateHash()` 的输出验证缓存行为。ReplaceSource 的包装对象身份通过公开 `original()` 检查。下文通过记录属于此前版本。

7. RawSource / OriginalSource 的 `updateHash` 按指定 checkout 调用 `this.buffer()`。对应断言检查 hash 收到的 Buffer、更新顺序及双缓存策略。CachedSource 的 hash 快照单独跟随 b501a3a。首次回放保留字符串与 Buffer 的分段，getCachedData 将字符串就地转为 Buffer，后续导出复用同一数组。构造器仍接受旧的混合记录。[Raw / Original 哈希基线](https://github.com/webpack/webpack-sources/blob/1aa76ca9743cb630e00a0077a18030239126086c/lib/OriginalSource.js#L251) · [CachedSource 的 hash 导出](https://github.com/webpack/webpack-sources/blob/b501a3a172bce3f8424ae99838fdede806407fb2/lib/CachedSource.js#L70)

8. 本项目不实现 source map scopes 提案；移除 scopes.js。流式选项只保留 columns 和 finalSource；onSource 只返回索引、名称与内容。下文的全量通过记录为此前版本。

9. ConcatSource 只接受字符串和已绑定的 Source。上游用例里的自定义子对象显式包装为 CompatSource。

10. CachedSource 的 `sourceAndMap()` 分别读取 source 和 map。冷缓存用例相应检查两个底层方法各调用一次，并保留返回原 Buffer 的身份断言。

开发依赖 `source-map@0.8.0`、`sourcemap-validator@2.1.0`、`webpack@5.111.1` 沿用初次迁移时的锁定版本；webpack 仅提供上游测试使用的 hash 实现。依赖统一由 pnpm 管理，不引入其他包管理器的锁文件。

## 执行与验证

本次同步已核对三个文件的上游增量、四份快照和两个 fixtures 的字节，并通过三个测试文件的 JavaScript 语法检查。按项目约定暂停执行测试。当前包缺少 `util.sourceMap.originalPositionFor()` 和相应的编译后 helper，`sourceMap.js` 会在加载时失败，`package-entry.js` 的新增导出检查也会失败。

```sh
pnpm build
pnpm test                 # 本项目回归测试 + 已迁入的上游测试
pnpm test:local           # 本项目回归与运行时隔离测试
pnpm test:webpack-sources # 已迁入的上游测试
pnpm test:types
```

以下执行结果对应初次迁移的 v3.6.0 测试集。

2026-11-10，macOS arm64、Node.js 22.22.3：迁移后的上游测试首次完整执行为 89,977 项通过、3,304 个 suites，失败、取消、跳过、TODO 均为 0。最初的测试迁移未修改生产实现；随后按用户要求将生产实现迁为本地 TypeScript，见下文。该结果仅覆盖固定版本、当前平台和现有 JS / Rust 执行路径，不构成性能或其他平台的验证。

最终验证：`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm build`、`pnpm test`、`pnpm test:types` 全部通过。统一测试命令在重新构建的 release binary 上执行，包含 54 项本项目回归测试与 89,977 项上游测试，合计 90,031 项。

需要定位失败时，可运行单个文件并选择详细报告：

```sh
pnpm exec node --require ./test/webpack-sources/helpers/validate-mappings.js \
  --test --test-reporter=spec test/webpack-sources/ReplaceSource.js
```

## 本地 TypeScript 实现

`lib/` 现已直接包含从 v3.6.0 迁入的 Source 类和全部流式 helpers，并保留原有 Rust 快照加速。`tsconfig.json` 启用 `strict`，通过 `tsc` 生成 `dist/` 的 CJS / ESM 入口与声明文件。上游测试、mapping writer 校验均加载这些本地编译产物。

包已移除原来的参考实现别名及所有 npm 运行时依赖；开发依赖 `webpack-sources@3.6.0` 仅供 `test/sources.test.cjs` 的独立差分对照和 `probe:reference` 使用。原先比较本包与参考包的 `Replacement` 构造器身份断言，改为比较本包与本地模块，避免将两个独立实现错误要求为同一函数对象。上游用例、snapshots 和 fixtures 均未删减或重写。

本地 TypeScript 迁移验证：`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm build`、`pnpm test`、`pnpm test:types`、`pnpm probe:reference` 通过。当时为 55 项本地测试 + 89,977 项上游测试，合计 90,032 项。新增隔离测试验证流式读取与原生 map 不会加载上游包；原始 snapshots / fixtures 仍逐字节一致。

`pnpm pack` 的产物在独立临时项目通过 `pnpm install --prod --ignore-scripts` 安装，仅安装本包，未安装任何上游 Source 包。CJS / ESM 导入、Unicode 原生映射、JS 流式回调、scopes 和两种模块的类型声明消费均通过。包包含编译产物与第三方许可声明，未包含本地 docs/ 或 AGENTS.md。验证平台仍仅为 macOS arm64 / Node.js 22.22.3，未测量性能。
