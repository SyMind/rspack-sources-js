# RawSource 通用入口与专用入口对比

日期：2026-11-11。历史测量结论：**专用 raw_new 的入口成本更低；完整构造的收益更小且受输入大小影响。** 随后生产代码切换为各 Source 类型的具名入口。2026-11-12 已移除旧通用入口的 benchmark 对照实现，当前脚本只测量 `rawNew` 和公开 `RawSource` 构造器；下文数据对应历史版本。

## 历史测量对象（接口重构之前）

- 通用：bridge.create(this, 'raw', [value, convertToString])，调用 sourceCreate(receiver, store, kind, args)。
- 专用：bridge.createRaw(this, value, convertToString)，调用 rawNew(receiver, store, value, convertToString)；Rust 方法名为 raw_new。
- 两个 Rust 导出共同调用 create_source，字段构造、字符串处理、可用快照、napi_wrap/type tag、引用存储和 GC 所有权完全共用。字符串输入创建 RawStringSource 快照；Buffer 输入只建立相同的 native 节点，文本解码不在构造测量中。
- 专用入口省去 kind 字符串解码、JS 参数数组及 Rust 参数 Vec，布尔值直接传给共同构造逻辑。通用入口还返回字段列表（RawSource 为 []），专用入口返回 void；JS 包装的空数组迭代也随之省去。因此测到的是当前两种完整入口的差异，不能把全部差值仅归因于数组分配。

两组 JS constructor 同样继承 Source、具有相同原型层级、使用相同的 internString。只改变 bridge 调用。计时前分别检查字符串/Buffer 输出、isBuffer、size 和无公开实例字段；这些检查位于 benchmark setup，不执行完整功能测试。

## 范围与环境

- native-entry：接收对象及 ReferenceStore 在计时前准备；测量实际 native 构造调用。
- constructor：包括 JS 实例、ReferenceStore、WeakMap 和 native 构造。
- 每批 32 个 Source，全部保活到批末；显式 GC 放在计时外。walltime 每项 8 次预热、64 次测量。结果来自 CodSpeed MCP，walltime 为 minSeconds / 32，表示每个 Source 的最小耗时，不是均值。
- 同一份 Linux ARM64 源码快照、同一 native 二进制；Node 24.21.0、pnpm 11.10.0、rustc 1.97.0-nightly (e8e4541ff 2026-04-15)、rspack_sources 0.103.0、CodSpeed CLI 5.3.1、tinybench 5.1.0 / CodSpeed 插件 5.7.1。
- Release + debuginfo。CPU simulation 使用项目现有禁 JIT 参数；walltime 保留正常 JIT，关闭容器不支持的 profiler/isolation，未修改内核权限。VM 不是隔离 runner。
- 覆盖空串、32B ASCII、4KiB ASCII、64KiB ASCII、4KiB UTF-16 中文/emoji，以及 4KiB Buffer 的 convertToString=false/true，共 14 项。

## Walltime：两轮复核

以下是每个 Source 的耗时，取各次 CodSpeed run 的最小批耗时 / 32。百分比为“耗时降低”= 1 - 专用/通用，与 CodSpeed 表中的相对速度提升不是同一个公式。

| 场景 | 通用第一轮 → 专用第一轮 | 通用第二轮 → 专用第二轮 | 耗时降低 |
| --- | --- | --- | --- |
| native-entry，32B ASCII | 1.407 → 1.121 µs | 1.291 → 1.077 µs | 20.3%、16.5% |
| constructor，32B ASCII | 1.438 → 1.258 µs | 1.367 → 1.318 µs | 12.6%、3.6% |
| constructor，4KiB Buffer | 1.234 → 1.052 µs | 1.196 → 1.098 µs | 14.8%、8.1% |
| constructor，64KiB ASCII | 212.075 → 115.895 µs | 115.041 → 115.259 µs | 无稳定收益 |

