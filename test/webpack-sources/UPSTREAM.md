# webpack-sources 测试迁移

## 来源与范围

- 上游：[webpack/webpack-sources v3.6.0](https://github.com/webpack/webpack-sources/tree/v3.6.0/test)。
- 固定提交：`4f49c304ef1b105f52dac6f630ab9d90b0c48088`。
- 与本项目的 `webpack-sources@3.6.0` 兼容目标一致；本次不包含 3.7.0 的版本升级。
- 完整复制上游 `test/` 的 24 个文件：15 个测试文件、4 份 snapshots、2 个 fixtures、3 个 helpers。保留上游 MIT 声明，见 [LICENSE](LICENSE)。
- snapshots 和 fixtures 保持原始字节；未删除、跳过或减少测试，未重新生成 snapshots。
- 保留 `helpers/jest-node-test.js` 作为上游测试资产；本项目使用 Node.js 22 的 `node:test`，无需安装 Jest 或启用兼容适配器。

## 入口适配

仅适配模块路径，保留用例、断言和生成组合的逻辑：

1. 上游包入口 `require("../")` 改为本项目根入口 `require("../..")`。
2. 上游私有 Source 模块导入改为本项目公开的同名 Source 导出，包含 `Fuzzy.js` 中的所有组合。
3. `package-entry.js` 原本比较包入口与私有 Source 模块；本项目未提供这些私有模块，因此改为比较根入口与包的自引用 `require("rspack-sources-js")`，检查 `main` / `exports` 的解析与重复读取身份。
4. helper 导入及相关 JSDoc 类型路径改为本项目的 `dist/...`。测试直接覆盖 `lib/` TypeScript 编译出的本地实现；helper 单元测试的通过不代表 Rust 内部 helpers 已被直接测试。
5. `helpers/validate-mappings.js` 通过 `--require` 在测试加载前替换同一 JS mappings writer，保留上游的逐项映射校验。Rust 生成的映射仍由各用例的预期值、原始快照、SourceMapConsumer 和 sourcemap-validator 校验。

开发依赖 `source-map@0.8.0`、`sourcemap-validator@2.1.0`、`webpack@5.111.1` 与该上游提交的 `package-lock.json` 解析版本一致；webpack 仅提供上游测试使用的 hash 实现。依赖统一由 pnpm 管理，不引入其他包管理器的锁文件。

## 执行与验证

```sh
pnpm build
pnpm test                 # 本项目回归测试 + 完整上游测试集
pnpm test:local           # 55 项本项目回归与运行时隔离测试
pnpm test:webpack-sources # 89,977 项上游测试
pnpm test:types
```

2026-11-10，macOS arm64、Node.js 22.22.3：迁移后的上游测试首次完整执行为 89,977 项通过、3,304 个 suites，失败、取消、跳过、TODO 均为 0。最初的测试迁移未修改生产实现；随后按用户要求将生产实现迁为本地 TypeScript，见下文。该结果仅覆盖固定版本、当前平台和现有 JS / Rust 执行路径，不构成性能或其他平台的验证。

最终验证：`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm build`、`pnpm test`、`pnpm test:types` 全部通过。统一测试命令在重新构建的 release binary 上执行，包含 54 项本项目回归测试与 89,977 项上游测试，合计 90,031 项。

需要定位失败时，可运行单个文件并选择详细报告：

```sh
pnpm exec node --require ./test/webpack-sources/helpers/validate-mappings.js \
  --test --test-reporter=spec test/webpack-sources/ReplaceSource.js
```

## 本地 TypeScript 实现

`lib/` 现已直接包含从同一上游提交迁入的 Source 类和全部流式 helpers，并保留原有 Rust 快照加速。`tsconfig.json` 启用 `strict`，通过 `tsc` 生成 `dist/` 的 CJS / ESM 入口与声明文件。上游测试、mapping writer 校验均加载这些本地编译产物。

包已移除原来的参考实现别名及所有 npm 运行时依赖；开发依赖 `webpack-sources@3.6.0` 仅供 `test/sources.test.cjs` 的独立差分对照和 `probe:reference` 使用。原先比较本包与参考包的 `Replacement` 构造器身份断言，改为比较本包与本地模块，避免将两个独立实现错误要求为同一函数对象。上游用例、snapshots 和 fixtures 均未删减或重写。

本地 TypeScript 迁移验证：`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm build`、`pnpm test`、`pnpm test:types`、`pnpm probe:reference` 通过。当前测试为 55 项本地测试 + 89,977 项上游测试，合计 90,032 项。新增隔离测试验证流式读取与原生 map 不会加载上游包；原始 snapshots / fixtures 仍逐字节一致。

`pnpm pack` 的产物在独立临时项目通过 `pnpm install --prod --ignore-scripts` 安装，仅安装本包，未安装任何上游 Source 包。CJS / ESM 导入、Unicode 原生映射、JS 流式回调、scopes 和两种模块的类型声明消费均通过。包包含编译产物与第三方许可声明，未包含本地 docs/ 或 AGENTS.md。验证平台仍仅为 macOS arm64 / Node.js 22.22.3，未测量性能。
