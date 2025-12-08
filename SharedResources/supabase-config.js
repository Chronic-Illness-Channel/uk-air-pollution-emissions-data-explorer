/**
 * Shared Supabase Configuration
 * Used by all NAEI data viewer applications
 */

const runtimeEnv = resolveRuntimeEnv();

const SUPABASE_URL = getRequiredValue(runtimeEnv, ['url', 'SUPABASE_URL'], 'Supabase URL');
const SUPABASE_KEY = getRequiredValue(runtimeEnv, ['key', 'SUPABASE_KEY'], 'Supabase anon key');
const SUPABASE_STORAGE_KEY_BASE = runtimeEnv.storageKeyBase
  || runtimeEnv.SUPABASE_STORAGE_KEY_BASE
  || deriveStorageKeyBase(SUPABASE_URL);

// Maintain one Supabase client per scoped storage key to avoid duplicate GoTrue instances
window.__NAEI_SUPABASE_CLIENTS = window.__NAEI_SUPABASE_CLIENTS || {};

function resolveRuntimeEnv() {
  const env = window.__NAEI_SUPABASE_CONFIG
    || window.__NAEI_SUPABASE_CONFIG__
    || null;
  if (!env || typeof env !== 'object') {
    throw new Error('[SupabaseConfig] Supabase runtime config missing. Load SharedResources/supabase-env.js (or define window.__NAEI_SUPABASE_CONFIG) before supabase-config.js.');
  }
  return env;
}

function getRequiredValue(source, keys, label) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  const preferred = keys[0];
  throw new Error(`[SupabaseConfig] Missing ${label}. Provide "${preferred}" on window.__NAEI_SUPABASE_CONFIG before loading supabase-config.js.`);
}

function deriveStorageKeyBase(url) {
  try {
    const hostname = new URL(url).hostname || '';
    const ref = hostname.split('.')[0];
    if (!ref) {
      throw new Error('hostname missing');
    }
    return `sb-${ref}-auth-token`;
  } catch (error) {
    throw new Error('[SupabaseConfig] Unable to derive storageKeyBase from Supabase URL. Provide "storageKeyBase" in window.__NAEI_SUPABASE_CONFIG.');
  }
}

function buildScopedStorageKey() {
  try {
    const pathname = (window.location && window.location.pathname) || '';
    const slug = pathname
      .split('/')
      .filter(Boolean)
      .join('-')
      .replace(/[^a-z0-9-]/gi, '-')
      .replace(/-{2,}/g, '-')
      .toLowerCase() || 'root';
    return `${SUPABASE_STORAGE_KEY_BASE}::${slug}`;
  } catch (error) {
    console.warn('Unable to build scoped Supabase storage key, falling back to base key:', error);
    return SUPABASE_STORAGE_KEY_BASE;
  }
}

/**
 * Initialize Supabase client
 * @returns {object} Supabase client instance or null if unavailable
 */
function initSupabaseClient() {
  if (!(window.supabase && window.supabase.createClient)) {
    console.error('Supabase library not loaded');
    return null;
  }

  const storageKey = buildScopedStorageKey();
  const cache = window.__NAEI_SUPABASE_CLIENTS;

  if (cache[storageKey]) {
    return cache[storageKey];
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storageKey
    }
  });

  cache[storageKey] = client;
  return client;
}

// Export configuration
window.SupabaseConfig = {
  SUPABASE_URL,
  SUPABASE_KEY,
  initSupabaseClient
};
