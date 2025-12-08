/**
 * Supabase Data Module for Scatter Chart
 * Handles all Supabase database connections, data loading, and analytics tracking
 * v1.0 - Uses shared resources
 */

// Initialize Supabase client and analytics lazily to avoid dependency issues
let supabase = null;

const supabaseInitialParams = new URLSearchParams(window.location.search || '');
const supabaseDebugLoggingEnabled = ['debug', 'logs', 'debugLogs'].some(flag => supabaseInitialParams.has(flag));
const bubbleDataInfoLog = (() => {
  const info = console.info ? console.info.bind(console) : console.log.bind(console);
  return (...args) => info('[Bubble data]', ...args);
})();
const bubbleDataNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
window.__NAEI_DEBUG__ = window.__NAEI_DEBUG__ || supabaseDebugLoggingEnabled;

const bubbleLogger = (() => {
  if (window.BubbleLogger) {
    if (supabaseDebugLoggingEnabled) {
      window.BubbleLogger.setEnabled?.(true);
    }
    return window.BubbleLogger;
  }
  const fallback = {
    enabled: supabaseDebugLoggingEnabled,
    setEnabled() {},
    log: (...args) => {
      if (supabaseDebugLoggingEnabled) {
        console.log('[bubble]', ...args);
      }
    },
    warn: (...args) => {
      if (supabaseDebugLoggingEnabled) {
        console.warn('[bubble]', ...args);
      }
    }
  };
  return fallback;
})();

const supabaseDebugLog = (tag, ...args) => {
  if (!bubbleLogger?.enabled) {
    return;
  }
  const label = typeof tag === 'string' ? tag : 'log';
  const details = typeof tag === 'string' ? args : [tag, ...args];
  bubbleLogger.log(`[supabase:${label}]`, ...details);
};

const supabaseDebugWarn = (...args) => {
  if (!bubbleLogger?.enabled) {
    return;
  }
  bubbleLogger.warn('[supabase]', ...args);
};
let supabaseUnavailableLogged = false;
let localSessionId = null;

function readParentSearchParams() {
  let search = window.location.search || '';
  try {
    if (window.parent && window.parent !== window) {
      const parentSearch = window.parent.location?.search;
      if (typeof parentSearch === 'string') {
        search = parentSearch;
      }
    }
  } catch (error) {
    // Ignore cross-origin issues and fall back to iframe query string
  }
  return new URLSearchParams(search || '');
}

function normalizeChartId(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'bubble' || normalized === 'bubble-chart') {
    return '1';
  }
  if (normalized === '2' || normalized === 'line' || normalized === 'line-chart') {
    return '2';
  }
  return normalized;
}

function isBubbleChartActive(params) {
  const chartParam = normalizeChartId(params.get('chart'));
  if (!chartParam) {
    return true;
  }
  return chartParam === '1';
}

function getEffectiveBubbleUrlParams() {
  return readParentSearchParams();
}

// Initialize client and session ID when first needed
function ensureInitialized() {
  if (!supabase && window.SupabaseConfig) {
    supabase = window.SupabaseConfig.initSupabaseClient();
  }
  if (!localSessionId && window.Analytics) {
    localSessionId = window.Analytics.getSessionId();
  }
  return supabase;
}

// Global data storage
let globalRows = [];
let globalHeaders = [];
let pollutantUnits = {};
let categorisedData = {};
let allCategoriesList = [];
let allPollutants = [];
let allCategories = [];
let activeActDataCategories = [];
let activeActDataCategoryIds = [];
let inactiveActDataCategoryIds = [];
let pollutantsData = []; // Store raw pollutant data for ID lookups
let categoriesData = []; // Store raw category data for ID lookups
let actDataPollutantId = null;

const ACTIVITY_POLLUTANT_NAME = 'Activity Data';
const DEFAULT_BUBBLE_POLLUTANT_NAME = 'PM2.5';
const DEFAULT_BUBBLE_POLLUTANT_ID = 5;
const DEFAULT_BUBBLE_CATEGORY_TITLES = [
  'Ecodesign Stove - Ready To Burn',
  'Gas Boilers'
];
const DEFAULT_BUBBLE_CATEGORY_IDS = [20, 37];
const DEFAULT_BUBBLE_YEAR = 2023;
let hasFullDataset = false;
let latestDatasetSource = null;
const hydrationListeners = new Set();
const urlOverrideParams = [
  'pollutant','pollutantId',
  'category','categories','categoryId','categoryIds','category_ids',
  'activityCategory','actCategory',
  'dataset','year'
];
let categoryMetadataCache = null;
let categoryMetadataPromise = null;
let sharedLoaderReference = null;
let bubbleInitialDatasetInfo = null;
let bubbleFullDatasetPromise = null;
let fullDatasetToastShown = false;

function sortNumericList(values = []) {
  return values.slice().sort((a, b) => a - b);
}

function matchesNumericSet(values = [], defaults = []) {
  if (!values.length || !defaults.length) {
    return false;
  }
  const normalizedValues = sortNumericList(values);
  const normalizedDefaults = sortNumericList(defaults);
  if (normalizedValues.length !== normalizedDefaults.length) {
    return false;
  }
  return normalizedValues.every((value, index) => value === normalizedDefaults[index]);
}

