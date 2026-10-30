# rspack-sources-js

基于 Rust `rspack_sources` 和 Node-API，向 JavaScript 暴露源码拼接、替换和 source map 处理能力，目标是在兼容 webpack-sources API 的前提下提升性能。

当前处于设计与参考行为调研阶段，尚未实现原生 binding，也未测得性能收益。项目介绍和运行说明见[英文 README](README.md)。
