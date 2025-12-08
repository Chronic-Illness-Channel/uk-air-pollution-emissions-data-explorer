/**
 * Shared Data Loader for NAEI Charts
 * Handles loading and caching of common data used by both line and scatter charts
 * Prevents duplicate data loading when switching between charts
 */

// Determine whether to surface verbose logging (opt-in via URL params)
const __sharedDataDebugParams = (() => {
  try {
    return new URLSearchParams(window.location.search || '');
  } catch (error) {
    return new URLSearchParams('');
  }
})();

const __sharedDataDebugEnabled = ['sharedLogs', 'sharedDebug']
  .some(flag => __sharedDataDebugParams.has(flag));

const sharedDataDebugLog = __sharedDataDebugEnabled ? console.log.bind(console) : () => {};
const sharedDataInfoLog = (() => {
  const info = console.info ? console.info.bind(console) : console.log.bind(console);
  return (...args) => info('[SharedData]', ...args);
})();
const sharedDataNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const SHARED_RESOURCES_BASE_PATH = (() => {
  const normalizePath = path => {
    if (!path || typeof path !== 'string') {
      return null;
    }
    try {
      const trimmed = path.trim();
      if (!trimmed) {
        return null;
      }
      if (/^https?:\/\//i.test(trimmed)) {
        const absolute = new URL(trimmed, window.location.origin);
        return absolute.pathname.endsWith('/') ? absolute.pathname : `${absolute.pathname}/`;
      }
      if (trimmed.startsWith('/')) {
        return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
      }
      return `/${trimmed.replace(/^\/+/, '')}${trimmed.endsWith('/') ? '' : '/'}`;
    } catch (error) {
      sharedDataDebugLog('SharedResources base normalization failed', error);
      return null;
    }
  };

  const fromExplicitGlobal = normalizePath(window.__NAEI_SHARED_RESOURCES_BASE__);
  if (fromExplicitGlobal) {
    return fromExplicitGlobal;
  }

  try {
    const currentScript = document.currentScript || Array.from(document.getElementsByTagName('script') || []).find(script => {
      const src = script && script.getAttribute && script.getAttribute('src');
      return src && src.includes('shared-data-loader');
    });
    if (!currentScript || !currentScript.src) {
      return null;
    }
    const scriptUrl = new URL(currentScript.src, window.location.origin);
    const segments = scriptUrl.pathname.split('/').filter(Boolean);
    const sharedIndex = segments.lastIndexOf('SharedResources');
    if (sharedIndex === -1) {
      return null;
    }
    const baseSegments = segments.slice(0, sharedIndex + 1);
    const basePath = `/${baseSegments.join('/')}/`;
    return basePath;
  } catch (error) {
    sharedDataDebugLog('SharedResources base detection failed', error);
    return null;
  }
})();

if (SHARED_RESOURCES_BASE_PATH && !window.__NAEI_SHARED_RESOURCES_BASE__) {
  window.__NAEI_SHARED_RESOURCES_BASE__ = SHARED_RESOURCES_BASE_PATH;
}

function resolveExistingSharedCache() {
  if (window.SharedDataCache) {
    return window.SharedDataCache;
  }
  try {
    if (window.parent && window.parent !== window && window.parent.SharedDataCache) {
      return window.parent.SharedDataCache;
    }
  } catch (error) {
    // Access to parent may be blocked; ignore and proceed with local cache
  }
  return null;
}

// Global data cache (mirrors parent cache when available)
window.SharedDataCache = resolveExistingSharedCache() || {
  isLoaded: false,
  isLoading: false,
  fullBootstrapPromise: null,
  loadPromise: null,
  defaultSnapshot: null,
  snapshotData: null,
  heroCache: new Map(),
  data: {
    pollutants: [],
    categories: [],
    timeseries: [],
    nfrCodes: []
  },
  maps: {
    pollutantIdToName: {},
    pollutantNameToId: {},
    categoryIdToName: {},
    categoryNameToId: {},
    pollutantUnits: {}
  }
};

const DEFAULT_SNAPSHOT_PATHS = Array.from(new Set([
  SHARED_RESOURCES_BASE_PATH ? `${SHARED_RESOURCES_BASE_PATH}default-chart-data.json` : null,
  '/SharedResources/default-chart-data.json',
  'SharedResources/default-chart-data.json',
  '../SharedResources/default-chart-data.json',
  '../../SharedResources/default-chart-data.json'
].filter(Boolean)));

