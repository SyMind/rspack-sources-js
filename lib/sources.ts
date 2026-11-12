export { Source } from './Source';
export { RawSource } from './RawSource';
export { OriginalSource } from './OriginalSource';
export { SourceMapSource } from './SourceMapSource';
export { ConcatSource } from './ConcatSource';
export { ReplaceSource } from './ReplaceSource';
export { CachedSource } from './CachedSource';
export { PrefixSource } from './PrefixSource';
export { SizeOnlySource } from './SizeOnlySource';
export { CompatSource } from './CompatSource';

export const util = Object.freeze({
  get stringBufferUtils(): typeof import('./helpers/stringBufferUtils') {
    return require('./helpers/stringBufferUtils');
  },
});
