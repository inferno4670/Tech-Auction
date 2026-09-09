import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http'));

if (!isConfigured) {
  console.warn(
    '⚠️ Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

// Create a mock client for when Supabase isn't configured (so the app still renders)
function createMockClient(): SupabaseClient {
  const noopAsync = async () => ({ data: null, error: null });
  const noopChain: any = {
    select: () => noopChain,
    insert: () => noopChain,
    update: () => noopChain,
    delete: () => noopChain,
    eq: () => noopChain,
    order: () => noopChain,
    limit: () => noopChain,
    single: noopAsync,
    then: noopAsync,
  };

  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => { throw new Error('Supabase not configured. Please set up your .env file.'); },
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({
        data: {
          subscription: { unsubscribe: () => {} },
        },
      }),
    },
    from: () => noopChain,
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
    rpc: noopAsync,
  } as unknown as SupabaseClient;
}

export const supabase: SupabaseClient = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : createMockClient();