let defaultSnapshotPromise = null;
const HERO_DEFAULT_ACTIVITY_NAME = 'Activity Data';

function uniqNumbers(values = []) {
  const deduped = [];
  const seen = new Set();
  values.forEach(val => {
    const num = Number(val);
    if (!Number.isFinite(num) || seen.has(num)) {
      return;
    }
    seen.add(num);
    deduped.push(num);
  });
  return deduped;
}

function uniqStrings(values = []) {
  const deduped = [];
  const seen = new Set();
  values.forEach(val => {
    if (typeof val !== 'string') {
      return;
    }
    const trimmed = val.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(trimmed);
  });
  return deduped;
}

async function loadDefaultSnapshot() {
  if (window.SharedDataCache.defaultSnapshot) {
    sharedDataInfoLog('Using cached default JSON snapshot', {
      generatedAt: window.SharedDataCache.defaultSnapshot.generatedAt || null
    });
    return window.SharedDataCache.defaultSnapshot;
  }

  if (!defaultSnapshotPromise) {
    defaultSnapshotPromise = (async () => {
      for (const candidate of DEFAULT_SNAPSHOT_PATHS) {
        try {
          sharedDataInfoLog('Attempting to fetch default snapshot', { candidate });
          const fetchStart = sharedDataNow();
          const response = await fetch(candidate, { cache: 'no-store' });
          if (!response.ok) {
            continue;
          }
          const snapshot = await response.json();
          window.SharedDataCache.defaultSnapshot = snapshot;
          window.SharedDataCache.snapshotData = snapshot?.data || null;
          const duration = (sharedDataNow() - fetchStart).toFixed(1);
          const counts = snapshot?.data
            ? {
                pollutants: snapshot.data.pollutants?.length || 0,
                categories: snapshot.data.categories?.length || 0,
                rows: snapshot.data.timeseries?.length || snapshot.data.rows?.length || 0,
                years: snapshot.data.years?.length || 0
              }
            : null;
          sharedDataInfoLog('Default snapshot loaded', {
            candidate,
            durationMs: Number(duration),
            counts
          });
          return snapshot;
        } catch (error) {
          sharedDataDebugLog(`Default snapshot fetch failed for ${candidate}:`, error);
        }
      }
      sharedDataInfoLog('Default snapshot unavailable after checking configured paths');
      return null;
    })();
  }

  try {
    const snapshot = await defaultSnapshotPromise;
    if (snapshot && !window.SharedDataCache.snapshotData) {
      window.SharedDataCache.snapshotData = snapshot.data || null;
    }
    return snapshot || null;
  } finally {
    if (window.SharedDataCache.defaultSnapshot) {
      defaultSnapshotPromise = Promise.resolve(window.SharedDataCache.defaultSnapshot);
    }
  }
}

function normalizeHeroOptions(rawOptions = {}) {
  const normalized = {
    pollutantIds: uniqNumbers(rawOptions.pollutantIds || []),
    pollutantNames: uniqStrings(rawOptions.pollutantNames || []),
    categoryIds: uniqNumbers(rawOptions.categoryIds || []),
    categoryNames: uniqStrings(rawOptions.categoryNames || []),
    includeActivityData: Boolean(rawOptions.includeActivityData),
    activityPollutantName: rawOptions.activityPollutantName || HERO_DEFAULT_ACTIVITY_NAME,
    defaultPollutantNames: uniqStrings(rawOptions.defaultPollutantNames || []),
    defaultCategoryNames: uniqStrings(rawOptions.defaultCategoryNames || [])
  };

  if (normalized.includeActivityData && normalized.activityPollutantName) {
    normalized.pollutantNames.push(normalized.activityPollutantName);
  }

  if (!normalized.pollutantIds.length && !normalized.pollutantNames.length && normalized.defaultPollutantNames.length) {
    normalized.pollutantNames = normalized.defaultPollutantNames.slice();
  }

  if (!normalized.categoryIds.length && !normalized.categoryNames.length && normalized.defaultCategoryNames.length) {
    normalized.categoryNames = normalized.defaultCategoryNames.slice();
  }

  normalized.pollutantIds = uniqNumbers(normalized.pollutantIds);
  normalized.pollutantNames = uniqStrings(normalized.pollutantNames);
  normalized.categoryIds = uniqNumbers(normalized.categoryIds);
  normalized.categoryNames = uniqStrings(normalized.categoryNames);

  if (!normalized.pollutantIds.length && !normalized.pollutantNames.length) {
    throw new Error('Hero dataset requires at least one pollutant identifier');
  }

  if (!normalized.categoryIds.length && !normalized.categoryNames.length) {
    throw new Error('Hero dataset requires at least one category identifier');
  }

  normalized.cacheKey = JSON.stringify({
    pollutantIds: normalized.pollutantIds,
    pollutantNames: normalized.pollutantNames.map(name => name.toLowerCase()),
    categoryIds: normalized.categoryIds,
    categoryNames: normalized.categoryNames.map(name => name.toLowerCase())
  });

  return normalized;
}

