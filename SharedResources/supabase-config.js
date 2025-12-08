/**
 * Shared Supabase Configuration
 * Used by all NAEI data viewer applications
 */

const FALLBACK_SUPABASE_URL = 'https://buqarqyqlugwaabuuyfy.supabase.co';
const FALLBACK_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1cWFycXlxbHVnd2FhYnV1eWZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyOTczNDEsImV4cCI6MjA3Njg3MzM0MX0._zommN8QkzS0hY__N7KfuIaalKWG-PrSPq1BWg_BBjg';
const FALLBACK_SUPABASE_STORAGE_KEY_BASE = 'sb-buqarqyqlugwaabuuyfy-auth-token';

const runtimeEnv = (() => {
  const env = window.__NAEI_SUPABASE_CONFIG
    || window.__NAEI_SUPABASE_CONFIG__
    || null;
  return (env && typeof env === 'object') ? env : null;
})();

const SUPABASE_URL = runtimeEnv?.url || runtimeEnv?.SUPABASE_URL || FALLBACK_SUPABASE_URL;
const SUPABASE_KEY = runtimeEnv?.key || runtimeEnv?.SUPABASE_KEY || FALLBACK_SUPABASE_KEY;
const SUPABASE_STORAGE_KEY_BASE = runtimeEnv?.storageKeyBase
  || runtimeEnv?.SUPABASE_STORAGE_KEY_BASE
  || deriveStorageKeyBase(SUPABASE_URL)
  || FALLBACK_SUPABASE_STORAGE_KEY_BASE;

// Maintain one Supabase client per scoped storage key to avoid duplicate GoTrue instances
window.__NAEI_SUPABASE_CLIENTS = window.__NAEI_SUPABASE_CLIENTS || {};

function deriveStorageKeyBase(url) {
  if (!url) {
    return null;
  }
  try {
    const ref = new URL(url).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch (error) {
    console.warn('Unable to derive Supabase storage key from URL, using fallback.', error);
    return null;
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