function normalizeNames(list = []) {
  return list
    .map(item => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean)
    .sort();
}

function matchesNameSet(values = [], defaults = []) {
  if (!values.length || !defaults.length) {
    return false;
  }
  const normalizedValues = normalizeNames(values);
  const normalizedDefaults = normalizeNames(defaults);
  if (normalizedValues.length !== normalizedDefaults.length) {
    return false;
  }
  return normalizedValues.every((value, index) => value === normalizedDefaults[index]);
}

function isDefaultBubbleSelection(params = getEffectiveBubbleUrlParams()) {
  const overrideExclusiveParams = ['dataset', 'activityCategory', 'actCategory'];
  if (!isBubbleChartActive(params)) {
    return true;
  }

  if (overrideExclusiveParams.some(param => params.has(param))) {
    return false;
  }

  const pollutantIds = parseIdList(
    params.get('pollutant_id')
    || params.get('pollutantId')
  );
  const pollutantNames = parseNameList(
    params.get('pollutant')
  );
  const categoryIds = parseIdList(
    params.get('category_ids')
    || params.get('categoryIds')
    || params.get('categoryId')
  );
  const categoryNames = parseNameList(
    params.get('categories')
    || params.get('category')
  );

  const pollutantIdsDefault = !pollutantIds.length
    || matchesNumericSet(pollutantIds, [DEFAULT_BUBBLE_POLLUTANT_ID]);
  const pollutantNamesDefault = !pollutantNames.length
    || matchesNameSet(pollutantNames, [DEFAULT_BUBBLE_POLLUTANT_NAME]);
  const categoryIdsDefault = !categoryIds.length
    || matchesNumericSet(categoryIds, DEFAULT_BUBBLE_CATEGORY_IDS);
  const categoryNamesDefault = !categoryNames.length
    || matchesNameSet(categoryNames, DEFAULT_BUBBLE_CATEGORY_TITLES);
  const yearParam = params.get('year');
  const yearDefault = !yearParam || Number(yearParam) === DEFAULT_BUBBLE_YEAR;

  return (
    pollutantIdsDefault
    && pollutantNamesDefault
    && categoryIdsDefault
    && categoryNamesDefault
    && yearDefault
  );
}

function hasUrlOverrides() {
  const params = getEffectiveBubbleUrlParams();
  if (!isBubbleChartActive(params)) {
    return false;
  }
  if (!urlOverrideParams.some(param => params.has(param))) {
    return false;
  }
  return !isDefaultBubbleSelection(params);
}

function mergeRecordCollections(primary = [], secondary = [], keyResolver) {
  const resolver = typeof keyResolver === 'function'
    ? keyResolver
    : (item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        if (item.id != null) {
          return item.id;
        }
        return keyResolver && item[keyResolver] ? item[keyResolver] : null;
      };
  const merged = new Map();

  const ingest = (collection, preferExisting) => {
    collection.forEach(entry => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const key = resolver(entry);
      if (key === null || key === undefined) {
        return;
      }
      if (merged.has(key) && !preferExisting) {
        return;
      }
      merged.set(key, entry);
    });
  };

  ingest(primary, true);
  ingest(secondary, false);

  return Array.from(merged.values());
}

async function loadDefaultSelectorMetadata(sharedLoader) {
  const loader = sharedLoader || window.SharedDataLoader;
  if (!loader?.loadDefaultSnapshot) {
    return null;
  }
  try {
    const snapshot = await loader.loadDefaultSnapshot();
    return snapshot?.data || null;
  } catch (error) {
    supabaseDebugWarn('Unable to load default selector metadata:', error.message || error);
    return null;
  }
}

function parseIdList(value) {
  if (!value) {
    return [];
  }
  return value.split(',').map(part => Number(part.trim())).filter(num => Number.isFinite(num));
}