async function loadHeroDataset(options = {}) {
  const cache = window.SharedDataCache;
  cache.heroCache = cache.heroCache || new Map();

  let normalized;
  try {
    normalized = normalizeHeroOptions(options);
  } catch (error) {
    sharedDataDebugLog('Hero dataset skipped:', error.message || error);
    throw error;
  }

  if (cache.heroCache.has(normalized.cacheKey)) {
    const cached = cache.heroCache.get(normalized.cacheKey);
    if (cached && typeof cached.then !== 'function') {
      sharedDataInfoLog('Hero dataset fulfilled from cache', {
        pollutants: cached.pollutants?.length || 0,
        categories: cached.categories?.length || 0,
        rows: cached.timeseries?.length || cached.rows?.length || 0
      });
      return cached;
    }
    return cached;
  }

  const heroPromise = (async () => {
    const client = getSupabaseClient();

    const runLookup = async ({ table, idColumn, idValues = [], nameColumn, nameValues = [] }) => {
      const queries = [];
      if (idValues.length) {
        queries.push(
          client
            .from(table)
            .select('*')
            .in(idColumn, idValues)
        );
      }
      if (nameValues.length) {
        queries.push(
          client
            .from(table)
            .select('*')
            .in(nameColumn, nameValues)
        );
      }

      if (!queries.length) {
        throw new Error(`Hero dataset lookup for ${table} lacked identifiers`);
      }

      const results = await Promise.all(queries);
      const rowsById = new Map();
      results.forEach(response => {
        if (response.error) {
          throw response.error;
        }
        (response.data || []).forEach(row => {
          const key = Number.isFinite(row.id) ? row.id : row[idColumn] || row[nameColumn];
          if (key === undefined || key === null || rowsById.has(key)) {
            return;
          }
          rowsById.set(key, row);
        });
      });
      return Array.from(rowsById.values());
    };

    const pollutantRows = await runLookup({
      table: 'naei_global_t_pollutant',
      idColumn: 'id',
      idValues: normalized.pollutantIds,
      nameColumn: 'pollutant',
      nameValues: normalized.pollutantNames
    });

    const categoryRows = await runLookup({
      table: 'naei_global_t_category',
      idColumn: 'id',
      idValues: normalized.categoryIds,
      nameColumn: 'category_title',
      nameValues: normalized.categoryNames
    });

    const pollutantIdSet = new Set(normalized.pollutantIds);
    pollutantRows.forEach(row => {
      if (Number.isFinite(row.id)) {
        pollutantIdSet.add(row.id);
      }
    });

    const categoryIdSet = new Set(normalized.categoryIds);
    categoryRows.forEach(row => {
      if (Number.isFinite(row.id)) {
        categoryIdSet.add(row.id);
      }
    });

    if (!pollutantIdSet.size || !categoryIdSet.size) {
      throw new Error('Hero dataset lacked resolved pollutant or category IDs');
    }

    const timeseriesResp = await client
      .from('naei_2023ds_t_category_data')
      .select('*')
      .in('pollutant_id', Array.from(pollutantIdSet))
      .in('category_id', Array.from(categoryIdSet));
    if (timeseriesResp.error) throw timeseriesResp.error;

    const payload = {
      pollutants: pollutantRows,
      categories: categoryRows,
      timeseries: timeseriesResp.data || [],
      metadata: {
        pollutantIds: Array.from(pollutantIdSet),
        categoryIds: Array.from(categoryIdSet)
      }
    };

    sharedDataInfoLog('Hero dataset fetch completed', {
      pollutants: payload.pollutants.length,
      categories: payload.categories.length,
      rows: payload.timeseries.length
    });

    return payload;
  })().catch(error => {
    cache.heroCache.delete(normalized.cacheKey);
    throw error;
  });

  cache.heroCache.set(normalized.cacheKey, heroPromise);
  const heroData = await heroPromise;
  cache.heroCache.set(normalized.cacheKey, heroData);
  return heroData;
}

