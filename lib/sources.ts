import Source = require('./Source');
import RawSource = require('./RawSource');
import OriginalSource = require('./OriginalSource');
import SourceMapSource = require('./SourceMapSource');
import ConcatSource = require('./ConcatSource');
import ReplaceSource = require('./ReplaceSource');
import CachedSource = require('./CachedSource');
import PrefixSource = require('./PrefixSource');
import SizeOnlySource = require('./SizeOnlySource');
import CompatSource = require('./CompatSource');

export { Source, RawSource, OriginalSource, SourceMapSource, ConcatSource, ReplaceSource, CachedSource, PrefixSource, SizeOnlySource, CompatSource };
export const util = Object.freeze({
  get scopes(): typeof import('./helpers/scopes') {
    return require('./helpers/scopes');
  },
  get stringBufferUtils(): typeof import('./helpers/stringBufferUtils') {
    return require('./helpers/stringBufferUtils');
  },
});