function parseNameList(value) {
  if (!value) {
    return [];
  }
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

function buildBubbleHeroOptions() {
  const params = getEffectiveBubbleUrlParams();
  if (!isBubbleChartActive(params)) {
    return null;
  }

  const pollutantIds = parseIdList(
    params.get('pollutant_id')
    || params.get('pollutantId')
  );
  const pollutantNames = parseNameList(
    params.get('pollutant')
  );
  const categoryIds = parseIdList(
    params.get('category_ids')
    || params.get('categoryIds')
  );
  const categoryNames = parseNameList(
    params.get('categories')
    || params.get('category')
  );

  if (!pollutantIds.length && !pollutantNames.length) {
    pollutantNames.push(DEFAULT_BUBBLE_POLLUTANT_NAME);
  }

  if (!categoryIds.length && !categoryNames.length) {
    categoryNames.push(...DEFAULT_BUBBLE_CATEGORY_TITLES);
  }

  return {
    pollutantIds,
    pollutantNames,
    categoryIds,
    categoryNames,
    includeActivityData: true,
    activityPollutantName: ACTIVITY_POLLUTANT_NAME,
    defaultPollutantNames: [DEFAULT_BUBBLE_POLLUTANT_NAME],
    defaultCategoryNames: DEFAULT_BUBBLE_CATEGORY_TITLES
  };
}

function resolveHeroLoader(sharedLoader) {
  if (sharedLoader?.loadHeroDataset) {
    return sharedLoader;
  }
  if (window.SharedDataLoader?.loadHeroDataset) {
    return window.SharedDataLoader;
  }
  return null;
}

async function loadBubbleHeroDataset(sharedLoader) {
  const loader = resolveHeroLoader(sharedLoader);
  if (!loader) {
    return null;
  }
  const options = buildBubbleHeroOptions();
  if (!options) {
    return null;
  }
  bubbleDataInfoLog('Requesting bubble hero dataset', {
    pollutants: options.pollutantIds.length || options.pollutantNames.length,
    categories: options.categoryIds.length || options.categoryNames.length
  });
  try {
    const heroDataset = await loader.loadHeroDataset(options);
    return heroDataset;
  } catch (error) {
    bubbleDataInfoLog('Bubble hero dataset unavailable', error.message || error);
    return null;
  }
}

/**
 * Track analytics events to Supabase (wrapper for shared Analytics module)
 * @param {string} eventName - Type of event to track
 * @param {Object} details - Additional event data
 */
async function trackAnalytics(eventName, details = {}) {
  // Use shared Analytics module
  const client = ensureInitialized();
  if (client && window.Analytics) {
    await window.Analytics.trackAnalytics(client, eventName, details);
  }
}

/**
 * Load all data from Supabase for scatter chart (using shared data loader)
 */
async function resolveSharedLoader() {
  try {
    if (window.parent && window.parent.SharedDataLoader) {
      return window.parent.SharedDataLoader;
    }
  } catch (error) {
    // Reduce noise: only log high-level summaries
  }
  return window.SharedDataLoader || null;
}

function getCachedCategoryMetadata(sharedLoader) {
  try {
    if (sharedLoader?.isDataLoaded()) {
      const cached = sharedLoader.getCachedData();
      if (Array.isArray(cached?.categories) && cached.categories.length) {
        return cached.categories;
      }
    }
  } catch (error) {
  }

  if (window.SharedDataCache?.data?.categories?.length) {
    return window.SharedDataCache.data.categories;
  }

  return null;
}

async function ensureAllCategoryMetadata(sharedLoader) {
  if (Array.isArray(categoryMetadataCache) && categoryMetadataCache.length) {
    return categoryMetadataCache;
  }

  const cachedCategories = getCachedCategoryMetadata(sharedLoader);
  if (Array.isArray(cachedCategories) && cachedCategories.length) {
    categoryMetadataCache = cachedCategories;
    return categoryMetadataCache;
  }

  if (!categoryMetadataPromise) {
    categoryMetadataPromise = (async () => {
      const client = ensureInitialized();
      if (!client) {
        throw new Error('Supabase client not available for category metadata');
      }
      const response = await client.from('naei_global_t_category').select('*');
      if (response.error) {
        throw response.error;
      }
      categoryMetadataCache = response.data || [];
      return categoryMetadataCache;
    })().catch(error => {
      console.error('Failed to fetch category metadata:', error);
      categoryMetadataPromise = null;
      throw error;
    });
  }

  return categoryMetadataPromise;
}

function mergeCategoryCollections(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();

  const push = (category) => {
    if (!category || typeof category !== 'object') {
      return;
    }
    const key = category.id
      ?? category.category_id
      ?? category.category_title
      ?? category.group_name;
    if (key == null) {
      merged.push(category);
      return;
    }
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(category);
  };

  primary.forEach(push);
  secondary.forEach(push);

  return merged;
}

function waitForFirstDatasetCandidate(promises = [], logError = () => {}) {
  const activePromises = promises.filter(Boolean);
  if (!activePromises.length) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    let settled = false;
    let pending = activePromises.length;

    const maybeResolve = value => {
      if (settled) {
        return;
      }
      if (value) {
        settled = true;
        resolve(value);
        return;
      }
      pending -= 1;
      if (!settled && pending <= 0) {
        resolve(null);
      }
    };

    activePromises.forEach(promise => {
      Promise.resolve(promise)
        .then(maybeResolve)
        .catch(error => {
          logError(error);
          maybeResolve(null);
        });
    });
  });
}