第一轮 64KiB 通用构造发生明显波动：batch min 6.79ms、median 55.90ms；第二轮 min 3.68ms、median 3.84ms，专用第二轮 min 3.69ms。该场景不能使用首轮的约 45% 耗时降低作为结论。Unicode 首轮较大的收益也未在第二轮形成同样强的信号。显式 GC 放在计时外仍不能消除 VM、allocator 和延迟回收的影响。

第二轮 CodSpeed 判定 5 项提升、9 项不变；稳定提升集中于 native-entry 的小输入/Buffer，以及 Buffer convert 的完整构造。完整 32B 构造和普通 Buffer 构造第二轮虽然耗时更低，但未达到 CodSpeed 的显著变化阈值，不能笼统声称构造总能稳定提升 10%～20%。

[第一轮对比](https://app.codspeed.io/SyMind/rspack-sources-js/runs/compare/6af3f88ab2767c3998cdfa1e..6af3f896b2767c3998cdfa21)；[第二轮对比](https://app.codspeed.io/SyMind/rspack-sources-js/runs/compare/6af3f8a1b2767c3998cdfa22..6af3f8ad92c5a3a135755c02)。

## CPU simulation 与火焰图

最终同源二进制对比为 8 项提升、6 项不变。32B native-entry 模拟耗时降低 11.5%，普通 Buffer 完整构造降低 13.7%，64KiB 完整构造降低 0.2%。32B 完整构造在禁 JIT 模式下降低 31.9%，与正常 JIT 的结果明显不同，不能将该数字作为真实运行时间提升。

[模拟对比](https://app.codspeed.io/SyMind/rspack-sources-js/runs/compare/6af3f82eb2767c3998cdfa0e..6af3f84792c5a3a135755bfb)。32B constructor 的差分火焰图已经查询成功，显示 create/createRaw、constructor 与 V8 调用帧；没有独立展开 Rust 内部帧，不能从 JS self time 精确拆出 Rust 计算和参数解码各占多少。

此前两份探索报告使用了将 typed bool 重建为 JS bool 的初版专用入口，已被最终实现替代，不用于本结论。

## 使用建议与边界

RawSource 的固定构造协议适合使用专用 raw_new：入口更明确，也减少通用编码成本。大字符串的成本主要在共同的构造工作，接口变化的收益被摊薄。当前结果仅覆盖构造，不代表 source/map、完整 Source 树或 webpack build 的整体加速，也不证明 GC 或内存改善。

上述结果来自切换生产入口之前的同源对照。后续已删除 lib/bridge.ts，生产构造直接调用 binding.rawNew。旧的通用 benchmark 对照入口及其 Cargo feature 已删除。重构还调整了代码组织及字段初始化，旧数字对应历史实现。完整单测和上游套件仍暂停。

## 测量当前入口

当前脚本分别测量 `rawNew` 原生入口和公开 `RawSource` 构造器。每项结果为 32 个 Source 的批耗时，接收对象准备与显式 GC 的计时边界沿用前述方式。历史对照的源码快照见下文。运行方式如下。

~~~sh
pnpm build
pnpm bench:raw:simulation
pnpm bench:raw:walltime
~~~

可用 --filter=native-entry 或 --filter=ascii-32B 缩小范围。脚本拒绝在 CodSpeed 外运行。Mac 使用 benchmark/prepare-linux.mjs 创建源码快照，在已有 codspeed-linux 环境构建，避免 Linux .node 覆盖宿主机产物。容器 walltime 需设置 CODSPEED_PROFILER_ENABLED=false CODSPEED_ISOLATION=false。

本轮快照为 .bench/linux-capture-EzHOc4；完整 MCP 结果保存在 .bench/raw-constructor-{simulation,walltime-1,walltime-2,flamegraph}.md 与 .bench/raw-constructor-mcp-metrics.json。复用或移动快照会改变 benchmark URI，跨 run 对比需要保持同一路径。
