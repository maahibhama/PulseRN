export interface StorageProvider {
  id: string;
  name: string;
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AsyncStorageLike {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface MMKVLike {
  getAllKeys(): readonly string[];
  getString(key: string): string | undefined;
  getNumber?(key: string): number | undefined;
  getBoolean?(key: string): boolean | undefined;
  getBuffer?(key: string): ArrayBuffer | undefined;
  set(key: string, value: string | number | boolean | ArrayBuffer): void;
  remove?(key: string): boolean | void;
  delete?(key: string): boolean | void;
}

export function createAsyncStorageProvider(
  storage: AsyncStorageLike,
  options: { id?: string; name?: string } = {},
): StorageProvider {
  return {
    id: options.id ?? 'async-storage',
    name: options.name ?? 'AsyncStorage',
    getAllKeys: () => storage.getAllKeys(),
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  };
}

type MMKVValueType = 'string' | 'number' | 'boolean' | 'binary';

function safelyRead<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export function createMMKVStorageProvider(
  storage: MMKVLike,
  options: { id?: string; name?: string } = {},
): StorageProvider {
  const types = new Map<string, MMKVValueType>();
  return {
    id: options.id ?? 'mmkv',
    name: options.name ?? 'MMKV',
    getAllKeys: async () => storage.getAllKeys(),
    getItem: async (key) => {
      const stringValue = safelyRead(() => storage.getString(key));
      if (stringValue !== undefined) {
        types.set(key, 'string');
        return stringValue;
      }
      const numberValue = storage.getNumber
        ? safelyRead(() => storage.getNumber?.(key))
        : undefined;
      if (numberValue !== undefined) {
        types.set(key, 'number');
        return String(numberValue);
      }
      const booleanValue = storage.getBoolean
        ? safelyRead(() => storage.getBoolean?.(key))
        : undefined;
      if (booleanValue !== undefined) {
        types.set(key, 'boolean');
        return String(booleanValue);
      }
      const bufferValue = storage.getBuffer
        ? safelyRead(() => storage.getBuffer?.(key))
        : undefined;
      if (bufferValue !== undefined) {
        types.set(key, 'binary');
        return `[PulseRN: read-only ArrayBuffer (${bufferValue.byteLength} bytes)]`;
      }
      types.delete(key);
      return null;
    },
    setItem: async (key, value) => {
      const type = types.get(key) ?? 'string';
      if (type === 'binary') throw new Error('PulseRN does not edit binary MMKV values.');
      if (type === 'number') {
        const number = Number(value);
        if (!Number.isFinite(number))
          throw new Error('MMKV number values require a finite number.');
        storage.set(key, number);
        return;
      }
      if (type === 'boolean') {
        if (value !== 'true' && value !== 'false')
          throw new Error('MMKV boolean values must be "true" or "false".');
        storage.set(key, value === 'true');
        return;
      }
      storage.set(key, value);
    },
    removeItem: async (key) => {
      if (storage.remove) storage.remove(key);
      else if (storage.delete) storage.delete(key);
      else throw new Error('The MMKV instance does not expose remove() or delete().');
      types.delete(key);
    },
  };
}