function triggerBubbleFullDatasetBootstrap(sharedLoader, reason = 'bubble-chart') {
  if (hasFullDataset) {
    return Promise.resolve({ source: 'already-hydrated' });
  }
  if (bubbleFullDatasetPromise) {
    return bubbleFullDatasetPromise;
  }

  const bootstrapReason = `bubble-${reason}`;
  const start = bubbleDataNow();
  const applyFromPayload = (payload, source) => {
    if (!payload) return payload;
    applyHydratedDataset({
      pollutants: payload.pollutants || [],
      categories: payload.categories || [],
      rows: payload.timeseries || payload.rows || payload.data || []
    }, source);
    return payload;
  };

  bubbleFullDatasetPromise = (async () => {
    const loader = sharedLoader || await resolveSharedLoader();

    if (loader?.bootstrapFullDataset) {
      const payload = await loader.bootstrapFullDataset(bootstrapReason);
      bubbleDataInfoLog('Bubble chart full dataset bootstrapped via SharedDataLoader', {
        durationMs: Number((bubbleDataNow() - start).toFixed(1)),
        rows: Array.isArray(payload?.timeseries) ? payload.timeseries.length : payload?.rows?.length || 0
      });
      return applyFromPayload(payload, 'shared-bootstrap');
    }

    if (loader?.loadSharedData) {
      const payload = await loader.loadSharedData();
      bubbleDataInfoLog('Bubble chart full dataset loaded via SharedDataLoader fallback', {
        durationMs: Number((bubbleDataNow() - start).toFixed(1)),
        rows: Array.isArray(payload?.timeseries) ? payload.timeseries.length : 0
      });
      return applyFromPayload(payload, 'shared-loader');
    }

    const directPayload = await loadDataDirectly();
    bubbleDataInfoLog('Bubble chart full dataset loaded directly (no shared loader)', {
      durationMs: Number((bubbleDataNow() - start).toFixed(1)),
      rows: Array.isArray(directPayload?.rows) ? directPayload.rows.length : 0
    });
    return applyFromPayload(directPayload, 'direct');
  })().catch(error => {
    bubbleFullDatasetPromise = null;
    console.error('Bubble chart full dataset bootstrap failed:', error);
    throw error;
  });

  return bubbleFullDatasetPromise;
}

