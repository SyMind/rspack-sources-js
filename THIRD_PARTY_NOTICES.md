# 第三方代码声明

`src/` 中的 Source 类和 helpers 从 webpack-sources v3.6.0（提交 `4f49c304ef1b105f52dac6f630ab9d90b0c48088`）迁移为 TypeScript；构建产物位于 `lib/`。保留源文件中的作者声明，相关代码遵循以下上游 MIT 许可。

MIT License

Copyright (c) 2017 JS Foundation and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


`crates/rspack_sources/` 来自 web-infra-dev/rspack 的 d0b2a44659d11fe3076261688ebad0f8a2cd476a，包含本地缓存接口改动。该 crate 同样采用上述 MIT 许可。

Copyright (c) 2021-present Rspack team and fellow contributors
