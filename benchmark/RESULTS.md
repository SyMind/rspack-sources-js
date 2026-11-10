# Ant Design Source 图的 CodSpeed 结果

2026-11-10，在相同的 ARM64 Linux 容器中比较 webpack-sources 3.6.0 与当前 rspack-sources-js（生产代码基于 `96122d2c1a4b68bb5c26e09910288a99a126dc9b`，benchmark 为未提交工作区）。只比较通过差分校验的 19 个代表调用；生产 app.js 的 map 差异明确排除。

## 环境与方法

Ubuntu 24.04 / aarch64，Colima VM 8 CPU / 20 GiB；Node.js 24.21.0、pnpm 11.10.0、CodSpeed runner 5.3.1、core / tinybench-plugin 5.7.1、tinybench 5.1.0。Rust 1.97.0-nightly（e8e4541ff，2026-04-15）以 release + debuginfo 构建（`CARGO_PROFILE_RELEASE_DEBUG=1 pnpm build`）；rspack_sources 0.103.0。捕获发生在 macOS arm64 / Node 22.22.3，回放仍使用同一份捕获图与原始指纹。

walltime 保留正常 JIT，8 次预热、64 次样本，计时外恢复调用前的 Source 状态。由于容器不支持 perf / systemd，使用官方 `CODSPEED_PROFILER_ENABLED=false CODSPEED_ISOLATION=false` 开关；没有改动内核权限。walltime 报告值为 **min time**，不是均值。VM 未做 CPU 隔离，存在 GC、调度和亚微秒计时噪声；不能把纳秒级差异当作稳定收益。

simulation 使用相同 fixtures，但禁用 JIT 优化，并关闭 Wasm trap handler 以避免 Valgrind 地址空间预留失败。报告是模拟 CPU 时间，不是物理耗时，不能与 walltime 数字直接比较。

## 正常 JIT 的 walltime 对照

[完整 19 项比较](https://app.codspeed.io/web-infra-dev/rspack/runs/compare/6af2e9c036e1a2fd27a325e0..6af2e9de9231166871b3c0c1)；BASE 为 webpack，HEAD 为 rspack-sources-js。又按相反执行顺序复测三个正确的 sourceAndMap 场景：[复测比较](https://app.codspeed.io/web-infra-dev/rspack/runs/compare/6af2eb1e36e1a2fd27a32626..6af2eafa36e1a2fd27a3261a)。表中两值分别是首次 / 复测，各为 64 个样本的最小值。

| 真实调用 | webpack-sources | rspack-sources-js | 路径与判断 |
| --- | --- | --- | --- |
| 开发 app.js，CachedSource.sourceAndMap，3,704 节点 | 16.0 / 17.2 ms | 15.9 / 16.4 ms | JS fallback；当前未建立稳定加速结论 |
| 生产压缩前 app.js，CachedSource.sourceAndMap，1,689 节点 | 9.2 / 10.1 ms | 9.3 / 9.5 ms | JS fallback；差异受运行波动影响 |
| 生产 app.css，SourceMapSource.sourceAndMap，1 节点 | 3.25 / 3.50 µs | 16.13 / 15.92 µs | nativeReads=1；当前约 4.5–5 倍耗时 |

CSS 首次样本的 median 为上游 3.54 µs、当前实现 17.17 µs，与 min time 的方向一致；但两端均存在异常慢样本（上游最高 1.41 ms，当前最高 157.68 µs）。不要用 mean 的偶然反向结果声称获益。

两个大图的图内有 CachedSource 与 PrefixSource，而当前 planner 的可编译节点类型只包含 RawSource、OriginalSource、ConcatSource、ReplaceSource、SourceMapSource。实测 nativeReads=0、compilations=0、fallbacks=1，因此当前数字主要比较本地 JS 回退及入口检查，不能用于说明 Rust 大图计算的速度。

## CPU simulation 与火焰图

[19 项 simulation 比较](https://app.codspeed.io/web-infra-dev/rspack/runs/compare/6af2ea1536e1a2fd27a325e9..6af2ea819231166871b3c0e3)：17 项 unchanged、2 项 regression。以下是模拟 CPU 时间：

| 调用 | webpack-sources | rspack-sources-js |
| --- | ---: | ---: |
| development/devtool/CachedSource/sourceAndMap | 801.25 ms | 806.59 ms |
| production/optimize/CachedSource/sourceAndMap | 495.62 ms | 496.43 ms |
| production/devtool/SourceMapSource/sourceAndMap | 940.30 µs | 1,083.4 µs |

已通过 MCP 查询 [CSS 场景火焰图](https://app.codspeed.io/web-infra-dev/rspack/runs/6af2ea819231166871b3c0e3?uri=.bench%2Flinux-capture-aYF2vg%2Fbenchmark%2Frun.mjs%3A%3Aantd-webpack-source-graphs%3A%3Aproduction%2Fdevtool%2FSourceMapSource%2FsourceAndMap&runnerMode=Simulation)。可见 nativeRead、prepare、describe、mapInput；prepare 占此模拟场景约 68.5% 的 inclusive CPU 时间。这解释的是禁用 JIT 时可见的 JS 准备成本。当前返回的调用树没有单独显示 Rust 函数，因此不据此拆分 Rust 内部热点或声称 Rust 占比；原生执行由差分预检的 compilations=1、nativeReads=1、fallbacks=0 核实。

CodSpeed 对 development/modules/SourceMapSource/source 提示 dominated by system calls / no flamegraph；不将该项用于 CPU 模拟结论。其余小读取存在固定运行时与采样成本；是否微小变快应另用更长采样和稳定硬件确认。

## 正确性门槛与后续

20/20 上游回放匹配真实构建指纹；当前实现 19/20。失败的是 `production/devtool/ConcatSource/sourceAndMap`：输出 source 完全相同，但 map.mappings 长度 662,078 → 662,024，首次差异位于偏移 10,128。该图有 ConcatSource + SourceMapSource，走原生路径；其性能数字不进入任何对照结果。

当前证据说明：主要真实大图仍回退，唯一通过校验的 CSS 原生场景较慢，生产 JS 还有一处精确映射不一致。若继续优化，应先定位映射差异并补足真实图覆盖，再重跑相同 fixtures；当前没有整次 webpack build 加速、内存或 RSS 结论。完整调用、缓存状态、类型分布、重建命令及边界见 [DESIGN.md](DESIGN.md)。

所有报告借用本机既有可访问的 web-infra-dev/rspack CodSpeed 项目保存，不代表代码已发布。未提交、未推送 benchmark 或生产改动。