async function loadData(options = {}) {
  const { useDefaultSnapshot = !hasUrlOverrides() } = options;

  const defaultChartMode = Boolean(useDefaultSnapshot);
  const sharedLoader = await resolveSharedLoader();
  let snapshotRequestedAt = null;
  let snapshotPromise = null;

  try {
    await trackAnalytics('page_load', {
      page: 'bubble_chart',
      timestamp: new Date().toISOString()
    });

    let pollutants = [];
    let categories = [];
    let rows = [];
    let metadataPollutants = [];
    let metadataCategories = [];
    const selectCategoriesArray = (source) => {
      if (!source) return [];
      if (Array.isArray(source.categories)) {
        return source.categories;
      }
      if (Array.isArray(source.categories)) {
        return source.categories;
      }
      return [];
    };

    let selectorMetadata = null;
    let selectorMetadataLoaded = false;
    const ensureSelectorMetadata = async () => {
      if (selectorMetadataLoaded) {
        return selectorMetadata;
      }
      selectorMetadata = await loadDefaultSelectorMetadata(sharedLoader);
      if (!selectorMetadata && window.SharedDataCache?.snapshotData) {
        selectorMetadata = window.SharedDataCache.snapshotData;
      }
      selectorMetadataLoaded = true;
      return selectorMetadata;
    };

    const haveData = () => pollutants.length && categories.length && rows.length;

    if (sharedLoader?.isDataLoaded()) {
      const cachedData = sharedLoader.getCachedData();
      pollutants = cachedData.pollutants;
      categories = selectCategoriesArray(cachedData);
      rows = cachedData.timeseries;
      hasFullDataset = true;
      latestDatasetSource = 'cache';
      bubbleDataInfoLog('Bubble chart hydrated from shared cache', {
        pollutants: pollutants.length,
        categories: categories.length,
        rows: rows.length
      });
    }

    if (!haveData() && sharedLoader) {
      const raceCandidates = [];
      if (!sharedLoader.isDataLoaded?.()) {
        const bootstrapPromise = triggerBubbleFullDatasetBootstrap(sharedLoader, 'initial-race');
        raceCandidates.push(
          bootstrapPromise
            .then(payload => {
              if (payload?.pollutants?.length || payload?.timeseries?.length) {
                return { source: 'supabase', payload };
              }
              return null;
            })
            .catch(error => {
              bubbleDataInfoLog('Initial Supabase bootstrap candidate failed', {
                message: error?.message || String(error)
              });
              return null;
            })
        );
      }

      if (defaultChartMode && sharedLoader.loadDefaultSnapshot) {
        snapshotRequestedAt = bubbleDataNow();
        if (!snapshotPromise) {
          snapshotPromise = sharedLoader.loadDefaultSnapshot();
        }
        raceCandidates.push(
          snapshotPromise
            .then(snapshot => {
              if (snapshot?.data) {
                return { source: 'snapshot', snapshot, requestedAt: snapshotRequestedAt };
              }
              return null;
            })
            .catch(error => {
              bubbleDataInfoLog('Default snapshot race candidate failed', {
                message: error?.message || String(error)
              });
              return null;
            })
        );
      }

      if (raceCandidates.length) {
        const initialResult = await waitForFirstDatasetCandidate(raceCandidates, error => {
          bubbleDataInfoLog('Initial dataset candidate rejected', {
            message: error?.message || String(error)
          });
        });

        if (initialResult?.source === 'supabase') {
          const payload = initialResult.payload || {};
          pollutants = payload.pollutants || [];
          categories = selectCategoriesArray(payload);
          rows = payload.timeseries || payload.rows || payload.data || [];
          hasFullDataset = true;
          latestDatasetSource = 'shared-bootstrap';
          bubbleDataInfoLog('Bubble chart fulfilled via initial Supabase bootstrap', {
            pollutants: pollutants.length,
            categories: categories.length,
            rows: rows.length
          });
        } else if (initialResult?.source === 'snapshot') {
          const snapshot = initialResult.snapshot;
          pollutants = snapshot.data.pollutants || [];
          categories = selectCategoriesArray(snapshot.data);
          rows = snapshot.data.timeseries || snapshot.data.rows || snapshot.data.data || [];
          hasFullDataset = false;
          latestDatasetSource = 'snapshot';
          const snapshotDuration = initialResult.requestedAt
            ? Number((bubbleDataNow() - initialResult.requestedAt).toFixed(1))
            : null;
          bubbleDataInfoLog('Bubble chart using default JSON snapshot', {
            durationMs: snapshotDuration,
            generatedAt: snapshot.generatedAt || null,
            summary: {
              pollutants: pollutants.length,
              categories: categories.length,
              rows: rows.length
            }
          });
        }
      }
    }

    if (!haveData()) {
      const heroDataset = await loadBubbleHeroDataset(sharedLoader);
      const heroCategories = selectCategoriesArray(heroDataset);
      if (heroDataset?.pollutants?.length && heroCategories.length) {
        pollutants = heroDataset.pollutants;
        categories = heroCategories;
        rows = heroDataset.timeseries || heroDataset.rows || [];
        hasFullDataset = false;
        latestDatasetSource = 'hero';
        bubbleDataInfoLog('Bubble chart hydrated via Supabase hero dataset', {
          pollutants: pollutants.length,
          categories: categories.length,
          rows: rows.length
        });
        triggerBubbleFullDatasetBootstrap(sharedLoader, defaultChartMode ? 'snapshot-fallback' : 'hero');
      }
    }

    if (!haveData()) {
      if (sharedLoader) {
        try {
          const sharedData = await sharedLoader.loadSharedData();
          pollutants = sharedData.pollutants;
          categories = selectCategoriesArray(sharedData);
          rows = sharedData.timeseries;
          hasFullDataset = true;
          latestDatasetSource = 'shared-loader';
          bubbleDataInfoLog('Bubble chart hydrated via SharedDataLoader', {
            pollutants: pollutants.length,
            categories: categories.length,
            rows: rows.length
          });
        } catch (error) {
          console.error('Shared loader failed, falling back to direct load:', error);
          const result = await loadDataDirectly();
          pollutants = result.pollutants;
          categories = selectCategoriesArray(result);
          rows = result.rows;
          hasFullDataset = true;
          latestDatasetSource = 'direct';
          bubbleDataInfoLog('Bubble chart fulfilled by direct Supabase fetch after shared loader failure', {
            pollutants: pollutants.length,
            categories: categories.length,
            rows: rows.length
          });
        }
      } else {
        const result = await loadDataDirectly();
        pollutants = result.pollutants;
        categories = selectCategoriesArray(result);
        rows = result.rows;
        hasFullDataset = true;
        latestDatasetSource = 'direct';
        bubbleDataInfoLog('Bubble chart fulfilled by direct Supabase fetch (no shared loader)', {
          pollutants: pollutants.length,
          categories: categories.length,
          rows: rows.length
        });
      }
    }

    if (!hasFullDataset) {
      const selectorMetadata = await ensureSelectorMetadata();
      if (selectorMetadata) {
        metadataPollutants = Array.isArray(selectorMetadata.pollutants)
          ? selectorMetadata.pollutants
          : metadataPollutants;
        const selectorCategories = selectCategoriesArray(selectorMetadata);
        metadataCategories = selectorCategories.length ? selectorCategories : metadataCategories;

        if (metadataPollutants.length) {
          pollutants = mergeRecordCollections(
            metadataPollutants,
            pollutants,
            record => {
              if (record?.id != null) {
                return record.id;
              }
              const name = record?.pollutant || record?.Pollutant || '';
              return name ? name.toLowerCase() : null;
            }
          );
        }

        if (metadataCategories.length) {
          categories = mergeRecordCollections(
            metadataCategories,
            categories,
            record => {
              if (record?.id != null) {
                return record.id;
              }
              const title = record?.category_title || record?.group_name || '';
              return title ? title.toLowerCase() : null;
            }
          );
        }
      }
      bubbleDataInfoLog('Applied selector metadata for bubble dropdowns', {
        metadataPollutants: metadataPollutants.length,
        metadataCategories: metadataCategories.length,
        categoriesAfterMerge: categories.length
      });
    }

    const dataset = applyDataset({ pollutants, categories, rows }, {
      enforceActivityDataFilter: hasFullDataset,
      activityMetadata: !hasFullDataset && metadataCategories.length ? metadataCategories : null
    });

    if (!hasFullDataset) {
      ensureAllCategoryMetadata(sharedLoader)
        .then(metadata => {
          if (!Array.isArray(metadata) || !metadata.length) {
            return;
          }
          categoryMetadataCache = mergeCategoryCollections(metadata, categoryMetadataCache || []);
        })
        .catch(error => {
          supabaseDebugWarn('Unable to load full category metadata before hydration:', error.message || error);
        });
    }

    return dataset;

  } catch (error) {
    console.error('Error loading scatter chart data:', error);
    
    // Track error
    await trackAnalytics('error', {
      error_type: 'data_load_error',
      error_message: error.message,
      page: 'bubble_chart'
    });
    
    throw error;
  }
}

/**
 * Get available years from the data
 * @returns {Array} Array of year numbers
 */
