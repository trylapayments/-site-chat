import { scopeStorage } from "../core/scoped-storage";
import { cacheSessionStorage } from "../core/cached-storage";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

const memory = new Map<string, string>();
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
async function read(key: string) {
  return Platform.OS === "web" ? (memory.get(key) ?? null) : SecureStore.getItemAsync(key, options);
}
async function write(key: string, value: string) {
  if (Platform.OS === "web") memory.set(key, value);
  else await SecureStore.setItemAsync(key, value, options);
}
async function remove(key: string) {
  if (Platform.OS === "web") memory.delete(key);
  else await SecureStore.deleteItemAsync(key, options);
}

// Publish a manifest only after all chunks are committed. The previous value survives interruption.
// SecureStore values are small: encode Unicode to ASCII before splitting.
const durableStorage = {
  async getItem(key: string) {
    const manifest = await read(`${key}.manifest`);
    if (!manifest) return null;
    const { generation, count } = JSON.parse(manifest) as { generation: string; count: number };
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, i) => read(`${key}.${generation}.${i}`)),
    );
    if (chunks.some((c) => c === null)) return null;
    return decodeURIComponent(chunks.join(""));
  },
  async setItem(key: string, value: string) {
    const previous = await read(`${key}.manifest`);
    const encoded = encodeURIComponent(value);
    const generation = Crypto.randomUUID();
    const count = Math.ceil(encoded.length / 1500);
    for (let i = 0; i < count; i++)
      await write(`${key}.${generation}.${i}`, encoded.slice(i * 1500, (i + 1) * 1500));
    await write(`${key}.manifest`, JSON.stringify({ generation, count }));
    if (previous) {
      const old = JSON.parse(previous);
      await Promise.all(
        Array.from({ length: old.count }, (_, i) => remove(`${key}.${old.generation}.${i}`)),
      );
    }
  },
  async removeItem(key: string) {
    const manifest = await read(`${key}.manifest`);
    await remove(`${key}.manifest`);
    if (manifest) {
      const old = JSON.parse(manifest);
      await Promise.all(
        Array.from({ length: old.count }, (_, i) => remove(`${key}.${old.generation}.${i}`)),
      );
    }
  },
};

const environmentStorage = scopeStorage(
  durableStorage,
  process.env.EXPO_PUBLIC_SUPABASE_URL || "https://unconfigured.supabase.co",
  process.env.EXPO_PUBLIC_API_URL || "https://app.mill.chat",
);
export const storage = cacheSessionStorage(environmentStorage, "mill.session");
