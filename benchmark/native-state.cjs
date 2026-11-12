'use strict';
const binding = require('../dist/binding');

module.exports = {
  restoreOriginal(api, fields) {
    const source = new api.OriginalSource(fields._valueAsBuffer ?? fields._value, fields._name);
    binding.debugOriginalRestore(source, fields._value, fields._cachedSize);
    return source;
  },
  restoreCached(api, fields) {
    const source = new api.CachedSource(fields._source, {
      source: fields._cachedSourceType,
      buffer: fields._cachedBuffer,
      size: fields._cachedSize,
      maps: fields._cachedMaps,
      hash: fields._cachedHashUpdate,
    });
    // These two native values are captured separately from constructor cache data.
    for (const name of ['_cachedSource', '_cachedBuffers']) {
      if (fields[name] !== undefined) binding.debugSourceSetField(source, name, fields[name]);
    }
    return source;
  },
  set: binding.debugSourceSetField,
};
