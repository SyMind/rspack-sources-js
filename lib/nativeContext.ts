import { types } from 'node:util';
import { Source } from './Source';
import * as strings from './helpers/stringBufferUtils';

// All strong JS references are V8-visible. Native nodes hold only weak references
// to this store and their receiver, so user-created JS cycles remain collectible.
export interface NativeContext {
  values: unknown[];
  helpers: typeof sharedHelpers;
}
const stores = new WeakMap<object, NativeContext>();

function plainArray(value: unknown, fields?: string[]) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, i);
    if (!item || !('value' in item)) return false;
    if (fields) {
      if (!item.value || types.isProxy(item.value)) return false;
      for (const key of fields) {
        const d = Object.getOwnPropertyDescriptor(item.value, key);
        if (!d || !('value' in d)) return false;
      }
    }
  }
  return true;
}

function columns(options: any) {
  if (options == null) return true;
  if (types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype) return;
  const d = Object.getOwnPropertyDescriptors(options);
  if (Object.keys(d).some(k => !['columns', 'module'].includes(k) || !('value' in d[k]))) return;
  return options.columns !== false;
}

export const sharedHelpers = {
  plainArray, columns,
  sourcePrototype: Source.prototype,

  dual: strings.isDualStringBufferCachingEnabled,
  intern: strings.internString,
};

export function contextOf(receiver: object, helpers = sharedHelpers): NativeContext {
  let store = stores.get(receiver);
  if (!store) {
    store = { values: [], helpers };
    stores.set(receiver, store);
  }
  return store;
}
