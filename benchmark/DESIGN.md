# Ant Design 官方示例的 Source 图回放基准

本基准先捕获真实 webpack 构建中的 Source 对象图和调用，再用相同的图、源码、替换位置、缓存状态与参数比较 webpack-sources 和 rspack-sources-js。后者包含本仓库的 JS 兼容层、planner、Node-API 和 rspack_sources；结果不是单独的 Rust crate 测量。

## 输入与版本

- 官方仓库：[ant-design/ant-design-examples](https://github.com/ant-design/ant-design-examples/tree/447d77affd96d7e0d841683cdc4314f6fc22d71c/examples/rsbuild-normal)，固定提交 `447d77affd96d7e0d841683cdc4314f6fc22d71c`。
- 原样使用 `examples/rsbuild-normal/src`，包含 Button、DatePicker、React.StrictMode 和 reset.css。该示例原来的构建器是 Rsbuild；本基准提供固定的 webpack 适配配置，不能称为官方 webpack 配置。
- antd 5.19.2、React / React DOM 18.3.1；完整应用依赖固定在 `fixtures/antd-official/app-pnpm-lock.yaml`。应用源码不含额外的 benchmark 专用组件。
- webpack 5.111.1、webpack-sources 3.6.0、rspack_sources 0.103.0；主仓库 pnpm 11.10.0。
- 两种 mode 均启用 `devtool: 'source-map'`、关闭 webpack cache、使用 xxhash64 和确定的 module/chunk IDs；应用 TSX 用 TypeScript 6.0.2 转译，CSS 使用 webpack 原生实验性 CSS 支持。production 保留 webpack 默认压缩行为。

## 捕获方法与校验

`CaptureSourcesPlugin` 包装当前 compiler 使用的 webpack-sources 原型方法；在真实调用前读取 own data descriptors，在调用后记录结果指纹。捕获过程不主动调用 source/map、getter、getChildren、getCachedData 或懒工厂。阶段名称来自 afterCodeGeneration、processAssets 的固定 stage 与 emit 钩子，是采样标签。

记录每一次最外层调用的顺序、rootId、阶段、类型、API、参数和已知 asset 名；递归进入其他 Source 的调用单独统计，避免重复当成 webpack 入口调用。每个 mode/阶段/Source 类型/API 类别只保留估算输入最大的代表图。summary 中 observedCalls 是整个类别的次数，不是这个具体代表图被调用的次数。

图编码保存 Source 类型、源码及 map 数据、ReplaceSource edits、Buffer、Map、缓存字段、属性描述符和缺失/undefined 的区别。引用 ID 保留共享 Source 与数据对象身份；dense array 回放保持 packed array，避免人为制造 holey array。无法还原的函数、未解析懒工厂、accessor 或未知类明确拒绝，不转成 RawSource。

回放用各实现的公开构造器建立对象，再恢复捕获到的 JS 私有字段和缓存。输入限定 webpack-sources 3.6.0，不承诺跨上游版本兼容。没有序列化 Rust 原生 handle；第一次读取包含需要的 planner 校验、原生编译、跨边界调用和结果物化。

每个 mode 先运行无插桩 control build，再运行捕获 build；所有 JS/CSS/map 产物的 SHA-256 完全相同。随后每个代表图必须先在上游回放并匹配实际构建指纹，再与当前实现逐字节比较。updateHash 使用相同 webpack xxhash64，捕获只影子记录该 Source 贡献的 update 序列，不包含调用者此前的 hash 状态。

## 已观察到的结构

| 构建 | compilation.modules.size | 最外层调用 | 内部调用 | 代表图 |
| --- | ---: | ---: | ---: | ---: |
| development | 442 | 871 | 6,198 | 8 |
| production | 441 | 1,295 | 3,860 | 12 |

没有不支持的捕获类别。代表图内没有共享 Source 节点；编码器支持 DAG，但不人为加入共享节点。完整类型计数、缓存字段数与调用频率见 `fixtures/antd-official/summary.json`，构建产物校验见 `builds.json`。

| 真实调用位置 | Source 节点 | 非 undefined 缓存字段 | 当前执行路径 |
| --- | ---: | ---: | --- |
| development，app.js，devtool/CachedSource.sourceAndMap | 3,704 | 0 | JS fallback |
| production，app.js，optimize/CachedSource.sourceAndMap | 1,689 | 405 | JS fallback |
| production，app.js，devtool/ConcatSource.sourceAndMap | 2 | 0 | Native，输出不一致，禁止纳入对照 |
| production，app.css，devtool/SourceMapSource.sourceAndMap | 1 | 0 | Native，输出一致 |

开发图包括 CachedSource 1,236、ConcatSource 1,219、RawSource 412、ReplaceSource 412、OriginalSource 420、SourceMapSource 2 和 PrefixSource 3。生产压缩前的图包括 CachedSource 415、ConcatSource 33、ReplaceSource 802、OriginalSource 412、RawSource 22、SourceMapSource 2 和 PrefixSource 3。实际嵌套包括缓存包装、拼接、模块替换、前缀和原始模块，不能用一个巨大 RawSource 代替。

20 个代表图均可在 webpack-sources 回放成原始构建结果；当前实现匹配 19 个。失败的生产 app.js 图 source 一致（505,352 个 UTF-16 code units），但 map.mappings 少 54 个字符；首次差异在 mappings 偏移 10,128（从 0 开始）。该图 nativeReads=1，fallbacks=0。默认 benchmark 因差分失败退出；只有显式传入 `--valid-only` 才会在双方相同地排除失败图，并打印其 ID。没有在本轮修改生产实现来掩盖该差异。

本样本实际外层 API 为 source、sourceAndMap、buffer 和 updateHash。没有外层 map/streamChunks/size 调用，因此没有人为补充这些性能场景。模块级 OriginalSource.source/updateHash 在两种 mode 中各观察到 430 次；其成本与 SourceMapDevToolPlugin 的整图调用分开报告。

## 测量边界

每次样本在计时外重建捕获的调用前状态，再在计时内执行一个真实 API。walltime 使用 8 次 warmup、64 次样本；simulation 使用 CodSpeed plugin 的预热与单次 CPU 模拟。消费返回值，但不在计时区域内做指纹计算。只比较相同 URI、相同 fixture、相同模式和平台的两次运行。

updateHash 场景在计时内创建全新的 webpack xxhash64、执行 Source.updateHash 并 digest；两端一致，包含哈希上下文的初始化与最终物化成本。它不重建原调用者此前的 hash 前缀，也不是 updateHash 方法自身的纯函数耗时。

计时不包含图重建、webpack 编译、loader、文件系统或整个应用构建。每次样本的 native handles 是冷的；不会把后一次读取缓存的结果当成第一次转换。它也不是 Source 构造器性能、完整调用序列、内存或 RSS 测量。JS 缓存按真实调用前状态恢复，但无法恢复原构建的 V8 string storage、JIT 历史、全局 GC 状态或不同 Buffer view 的底层 ArrayBuffer 共享。

每个类别仅选最大输入，不能用 observedCalls 乘代表时间后相加得到整次构建耗时，也不报告这些类别的汇总“整体加速”。若需要端到端收益，应在兼容性问题修复后单独替换 webpack 的 Source 实现测量。

## 执行

首次安装和构建：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm bench:test
pnpm bench:validate
pnpm bench:list
```

当前 `bench:validate` 应报告 19/20 并以非零状态退出，保留上述真实差异。已有捕获 fixtures 的回放不需要联网或安装示例应用；重新捕获需要：

```sh
pnpm bench:prepare-app
pnpm bench:capture
pnpm bench:analyze
pnpm bench:validate
```

`bench:capture --mode=development` 可单独捕获一个 mode；builds.json 只记录本次命令的 mode。不要用 `--no-control-build` 产生的数据声称已经通过 control 校验。

通过 CodSpeed CLI 测量：

```sh
pnpm bench:simulation --implementation=webpack --valid-only
pnpm bench:simulation --implementation=rspack --valid-only
pnpm bench:walltime --implementation=webpack --valid-only
pnpm bench:walltime --implementation=rspack --valid-only
```

可加 `--filter=sourceAndMap` 或 `--mode=production`。脚本拒绝在 CodSpeed 外产生性能数字。simulation 禁用 JIT 优化以满足 Node 模拟要求，使用 `--disable-wasm-trap-handler` 避免 Valgrind 下 xxhash64 的 Wasm 地址空间预留失败；两端使用同样参数。simulation 的相对值不能代替正常 JIT 的 walltime 结果。

本机 macOS 的已有 `codspeed-linux` 环境共享源码目录，而 Linux native 编译会覆盖宿主机 .node，因此先创建独立的源码快照：

```sh
pnpm bench:prepare-linux
BENCH_WORKSPACE="$(cat .bench/linux-workspace)"
CODSPEED_WORKSPACE="$BENCH_WORKSPACE" codspeed-linux bash -lc 'pnpm install --frozen-lockfile --ignore-scripts && CARGO_PROFILE_RELEASE_DEBUG=1 pnpm build'
CODSPEED_WORKSPACE="$BENCH_WORKSPACE" codspeed-linux env CODSPEED_REPOSITORY=web-infra-dev/rspack pnpm bench:simulation --implementation=webpack --valid-only
CODSPEED_WORKSPACE="$BENCH_WORKSPACE" codspeed-linux env CODSPEED_REPOSITORY=web-infra-dev/rspack pnpm bench:simulation --implementation=rspack --valid-only
```

容器需有 jq（CodSpeed Node introspection 使用）。现有容器没有 perf 权限和 systemd；walltime 可通过 CodSpeed 官方开关 `CODSPEED_PROFILER_ENABLED=false CODSPEED_ISOLATION=false` 运行，不降低宿主机内核权限。该模式没有 walltime 火焰图，用 simulation 火焰图检查原生路径。此环境的结果存储沿用已连接的 web-infra-dev/rspack，并不表示 benchmark 代码已提交到该仓库。执行环境与报告见 [RESULTS.md](RESULTS.md)。

## GitHub CI

`.github/workflows/codspeed.yml` 在 main push、pull_request 和手动触发时执行 Linux 构建、完整 API 测试、类型检查和回放校验，再用 CodSpeed simulation 测量。`pnpm bench:ci` 必须由 CodSpeed CLI / action 包裹；一次报告包含 `webpack/…` 与 `rspack/…` 两组独立 URI，避免同一提交的两种实现互相覆盖。

`pnpm bench:validate:ci` 仅容许 `known-mismatches.json` 中精确记录的错误类型、上游指纹和当前错误指纹。新增失败、上游回放失败或旧错误变化都会导致 CI 失败；已修复场景自动回到测量集合。普通 `bench:validate` 仍严格失败；`--valid-only` 仅供显式的本地探索，不用于 CI。

公共仓库使用 GitHub OIDC（`id-token: write`），也可提供仓库 secret `CODSPEED_TOKEN`。首次上传需要在 CodSpeed 启用本仓库；CI 不使用开发机的账号凭据，也不将结果上传至其他项目。