function getAvailableYears() {
  if (globalRows.length === 0) return [];
  
  // Get year columns from the data (f1970, f1971, etc.)
  const sampleRow = globalRows[0];
  const yearColumns = Object.keys(sampleRow)
    .filter(key => key.startsWith('f') && !isNaN(parseInt(key.substring(1))))
    .map(key => parseInt(key.substring(1)))
    .sort((a, b) => b - a); // Sort descending (newest first)
  
  return yearColumns;
}

/**
 * Get data for a specific year, pollutant, and categories
 * @param {number} year - Year to get data for
 * @param {number} pollutantId - Pollutant ID
 * @param {Array} categoryIds - Array of category IDs
 * @returns {Array} Array of data points {categoryId, categoryName, actDataValue, pollutantValue}
 */
function getScatterData(year, pollutantId, categoryIds) {
  const yearColumn = `f${year}`;
  const dataPoints = [];

  categoryIds.forEach(categoryId => {
    // Get Activity Data for this category
    const actDataRow = globalRows.find(row => 
      row.pollutant_id === actDataPollutantId && row.category_id === categoryId
    );
    
    // Get pollutant data for this category
    const pollutantRow = globalRows.find(row => 
      row.pollutant_id === pollutantId && row.category_id === categoryId
    );

    if (actDataRow && pollutantRow) {
      const actDataValue = actDataRow[yearColumn];
      const pollutantValue = pollutantRow[yearColumn];
      
      // Only include if both values are valid numbers
      if (actDataValue != null && pollutantValue != null && 
          !isNaN(actDataValue) && !isNaN(pollutantValue)) {
        
        const category = allCategories.find(g => g.id === categoryId);
        dataPoints.push({
          categoryId,
          categoryName: category ? (category.category_title || category.group_name) : `Category ${categoryId}`,
          actDataValue: parseFloat(actDataValue),
          pollutantValue: parseFloat(pollutantValue)
        });
      }
    }
  });

  return dataPoints;
}

/**
 * Get pollutant name by ID
 * @param {number} pollutantId - Pollutant ID
 * @returns {string} Pollutant name
 */
function getPollutantName(pollutantId) {
  const pollutant = allPollutants.find(p => p.id === pollutantId);
  return pollutant ? pollutant.pollutant : `Pollutant ${pollutantId}`;
}

/**
 * Get pollutant unit by ID
 * @param {number} pollutantId - Pollutant ID
 * @returns {string} Pollutant unit
 */
function getPollutantUnit(pollutantId) {
  const pollutant = allPollutants.find(p => p.id === pollutantId);
  return pollutant?.emission_unit || '';
}

/**
 * Get category name by ID
 * @param {number} categoryId - Category ID
 * @returns {string} Category name
 */
function getCategoryName(categoryId) {
  const category = allCategories.find(g => g.id === categoryId);
  return category ? (category.category_title || category.group_name) : `Category ${categoryId}`;
}

function getPollutantShortName(identifier) {
  if (identifier === null || identifier === undefined) {
    return null;
  }

  const normalized = typeof identifier === 'string'
    ? identifier.trim().toLowerCase()
    : null;

  const pollutant = allPollutants.find(p => {
    if (typeof identifier === 'number') {
      return p.id === identifier;
    }
    if (normalized) {
      const candidate = (p.pollutant || p.Pollutant || '').toLowerCase();
      return candidate === normalized;
    }
    return false;
  }) || null;

  const shortName = typeof pollutant?.short_pollutant === 'string'
    ? pollutant.short_pollutant.trim()
    : '';

  if (shortName) {
    return shortName;
  }

  return (pollutant?.pollutant || pollutant?.Pollutant || null);
}

function getCategoryShortTitle(identifier) {
  if (identifier === null || identifier === undefined) {
    return null;
  }

  const normalized = typeof identifier === 'string'
    ? identifier.trim().toLowerCase()
    : null;

  const category = allCategories.find(g => {
    if (typeof identifier === 'number') {
      return g.id === identifier;
    }
    if (normalized) {
      const title = (g.category_title || g.group_name || '').toLowerCase();
      return title === normalized;
    }
    return false;
  }) || null;

  const shortTitle = typeof category?.short_category_title === 'string'
    ? category.short_category_title.trim()
    : '';

  if (shortTitle) {
    return shortTitle;
  }

  return (category?.category_title || category?.group_name || null);
}

