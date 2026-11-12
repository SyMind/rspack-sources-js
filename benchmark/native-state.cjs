'use strict';
const binding = require('../dist/binding');

module.exports = {
  restoreOriginal(api, fields) {
    const source = new api.OriginalSource(fields._valueAsBuffer ?? fields._value, fields._name);
    binding.debugOriginalRestore(source, fields._value);
    return source;
  },
  restoreCached(api, fields) {
    const source = new api.CachedSource(fields._source);
    if (fields._cachedSource !== undefined || fields._cachedSourceType !== undefined) source.source();
    if (fields._cachedSize !== undefined) source.size();
    for (const key of fields._cachedMaps?.keys() ?? []) {
      source.map(JSON.parse(key));
    }
    if (fields._cachedHashUpdate !== undefined) source.updateHash({ update() {} });
    return source;
  },
  restoreRaw(api, fields) {
    const source = new api.RawSource(fields._valueAsBuffer ?? fields._value, !fields._valueIsBuffer);
    if (fields._value !== undefined && !fields._valueIsBuffer) source.source();
    if (fields._cachedSize !== undefined) source.size();
    return source;
  },
};
