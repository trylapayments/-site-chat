type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

// Cache only the live auth session. The durable store remains authoritative on restart.
export function cacheSessionStorage(storage: Storage, sessionKey: string): Storage {
  let cached: string | null | undefined;
  let version = 0;
  let writes = Promise.resolve();
  function mutate(action: () => Promise<void>, value: string | null) {
    version++;
    cached = undefined;
    const operation = writes
      .catch(() => {})
      .then(async () => {
        await action();
        cached = value;
      });
    writes = operation;
    return operation;
  }
  return {
    async getItem(key) {
      if (key !== sessionKey) return storage.getItem(key);
      await writes.catch(() => {});
      if (cached !== undefined) return cached;
      const readingVersion = version;
      const value = await storage.getItem(key);
      if (readingVersion === version) cached = value;
      else return this.getItem(key);
      return value;
    },
    setItem(key, value) {
      return key === sessionKey
        ? mutate(() => storage.setItem(key, value), value)
        : storage.setItem(key, value);
    },
    removeItem(key) {
      return key === sessionKey
        ? mutate(() => storage.removeItem(key), null)
        : storage.removeItem(key);
    },
  };
}