function applyDataset({ pollutants = [], categories = [], rows = [] }, options = {}) {
  const {
    enforceActivityDataFilter = true,
    activityMetadata = null
  } = options || {};
  window.allPollutantsData = pollutants;
  window.allCategoryInfo = categories;

  pollutantUnits = {};
  pollutants.forEach(p => {
    if (p.pollutant && p["emission unit"]) {
      pollutantUnits[p.pollutant] = p["emission unit"];
    }
  });

  const actDataPollutant = pollutants.find(p =>
    p.pollutant && p.pollutant.toLowerCase() === ACTIVITY_POLLUTANT_NAME.toLowerCase()
  );

  if (actDataPollutant) {
    actDataPollutantId = actDataPollutant.id;
  } else {
    supabaseDebugWarn('Activity Data not found in pollutants list');
    actDataPollutantId = null;
  }

  allPollutants = pollutants;
  allCategories = categories;
  if (Array.isArray(categories) && categories.length) {
    if (!Array.isArray(categoryMetadataCache) || categories.length > categoryMetadataCache.length) {
      categoryMetadataCache = categories;
    }
  }
  globalRows = rows;
  pollutantsData = pollutants;
  categoriesData = categories;

  if (rows.length > 0) {
    const sample = rows[0];
    const headers = Object.keys(sample)
      .filter(k => /^f\d{4}$/i.test(k))
      .sort((a, b) => +a.slice(1) - +b.slice(1));
    globalHeaders = headers;
    window.globalHeaders = headers;
    window.globalYears = headers.map(h => h.slice(1));
    window.globalYearKeys = headers;
  } else {
    globalHeaders = [];
    window.globalHeaders = [];
    window.globalYears = [];
    window.globalYearKeys = [];
  }

  activeActDataCategories = [];
  activeActDataCategoryIds = [];
  inactiveActDataCategoryIds = [];

  const metadataEntries = Array.isArray(activityMetadata)
    ? activityMetadata.filter(entry => entry && Number.isFinite(entry.id))
    : [];
  const metadataById = metadataEntries.length
    ? new Map(metadataEntries.map(entry => [entry.id, entry]))
    : null;

  const metadataHasActivity = (entry) => {
    if (!entry) {
      return true;
    }
    const rawFlag = entry.hasActivityData ?? entry.has_activity_data;
    if (rawFlag === undefined || rawFlag === null) {
      return true;
    }
    if (typeof rawFlag === 'string') {
      const normalized = rawFlag.trim().toLowerCase();
      if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
      }
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
      }
      return true;
    }
    return Boolean(rawFlag);
  };

  if (enforceActivityDataFilter && actDataPollutantId && globalHeaders.length > 0) {
    const actDataRowsByCategory = new Map();
    globalRows.forEach(row => {
      if (row.pollutant_id === actDataPollutantId) {
        actDataRowsByCategory.set(row.category_id, row);
      }
    });

    categories.forEach(category => {
      const actDataRow = actDataRowsByCategory.get(category.id);

      if (!actDataRow) {
        inactiveActDataCategoryIds.push(category.id);
        return;
      }

      const hasActData = globalHeaders.some(header => {
        const value = actDataRow[header];
        if (value === null || value === undefined) return false;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return false;
        return numeric !== 0;
      });

      if (hasActData) {
        activeActDataCategories.push(category);
        activeActDataCategoryIds.push(category.id);
      } else {
        inactiveActDataCategoryIds.push(category.id);
      }
    });

    if (activeActDataCategories.length === 0 && categories.length > 0) {
      supabaseDebugWarn('No categories reported Activity Data; reverting to full category list.');
      activeActDataCategories = [...categories];
      activeActDataCategoryIds = activeActDataCategories.map(g => g.id);
      inactiveActDataCategoryIds = [];
    }
  } else if (!enforceActivityDataFilter && metadataById) {
    const categoriesWithActData = categories.filter(category => metadataHasActivity(metadataById.get(category.id)));
    if (categoriesWithActData.length) {
      activeActDataCategories = categoriesWithActData;
      activeActDataCategoryIds = activeActDataCategories.map(g => g.id);
      const activeIdSet = new Set(activeActDataCategoryIds);
      inactiveActDataCategoryIds = categories
        .filter(category => !activeIdSet.has(category.id))
        .map(category => category.id);
    } else {
      activeActDataCategories = [...categories];
      activeActDataCategoryIds = activeActDataCategories.map(g => g.id);
      inactiveActDataCategoryIds = [];
    }
  } else {
    activeActDataCategories = [...categories];
    activeActDataCategoryIds = activeActDataCategories.map(g => g.id);
    inactiveActDataCategoryIds = [];
  }

  const allCategoryEntry = categories.find(g => {
    const title = typeof g.category_title === 'string' && g.category_title.trim()
      ? g.category_title
      : g.group_name;
    return typeof title === 'string' && title.trim().toLowerCase() === 'all';
  });
  if (allCategoryEntry) {
    const allCategoryId = allCategoryEntry.id;
    activeActDataCategories = activeActDataCategories.filter(g => g.id !== allCategoryId);
    activeActDataCategoryIds = activeActDataCategoryIds.filter(id => id !== allCategoryId);
    if (!inactiveActDataCategoryIds.includes(allCategoryId)) {
      inactiveActDataCategoryIds.push(allCategoryId);
    }
  }

  const baseCategoriesForDropdown = activeActDataCategories.length > 0 ? activeActDataCategories : categories;
  const categoriesForDropdown = baseCategoriesForDropdown.filter(g => {
    const title = typeof g.category_title === 'string' && g.category_title.trim()
      ? g.category_title
      : g.group_name;
    if (typeof title !== 'string') return true;
    return title.trim().toLowerCase() !== 'all';
  });
  allCategoriesList = categoriesForDropdown
    .map(g => ({
      id: g.id,
      name: g.category_title || g.group_name || `Category ${g.id}`
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (inactiveActDataCategoryIds.length > 0) {
    const inactiveNames = inactiveActDataCategoryIds
      .map(id => {
        const category = categories.find(g => g.id === id);
        return category?.category_title || category?.group_name || `Category ${id}`;
      })
      .filter(Boolean)
      .sort();
    window.categoriesWithoutActData = inactiveNames;
    window.categoriesWithoutActivityData = inactiveNames;
  } else {
    window.categoriesWithoutActData = [];
    window.categoriesWithoutActivityData = [];
  }

  return {
    pollutants: allPollutants,
    categories: allCategories,
    data: globalRows
  };
}

function triggerFullDatasetHydrated(metadata = {}) {
  hydrationListeners.forEach(listener => {
    try {
      listener(metadata);
    } catch (error) {
      console.error('Hydration listener failed:', error);
    }
  });
}

function onFullDatasetHydrated(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  hydrationListeners.add(listener);
  return () => hydrationListeners.delete(listener);
}

function applyHydratedDataset(dataset, source = 'shared-loader') {
  if (!dataset) return;
  const normalizedRows = dataset.rows || dataset.timeseries || dataset.data || [];
  if (!Array.isArray(normalizedRows) || normalizedRows.length === 0) {
    supabaseDebugWarn('Hydrated dataset missing rows; skipping update');
    return;
  }

  const result = applyDataset({
    pollutants: dataset.pollutants || [],
    categories: dataset.categories || [],
    rows: normalizedRows
  }, {
    enforceActivityDataFilter: true
  });

  hasFullDataset = true;
  latestDatasetSource = source;
  triggerFullDatasetHydrated({ source, dataset: result, timestamp: Date.now() });
}

function scheduleFullDatasetLoad(sharedLoader, reason = 'manual') {
  return triggerBubbleFullDatasetBootstrap(sharedLoader, reason);
}


/**
 * Fallback function for direct data loading (when shared loader fails)
 */
async function loadDataDirectly() {
  const client = ensureInitialized();
  if (!client) {
    throw new Error('Supabase client not available');
  }

  const batchStart = bubbleDataNow();
  bubbleDataInfoLog('Starting direct Supabase fetch for bubble chart');
  const timedQuery = (label, promise) => {
    const start = bubbleDataNow();
    bubbleDataInfoLog('Supabase query started', { label });
    return promise.then(response => {
      const duration = Number((bubbleDataNow() - start).toFixed(1));
      if (response?.error) {
        bubbleDataInfoLog('Supabase query failed', {
          label,
          durationMs: duration,
          message: response.error.message || String(response.error)
        });
      } else {
        bubbleDataInfoLog('Supabase query completed', {
          label,
          durationMs: duration,
          rows: Array.isArray(response?.data) ? response.data.length : 0
        });
      }
      return response;
    });
  };

  const [pollutantsResp, groupsResp, dataResp] = await Promise.all([
    timedQuery('naei_global_t_pollutant', client.from('naei_global_t_pollutant').select('*')),
    timedQuery('naei_global_t_category', client.from('naei_global_t_category').select('*')),
    timedQuery('naei_2023ds_t_category_data', client.from('naei_2023ds_t_category_data').select('*'))
  ]);

  if (pollutantsResp.error) throw pollutantsResp.error;
  if (groupsResp.error) throw groupsResp.error;
  if (dataResp.error) throw dataResp.error;

  const payload = {
    pollutants: pollutantsResp.data || [],
    categories: groupsResp.data || [],
    rows: dataResp.data || []
  };

  bubbleDataInfoLog('Direct Supabase fetch completed', {
    durationMs: Number((bubbleDataNow() - batchStart).toFixed(1)),
    summary: {
      pollutants: payload.pollutants.length,
      categories: payload.categories.length,
      rows: payload.rows.length
    }
  });

  return payload;
}

// Create the main export object for this module (defined after all functions)
try {
  window.supabaseModule = {
    get client() { return ensureInitialized(); },
    loadData,
    loadDataDirectly,
    trackAnalytics,
    getAvailableYears,
    getScatterData,
    getPollutantName,
    getPollutantUnit,
    getCategoryName,
    getPollutantShortName,
    getCategoryShortTitle,
    get allPollutants() { return allPollutants; },
    get allCategories() { return allCategories; },
    get allCategoriesList() { return allCategoriesList; },
    get actDataPollutantId() { return actDataPollutantId; },
    get activeActDataCategories() { return activeActDataCategories; },
    get activeActDataCategoryIds() { return activeActDataCategoryIds; },
    get inactiveActDataCategoryIds() { return inactiveActDataCategoryIds; },
    get activeCategories() { return activeActDataCategories; },
    get activeCategoryIds() { return activeActDataCategoryIds; },
    get inactiveCategoryIds() { return inactiveActDataCategoryIds; },
    // Legacy getters maintained temporarily for backwards compatibility
    get activityDataId() { return actDataPollutantId; },
    get hasFullDataset() { return hasFullDataset; },
    get latestDatasetSource() { return latestDatasetSource; },
    scheduleFullDatasetLoad,
    onFullDatasetHydrated
  };
  supabaseDebugLog('module', 'supabaseModule for scatter chart initialized successfully');
} catch (error) {
  console.error('Failed to initialize supabaseModule for scatter chart:', error);
}