type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

// Persisted credentials and pending work belong to one backend environment.
// Encode the exact endpoint identity using only SecureStore-safe characters.
export function scopeStorage(storage: Storage, supabaseUrl: string, apiUrl: string): Storage {
  const identity = `${new URL(supabaseUrl).origin}|${new URL(apiUrl).origin}`;
  const encoded = Array.from(identity, (char) =>
    char.charCodeAt(0).toString(16).padStart(4, "0"),
  ).join("");
  const keyFor = (key: string) => `mill.env.${encoded}.${key}`;
  return {
    getItem: (key) => storage.getItem(keyFor(key)),
    setItem: (key, value) => storage.setItem(keyFor(key), value),
    removeItem: (key) => storage.removeItem(keyFor(key)),
  };
}
