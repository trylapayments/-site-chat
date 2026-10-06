import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@site-chat/shared";
import { storage } from "./storage";
import { createTransport } from "../core/transport";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const configured = !!url && !!key;
export const apiUrl = process.env.EXPO_PUBLIC_API_URL || "https://app.mill.chat";
export const supabase = createClient<Database>(
  url || "https://unconfigured.supabase.co",
  key || "unconfigured",
  {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "mill.session",
    },
  },
);

export { ApiError } from "../core/transport";
export const api = createTransport(() => supabase.auth.getSession(), apiUrl);