/**
 * Initialize Supabase client (reuses existing SupabaseConfig)
 */
function getSupabaseClient() {
  if (!window.SupabaseConfig) {
    throw new Error('SupabaseConfig not available');
  }
  return window.SupabaseConfig.initSupabaseClient();
}

/**
 * Load all shared data from Supabase with caching
 * Returns a promise that resolves when data is loaded
 */
async function loadSharedData() {
  const cache = window.SharedDataCache;
  
  // If data is already loaded, return immediately
  if (cache.isLoaded) {
    sharedDataInfoLog('Shared data fulfilled from cache');
    return cache.data;
  }
  
  // If loading is in progress, return the existing promise
  if (cache.isLoading && cache.loadPromise) {
    sharedDataInfoLog('Awaiting in-flight shared data load');
    return await cache.loadPromise;
  }
  
  // Start loading data
  cache.isLoading = true;
  cache.loadPromise = loadDataFromSupabase();
  
  try {
    const result = await cache.loadPromise;
    cache.isLoaded = true;
    cache.isLoading = false;
    cache.fullBootstrapPromise = null;
    return result;
  } catch (error) {
    cache.isLoading = false;
    cache.loadPromise = null;
    cache.fullBootstrapPromise = null;
    throw error;
  }
}

function bootstrapFullDataset(reason = 'chart') {
  const cache = window.SharedDataCache;
  if (cache.isLoaded) {
    return Promise.resolve(cache.data);
  }
  if (cache.fullBootstrapPromise) {
    return cache.fullBootstrapPromise;
  }
  sharedDataInfoLog('Full dataset bootstrap requested', { reason });
  cache.fullBootstrapPromise = loadSharedData()
    .catch(error => {
      cache.fullBootstrapPromise = null;
      throw error;
    });
  return cache.fullBootstrapPromise;
}

/**
 * Actually fetch data from Supabase
 */
async function loadDataFromSupabase() {
  sharedDataInfoLog('Starting shared Supabase fetch');
  
  const client = getSupabaseClient();
  const cache = window.SharedDataCache;
  const batchStart = sharedDataNow();

  const timedQuery = (label, promise) => {
    const start = sharedDataNow();
    sharedDataInfoLog(`Supabase query started`, { label });
    return promise.then(response => {
      const duration = (sharedDataNow() - start).toFixed(1);
      if (response?.error) {
        sharedDataInfoLog('Supabase query failed', {
          label,
          durationMs: Number(duration),
          message: response.error.message || String(response.error)
        });
      } else {
        sharedDataInfoLog('Supabase query completed', {
          label,
          durationMs: Number(duration),
          rows: Array.isArray(response?.data) ? response.data.length : 0
        });
      }
      return response;
    });
  };
  
  // Fetch all required data in parallel
  const [pollutantsResp, categoriesResp, dataResp, nfrResp] = await Promise.all([
    timedQuery('naei_global_t_pollutant', client.from('naei_global_t_pollutant').select('*')),
    timedQuery('naei_global_t_category', client.from('naei_global_t_category').select('*')),
    timedQuery('naei_2023ds_t_category_data', client.from('naei_2023ds_t_category_data').select('*')),
    timedQuery('naei_global_t_nfrcode', client.from('naei_global_t_nfrcode').select('*'))
  ]);

  if (pollutantsResp.error) throw pollutantsResp.error;
  if (categoriesResp.error) throw categoriesResp.error;
  if (dataResp.error) throw dataResp.error;
  if (nfrResp.error) throw nfrResp.error;

  const pollutants = pollutantsResp.data || [];
  const categories = categoriesResp.data || [];
  const timeseries = dataResp.data || [];
  const nfrCodes = nfrResp.data || [];
  
  // Store data in cache
  cache.data = { pollutants, categories, timeseries, nfrCodes };
  cache.snapshotData = cache.snapshotData || { pollutants, categories };
  
  // Build lookup maps for performance
  buildLookupMaps(pollutants, categories);
  
  // Store globally for backwards compatibility
  window.allPollutantsData = pollutants;
  window.allCategoryInfo = categories;
  
  sharedDataInfoLog('Shared Supabase fetch completed', {
    totalDurationMs: Number((sharedDataNow() - batchStart).toFixed(1)),
    summary: {
      pollutants: pollutants.length,
      categories: categories.length,
      rows: timeseries.length,
      nfrCodes: nfrCodes.length
    }
  });
  
  return cache.data;
}

