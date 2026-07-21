import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/../packages/contracts/src/db.types';
import { getFoundationEnv } from '@/lib/foundations/env';

const SECURE_STORE_PREFIX = 'receiptflow.supabase.';

function secureStoreKey(key: string) {
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 33) ^ key.charCodeAt(index);
  }
  return `${SECURE_STORE_PREFIX}${(hash >>> 0).toString(36)}`;
}

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(secureStoreKey(key)),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(secureStoreKey(key), value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(secureStoreKey(key)),
};

const env = getFoundationEnv();

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

export const supabase = createClient<Database>(env.supabaseUrl ?? 'https://receiptflow.invalid', env.supabaseAnonKey ?? 'missing', {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
