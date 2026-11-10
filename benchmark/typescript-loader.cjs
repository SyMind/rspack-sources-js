'use strict';
const ts = require('typescript');
module.exports = function loader(source) {
  const result = ts.transpileModule(source, {
    fileName: this.resourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, sourceMap: true, inlineSources: true },
  });
  this.callback(null, result.outputText, JSON.parse(result.sourceMapText));
};
