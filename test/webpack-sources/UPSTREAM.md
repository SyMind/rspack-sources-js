# webpack-sources 测试迁移

## 来源与范围

- 上游：[webpack/webpack-sources v3.6.0](https://github.com/webpack/webpack-sources/tree/v3.6.0/test)。
- 固定提交：`4f49c304ef1b105f52dac6f630ab9d90b0c48088`。
- 与本项目的 `webpack-sources-reference@npm:webpack-sources@3.6.0` 兼容目标一致；本次不包含 3.7.0 的版本升级。
- 完整复制上游 `test/` 的 24 个文件：15 个测试文件、4 份 snapshots、2 个 fixtures、3 个 helpers。保留上游 MIT 声明，见 [LICENSE](LICENSE)。
- snapshots 和 fixtures 保持原始字节；未删除、跳过或减少测试，未重新生成 snapshots。
- 保留 `helpers/jest-node-test.js` 作为上游测试资产；本项目使用 Node.js 22 的 `node:test`，无需安装 Jest 或启用兼容适配器。

## 入口适配

仅适配模块路径，保留用例、断言和生成组合的逻辑：

1. 上游包入口 `require("../")` 改为本项目根入口 `require("../..")`。
2. 上游私有 Source 模块导入改为本项目公开的同名 Source 导出，包含 `Fuzzy.js` 中的所有组合。
3. `package-entry.js` 原本比较包入口与私有 Source 模块；本项目未提供这些私有模块，因此改为比较根入口与包的自引用 `require("rspack-sources-js")`，检查 `main` / `exports` 的解析与重复读取身份。
4. helper 导入及相关 JSDoc 类型路径改为 `webpack-sources-reference/lib/...`。这些 helpers 正是本项目 JS 行为层复用的实现；helper 单元测试的通过不代表 Rust 内部 helpers 已被直接测试。
5. `helpers/validate-mappings.js` 通过 `--require` 在测试加载前替换同一 JS mappings writer，保留上游的逐项映射校验。Rust 生成的映射仍由各用例的预期值、原始快照、SourceMapConsumer 和 sourcemap-validator 校验。

开发依赖 `source-map@0.8.0`、`sourcemap-validator@2.1.0`、`webpack@5.111.1` 与该上游提交的 `package-lock.json` 解析版本一致；webpack 仅提供上游测试使用的 hash 实现。依赖统一由 pnpm 管理，不引入其他包管理器的锁文件。

## 执行与验证

```sh
pnpm build
pnpm test                 # 本项目回归测试 + 完整上游测试集
pnpm test:local           # 54 项本项目回归测试
pnpm test:webpack-sources # 89,977 项上游测试
pnpm test:types
```

2026-11-10，macOS arm64、Node.js 22.22.3：迁移后的上游测试首次完整执行为 89,977 项通过、3,304 个 suites，失败、取消、跳过、TODO 均为 0。未因迁移修改生产实现。该结果仅覆盖固定版本、当前平台和现有 JS / Rust 执行路径，不构成性能或其他平台的验证。

最终验证：`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm build`、`pnpm test`、`pnpm test:types` 全部通过。统一测试命令在重新构建的 release binary 上执行，包含 54 项本项目回归测试与 89,977 项上游测试，合计 90,031 项。

需要定位失败时，可运行单个文件并选择详细报告：

```sh
pnpm exec node --require ./test/webpack-sources/helpers/validate-mappings.js \
  --test --test-reporter=spec test/webpack-sources/ReplaceSource.js
```