/**
 * Build lookup maps for fast data access
 */
function buildLookupMaps(pollutants, categories) {
  const maps = window.SharedDataCache.maps;
  
  // Clear existing maps
  Object.keys(maps).forEach(key => {
    if (typeof maps[key] === 'object') {
      Object.keys(maps[key]).forEach(prop => delete maps[key][prop]);
    }
  });
  
  // Build pollutant maps
  pollutants.forEach(p => {
    if (p.id && p.pollutant) {
      maps.pollutantIdToName[p.id] = p.pollutant;
      maps.pollutantNameToId[p.pollutant.toLowerCase()] = p.id;
      
      const emissionUnit = p["emission unit"] || p.emission_unit || p["Emission Unit"];
      if (emissionUnit) {
        maps.pollutantUnits[p.pollutant] = emissionUnit;
      }
    }
  });
  
  // Build category maps
  categories.forEach(category => {
    const name = category.category_title || category.group_name;
    if (category.id && name) {
      maps.categoryIdToName[category.id] = name;
      maps.categoryNameToId[name.toLowerCase()] = category.id;
    }
  });
}

/**
 * Get cached data (must call loadSharedData() first)
 */
function getCachedData() {
  if (!window.SharedDataCache.isLoaded) {
    throw new Error('Shared data not loaded. Call loadSharedData() first.');
  }
  return window.SharedDataCache.data;
}

/**
 * Utility functions for accessing cached data
 */
function getPollutantName(id) {
  return window.SharedDataCache.maps.pollutantIdToName[id] || `Pollutant ${id}`;
}

function getPollutantId(name) {
  return window.SharedDataCache.maps.pollutantNameToId[name.toLowerCase()];
}

function getCategoryName(id) {
  return window.SharedDataCache.maps.categoryIdToName[id] || `Category ${id}`;
}

function getCategoryId(name) {
  return window.SharedDataCache.maps.categoryNameToId[name.toLowerCase()];
}

function getPollutantUnit(name) {
  return window.SharedDataCache.maps.pollutantUnits[name] || '';
}

function getAllPollutants() {
  return getCachedData().pollutants;
}

function getAllCategories() {
  return getCachedData().categories;
}

function getAllTimeseries() {
  return getCachedData().timeseries;
}

function getAllNfrCodes() {
  return getCachedData().nfrCodes || [];
}

/**
 * Check if data is already loaded
 */
function isDataLoaded() {
  return window.SharedDataCache.isLoaded;
}

/**
 * Clear cache (useful for testing or forced refresh)
 */
function clearCache() {
  const cache = window.SharedDataCache;
  cache.isLoaded = false;
  cache.isLoading = false;
  cache.loadPromise = null;
  cache.data = { pollutants: [], categories: [], timeseries: [], nfrCodes: [] };
  
  Object.keys(cache.maps).forEach(key => {
    if (typeof cache.maps[key] === 'object') {
      Object.keys(cache.maps[key]).forEach(prop => delete cache.maps[key][prop]);
    }
  });
}

// Export functions to global scope
window.SharedDataLoader = {
  loadSharedData,
  loadDefaultSnapshot,
  bootstrapFullDataset,
  loadHeroDataset,
  getCachedData,
  hasDefaultSnapshot: () => Boolean(window.SharedDataCache.defaultSnapshot),
  getPollutantName,
  getPollutantId,
  getCategoryName,
  getCategoryId,
  getPollutantUnit,
  getAllPollutants,
  getAllCategories,
  getAllTimeseries,
  getAllNfrCodes,
  isDataLoaded,
  clearCache
};

sharedDataDebugLog('Shared Data Loader initialized');