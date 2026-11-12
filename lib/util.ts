export const util = Object.freeze({
  get stringBufferUtils(): typeof import('./helpers/stringBufferUtils') {
    return require('./helpers/stringBufferUtils');
  },
});
