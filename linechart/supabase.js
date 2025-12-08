/**
 * Supabase Data Module
 * Handles all Supabase database connections, data loading, and analytics tracking
 * v2.4 - Now uses shared resources
 */

// Initialize Supabase client and analytics lazily to avoid dependency issues
let supabase = null;

function getLineSearchParams() {
  if (window.__lineSupabaseCachedSearchParams) {
    return window.__lineSupabaseCachedSearchParams;
  }

  let search = window.location.search || '';
  try {
    if (window.parent && window.parent !== window) {
      const parentSearch = window.parent.location?.search;
      if (parentSearch) {
        search = parentSearch;
      }
    }
  } catch (error) {
    // Ignore cross-origin errors; fallback to local search
  }

  const params = new URLSearchParams(search || '');

  try {
    const chartParam = params.get('chart');
    if (chartParam && chartParam !== '2') {
      const overrideKeys = [
        'pollutant','pollutant_id','pollutantId',
        'category','categories','category_id','categoryIds','category_ids',
        'dataset','start_year','end_year','year'
      ];
      overrideKeys.forEach(key => params.delete(key));
    }
  } catch (error) {
    // Ignore parse errors and fall back to whatever params already contain
  }

  window.__lineSupabaseCachedSearchParams = params;
  return window.__lineSupabaseCachedSearchParams;
}

const lineSupabaseUrlParams = getLineSearchParams();
const lineSupabaseDebugLoggingEnabled = ['debug', 'logs', 'debugLogs'].some(flag => lineSupabaseUrlParams.has(flag));
const lineSupabaseDataLoggingEnabled = ['lineDataLogs', 'lineLoaderLogs', 'linechartLogs', 'lineSupabaseLogs'].some(flag => lineSupabaseUrlParams.has(flag));
window.__NAEI_DEBUG__ = window.__NAEI_DEBUG__ || lineSupabaseDebugLoggingEnabled;
const lineSupabaseOriginalConsole = {
  info: console.info ? console.info.bind(console) : console.log.bind(console),
  warn: console.warn ? console.warn.bind(console) : (console.info ? console.info.bind(console) : console.log.bind(console))
};
const lineSupabaseNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

if (!lineSupabaseDebugLoggingEnabled && !lineSupabaseDataLoggingEnabled) {
  console.log = () => {};
  console.info = () => {};
  if (console.debug) {
    console.debug = () => {};
  }
}
const lineSupabaseLog = (...args) => {
  if (!lineSupabaseDataLoggingEnabled) {
    return;
  }
  const target = console.info ? console.info.bind(console) : console.log.bind(console);
  target('[Linechart data]', ...args);
};
const lineSupabaseInfoLog = (...args) => {
  (lineSupabaseOriginalConsole.info || (() => {}))('[Linechart data]', ...args);
};
const lineSupabaseWarnLog = (...args) => {
  (lineSupabaseOriginalConsole.warn || lineSupabaseOriginalConsole.info || (() => {}))('[Linechart data]', ...args);
};
let supabaseUnavailableLogged = false;
let localSessionId = null;

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
let categoryData = {};
let allCategoriesList = [];
let allPollutants = [];
let allCategories = [];
let pollutantsData = []; // Store raw pollutant data for ID lookups
let categoryInfo = []; // Store raw category metadata for ID lookups

const LINE_DEFAULT_POLLUTANT_NAME = 'PM2.5';
const LINE_DEFAULT_POLLUTANT_ID = 5;
const LINE_DEFAULT_CATEGORY_TITLES = ['All'];
const LINE_DEFAULT_CATEGORY_IDS = [1];
const LINE_DEFAULT_START_YEAR = 1970;
const LINE_DEFAULT_END_YEAR = 2023;
const lineUrlOverrideParams = [
  'pollutant','pollutant_id','pollutantId',
  'category','categories','category_id','categoryIds','category_ids',
  'dataset','start_year','end_year','year'
];
let lineHasFullDataset = false;
let lineDatasetSource = null;
let lineFullDatasetPromise = null;

function dispatchLineFullDatasetEvent(detail = {}) {
  const payload = {
    source: detail.source || null,
    timestamp: Date.now()
  };

  try {
    window.dispatchEvent(new CustomEvent('lineFullDatasetHydrated', { detail: payload }));
  } catch (error) {
    try {
      window.dispatchEvent(new Event('lineFullDatasetHydrated'));
    } catch (fallbackError) {
      /* noop */
    }
  }

  if (typeof window.onLineFullDatasetHydrated === 'function') {
    try {
      window.onLineFullDatasetHydrated(payload);
    } catch (handlerError) {
      lineSupabaseWarnLog('onLineFullDatasetHydrated handler failed', handlerError);
    }
  }
}

function resolvePollutantRecord(identifier) {
  if (identifier === null || identifier === undefined) {
    return null;
  }

  const normalized = typeof identifier === 'string'
    ? identifier.trim().toLowerCase()
    : null;

  return pollutantsData.find(p => {
    if (typeof identifier === 'number') {
      return p.id === identifier;
    }
    if (normalized) {
      const primary = (p.pollutant || p.Pollutant || '').toLowerCase();
      return primary === normalized;
    }
    return false;
  }) || null;
}

function resolveCategoryRecord(identifier) {
  if (identifier === null || identifier === undefined) {
    return null;
  }

  const normalized = typeof identifier === 'string'
    ? identifier.trim().toLowerCase()
    : null;

  return categoryInfo.find(g => {
    if (typeof identifier === 'number') {
      return g.id === identifier;
    }
    if (normalized) {
      const title = (g.category_title || g.group_name || '').toLowerCase();
      return title === normalized;
    }
    return false;
  }) || null;
}

function getPollutantShortName(identifier) {
  const record = resolvePollutantRecord(identifier);
  if (!record) {
    return null;
  }

  const shortName = typeof record.short_pollutant === 'string'
    ? record.short_pollutant.trim()
    : '';

  if (shortName) {
    return shortName;
  }

  return record.pollutant || record.Pollutant || null;
}

function getCategoryShortTitle(identifier) {
  const record = resolveCategoryRecord(identifier);
  if (!record) {
    return null;
  }

  const shortTitle = typeof record.short_category_title === 'string'
    ? record.short_category_title.trim()
    : '';

  if (shortTitle) {
    return shortTitle;
  }

  return record.category_title || record.group_name || null;
}

function lineSortNumericList(values = []) {
  return values.slice().sort((a, b) => a - b);
}

function lineMatchesNumericSet(values = [], defaults = []) {
  if (!values.length || !defaults.length) {
    return false;
  }
  const normalizedValues = lineSortNumericList(values);
  const normalizedDefaults = lineSortNumericList(defaults);
  if (normalizedValues.length !== normalizedDefaults.length) {
    return false;
  }
  return normalizedValues.every((value, index) => value === normalizedDefaults[index]);
}

function lineNormalizeNames(list = []) {
  return list
    .map(item => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean)
    .sort();
}

function lineMatchesNameSet(values = [], defaults = []) {
  if (!values.length || !defaults.length) {
    return false;
  }
  const normalizedValues = lineNormalizeNames(values);
  const normalizedDefaults = lineNormalizeNames(defaults);
  if (normalizedValues.length !== normalizedDefaults.length) {
    return false;
  }
  return normalizedValues.every((value, index) => value === normalizedDefaults[index]);
}

function lineExtractCategoryTitle(record) {
  if (!record || typeof record !== 'object') {
    return '';
  }
  const title = record.category_title
    || record.group_name
    || record.title
    || record.group_title
    || '';
  return typeof title === 'string' ? title.trim() : '';
}

function lineSortCategoryNames(names = []) {
  return names.slice().sort((a, b) => {
    const aName = (a || '').toLowerCase();
    const bName = (b || '').toLowerCase();
    if (aName === 'all' && bName !== 'all') {
      return -1;
    }
    if (bName === 'all' && aName !== 'all') {
      return 1;
    }
    return (a || '').localeCompare(b || '');
  });
}

function lineBuildCategoryList(records = []) {
  const seen = new Set();
  const names = [];
  records.forEach(record => {
    const title = lineExtractCategoryTitle(record);
    if (!title) {
      return;
    }
    const key = title.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    names.push(title);
  });
  return lineSortCategoryNames(names);
}

function lineResolveCategoryKey(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  if (record.id != null) {
    return record.id;
  }
  if (record.category_id != null) {
    return record.category_id;
  }
  const title = lineExtractCategoryTitle(record);
  return title ? title.toLowerCase() : null;
}


function lineCollectMetadataCategories() {
  const aggregated = [];
  const appendRecords = (records) => {
    if (!Array.isArray(records)) {
      return;
    }
    records.forEach(record => aggregated.push(record));
  };

  try {
    const loader = resolveLineSharedLoader();
    if (loader?.getAllCategories) {
      try {
        appendRecords(loader.getAllCategories());
      } catch (loaderError) {
        lineSupabaseLog('Unable to read categories via getAllCategories()', loaderError?.message || loaderError);
      }
    }
    if (loader?.getCachedData) {
      try {
        const cached = loader.getCachedData();
        appendRecords(cached?.categories || cached?.groups);
      } catch (cacheError) {
        lineSupabaseLog('Unable to read cached categories from shared loader', cacheError?.message || cacheError);
      }
    }
  } catch (error) {
    lineSupabaseLog('Shared loader unavailable while collecting metadata categories', error?.message || error);
  }

  const snapshotCategories = window.SharedDataCache?.snapshotData?.categories
    || window.SharedDataCache?.defaultSnapshot?.data?.categories
    || null;
  appendRecords(snapshotCategories);

  try {
    if (window.parent && window.parent !== window) {
      const parentSnapshot = window.parent.SharedDataCache?.snapshotData?.categories
        || window.parent.SharedDataCache?.defaultSnapshot?.data?.categories
        || null;
      appendRecords(parentSnapshot);
    }
  } catch (error) {
    /* ignore cross-origin errors */
  }

  appendRecords(window.allCategoryInfo);

  return aggregated;
}

function lineUsesDefaultSelection() {
  if (lineSupabaseUrlParams.has('dataset')) {
    return false;
  }

  const pollutantIds = parseLineIdList(
    lineSupabaseUrlParams.get('pollutant_id')
    || lineSupabaseUrlParams.get('pollutantId')
  );
  const pollutantNames = parseLineNameList(lineSupabaseUrlParams.get('pollutant'));
  const categoryIds = parseLineIdList(
    lineSupabaseUrlParams.get('category_ids')
    || lineSupabaseUrlParams.get('categoryIds')
    || lineSupabaseUrlParams.get('category_id')
  );
  const categoryNames = parseLineNameList(
    lineSupabaseUrlParams.get('category')
    || lineSupabaseUrlParams.get('categories')
  );

  const pollutantIdsDefault = !pollutantIds.length
    || lineMatchesNumericSet(pollutantIds, [LINE_DEFAULT_POLLUTANT_ID]);
  const pollutantNamesDefault = !pollutantNames.length
    || lineMatchesNameSet(pollutantNames, [LINE_DEFAULT_POLLUTANT_NAME]);
  const categoryIdsDefault = !categoryIds.length
    || lineMatchesNumericSet(categoryIds, LINE_DEFAULT_CATEGORY_IDS);
  const categoryNamesDefault = !categoryNames.length
    || lineMatchesNameSet(categoryNames, LINE_DEFAULT_CATEGORY_TITLES);

  const startYearParam = lineSupabaseUrlParams.get('start_year');
  const endYearParam = lineSupabaseUrlParams.get('end_year');
  const singleYearParam = lineSupabaseUrlParams.get('year');
  const startYearDefault = !startYearParam || Number(startYearParam) === LINE_DEFAULT_START_YEAR;
  const endYearDefault = !endYearParam || Number(endYearParam) === LINE_DEFAULT_END_YEAR;
  const singleYearDefault = !singleYearParam;

  return (
    pollutantIdsDefault
    && pollutantNamesDefault
    && categoryIdsDefault
    && categoryNamesDefault
    && startYearDefault
    && endYearDefault
    && singleYearDefault
  );
}

function lineHasUrlOverrides() {
  if (!lineUrlOverrideParams.some(param => lineSupabaseUrlParams.has(param))) {
    return false;
  }
  return !lineUsesDefaultSelection();
}

function lineMergeRecordCollections(primary = [], secondary = [], resolver) {
  const resolveKey = typeof resolver === 'function'
    ? resolver
    : (entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        if (entry.id != null) {
          return entry.id;
        }
        return null;
      };

  const merged = new Map();

  const ingest = (collection, preferExisting) => {
    collection.forEach(record => {
      if (!record || typeof record !== 'object') {
        return;
      }
      const key = resolveKey(record);
      if (key === null || key === undefined) {
        return;
      }
      if (merged.has(key) && !preferExisting) {
        return;
      }
      merged.set(key, record);
    });
  };

  ingest(primary, true);
  ingest(secondary, false);

  return Array.from(merged.values());
}

async function loadLineDefaultSelectorMetadata(sharedLoader) {
  const loader = sharedLoader || window.SharedDataLoader;
  if (!loader?.loadDefaultSnapshot) {
    return null;
  }
  try {
    const snapshot = await loader.loadDefaultSnapshot();
    return snapshot?.data || null;
  } catch (error) {
    lineSupabaseWarnLog('Unable to load default selector metadata', error.message || error);
    return null;
  }
}

function parseLineIdList(value) {
  if (!value) {
    return [];
  }
  return value.split(',').map(part => Number(part.trim())).filter(num => Number.isFinite(num));
}

function parseLineNameList(value) {
  if (!value) {
    return [];
  }
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

function buildLineHeroOptions() {
  const pollutantIds = parseLineIdList(
    lineSupabaseUrlParams.get('pollutant_id')
    || lineSupabaseUrlParams.get('pollutantId')
  );
  const pollutantNames = parseLineNameList(lineSupabaseUrlParams.get('pollutant'));
  const categoryIds = parseLineIdList(
    lineSupabaseUrlParams.get('category_ids')
    || lineSupabaseUrlParams.get('categoryIds')
    || lineSupabaseUrlParams.get('category_id')
  );
  const categoryNames = parseLineNameList(
    lineSupabaseUrlParams.get('category')
    || lineSupabaseUrlParams.get('categories')
  );

  if (!pollutantIds.length && !pollutantNames.length) {
    pollutantNames.push(LINE_DEFAULT_POLLUTANT_NAME);
  }

  if (!categoryIds.length && !categoryNames.length) {
    categoryNames.push(...LINE_DEFAULT_CATEGORY_TITLES);
  }

  return {
    pollutantIds,
    pollutantNames,
    categoryIds,
    categoryNames,
    includeActivityData: false,
    activityPollutantName: null,
    defaultPollutantNames: [LINE_DEFAULT_POLLUTANT_NAME],
    defaultCategoryNames: LINE_DEFAULT_CATEGORY_TITLES
  };
}

function resolveLineSharedLoader() {
  try {
    if (window.parent && window.parent.SharedDataLoader) {
      return window.parent.SharedDataLoader;
    }
  } catch (error) {
    lineSupabaseLog('Cannot access parent shared data loader');
  }
  return window.SharedDataLoader || null;
}

async function loadLineHeroDataset(sharedLoader) {
  const loader = sharedLoader?.loadHeroDataset ? sharedLoader : window.SharedDataLoader;
  if (!loader?.loadHeroDataset) {
    return null;
  }
  const options = buildLineHeroOptions();
  lineSupabaseInfoLog('Requesting line hero dataset', {
    pollutants: options.pollutantIds.length || options.pollutantNames.length,
    categories: options.categoryIds.length || options.categoryNames.length
  });
  try {
    return await loader.loadHeroDataset(options);
  } catch (error) {
    lineSupabaseWarnLog('Line hero dataset unavailable', error.message || error);
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
 * Load pollutant units from Supabase
 */
async function loadUnits() {
  const client = ensureInitialized();
  if (!client) {
    throw new Error('Supabase client not available');
  }
  const { data, error } = await client.from('naei_global_t_pollutant').select('*');
  if (error) throw error;
  pollutantUnits = {};
  data.forEach(r => {
    if (r.Pollutant && r["Emission Unit"]) {
      pollutantUnits[r.Pollutant] = r["Emission Unit"];
    } else if (r.pollutant) {
      pollutantUnits[r.pollutant] = r["emission unit"] || r['Emission Unit'] || '';
    }
  });
}

function applyLineDataset(dataset = {}, options = {}) {
  const wasHydrated = lineHasFullDataset;
  const rowsInput = dataset.rows || dataset.timeseries || [];
  const pollutants = Array.isArray(dataset.pollutants) ? dataset.pollutants : [];
  const categoriesInput = Array.isArray(dataset.categories)
    ? dataset.categories
    : (Array.isArray(dataset.groups) ? dataset.groups : []);
  let categories = Array.isArray(categoriesInput) ? categoriesInput : [];
  const rows = Array.isArray(rowsInput) ? rowsInput : [];

  pollutantsData = pollutants.slice();
  categoryInfo = categories.slice();

  if (categoryInfo.length <= 1) {
    const metadataCategories = lineCollectMetadataCategories();
    if (metadataCategories.length) {
      const mergedCategories = lineMergeRecordCollections(
        categoryInfo,
        metadataCategories,
        lineResolveCategoryKey
      );
      if (mergedCategories.length > categoryInfo.length) {
        lineSupabaseInfoLog('Line chart category metadata replenished', {
          previousCount: categoryInfo.length,
          newCount: mergedCategories.length
        });
      }
      categoryInfo = mergedCategories;
      categories = categoryInfo;
    }
  }

  globalRows = rows.slice();
  pollutantUnits = {};

  window.allPollutantsData = pollutants;
  window.allCategoryInfo = categoryInfo;

  const pollutantIdToName = {};
  pollutants.forEach(p => {
    const id = p.id;
    const name = p.pollutant;
    if (name) {
      pollutantIdToName[id] = name;
      const unit = p.emission_unit || '';
      if (unit) {
        pollutantUnits[name] = unit;
      }
    }
  });

  const groupIdToTitle = {};
  categoryInfo.forEach(g => {
    const id = g.id;
    const title = lineExtractCategoryTitle(g);
    if (title) {
      groupIdToTitle[id] = title;
    }
  });

  allPollutants = [...new Set(Object.values(pollutantIdToName).filter(Boolean))].sort();
  allCategories = lineSortCategoryNames(Object.values(groupIdToTitle).filter(Boolean));

  window.allCategoriesList = allCategories;
  window.allPollutants = allPollutants;
  window.pollutantUnits = pollutantUnits;

  if (!rows.length) {
    window.globalHeaders = [];
    window.globalYears = [];
    window.globalYearKeys = [];
    categoryData = {};
    window.categoryData = categoryData;
    lineSupabaseWarnLog('No timeseries rows found in naei_2023ds_t_category_data');
    if (options.source) {
      lineDatasetSource = options.source;
    }
    if (options.markFullDataset) {
      lineHasFullDataset = true;
    }
    return {
      pollutants,
      categories,
      groups: categories,
      yearKeys: [],
      pollutantUnits,
      categoryData
    };
  }

  const sample = rows[0];
  const headers = Object.keys(sample)
    .filter(key => /^f\d{4}$/.test(key))
    .sort((a, b) => +a.slice(1) - +b.slice(1));
  window.globalHeaders = headers;
  window.globalYears = headers.map(h => h.slice(1));
  window.globalYearKeys = headers;

  categoryData = {};
  rows.forEach(r => {
    const polId = r.pollutant_id;
    const grpId = r.category_id;
    const polName = pollutantIdToName[polId];
    const grpName = groupIdToTitle[grpId];
    if (!polName || !grpName) {
      return;
    }
    if (!categoryData[polName]) {
      categoryData[polName] = {};
    }
    categoryData[polName][grpName] = r;
  });

  const categoriesFromData = [...new Set(Object.values(categoryData).flatMap(pol => Object.keys(pol)))];
  if ((!allCategories || allCategories.length === 0) && categoriesFromData.length) {
    allCategories = categoriesFromData.sort((a, b) => {
      if (a.toLowerCase() === 'all') return -1;
      if (b.toLowerCase() === 'all') return 1;
      return a.localeCompare(b);
    });
    window.allCategoriesList = allCategories;
    lineSupabaseWarnLog('Category list was empty from naei_global_t_category — falling back to categories found in timeseries rows.');
  }

  window.categoryData = categoryData;

  if (options.source) {
    lineDatasetSource = options.source;
  }
  if (options.markFullDataset) {
    lineHasFullDataset = true;
  }

  if (options.markFullDataset && !wasHydrated) {
    dispatchLineFullDatasetEvent({ source: options.source || null });
  }

  return {
    pollutants,
    categories,
    groups: categories,
    yearKeys: headers,
    pollutantUnits,
    categoryData
  };
}

function triggerLineFullDatasetBootstrap(sharedLoader, reason = 'line-chart') {
  if (lineHasFullDataset) {
    return Promise.resolve({ source: 'already-hydrated' });
  }
  if (lineFullDatasetPromise) {
    return lineFullDatasetPromise;
  }

  const bootstrapReason = `line-${reason}`;
  const start = lineSupabaseNow();
  const applyFromPayload = (payload, source) => {
    if (!payload) return payload;
    const normalized = {
      pollutants: payload.pollutants || [],
      categories: payload.categories || payload.groups || [],
      groups: payload.groups || payload.categories || [],
      rows: payload.timeseries || payload.rows || payload.data || []
    };
    applyLineDataset(normalized, {
      source,
      markFullDataset: true
    });
    lineSupabaseInfoLog('Line chart full dataset hydration completed', {
      source,
      durationMs: Number((lineSupabaseNow() - start).toFixed(1)),
      pollutants: normalized.pollutants.length,
      categories: normalized.categories.length,
      rows: normalized.rows?.length || globalRows.length || 0
    });
    return normalized;
  };

  lineFullDatasetPromise = (async () => {
    const loader = sharedLoader ?? resolveLineSharedLoader();

    if (loader?.bootstrapFullDataset) {
      const payload = await loader.bootstrapFullDataset(bootstrapReason);
      return applyFromPayload(payload, 'shared-bootstrap');
    }

    if (loader?.loadSharedData) {
      const payload = await loader.loadSharedData();
      return applyFromPayload(payload, 'shared-loader');
    }

    const directPayload = await loadDataDirectly();
    return applyFromPayload(directPayload, 'direct');
  })().catch(error => {
    lineFullDatasetPromise = null;
    lineSupabaseWarnLog('Failed to hydrate full dataset', error.message || error);
    throw error;
  });

  return lineFullDatasetPromise;
}

function scheduleLineFullDataset(sharedLoader, reason = 'manual') {
  return triggerLineFullDatasetBootstrap(sharedLoader, reason);
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

/**
 * Load all data from Supabase (using shared data loader)
 */
async function loadData() {
  lineSupabaseLog("Loading line chart data using shared data loader...");

  const sharedLoader = resolveLineSharedLoader();
  const canUseSnapshot = !lineHasUrlOverrides();
  let snapshotPromise = null;
  let snapshotRequestedAt = null;

  if (canUseSnapshot && sharedLoader?.loadDefaultSnapshot) {
    snapshotRequestedAt = lineSupabaseNow();
    snapshotPromise = sharedLoader.loadDefaultSnapshot();
  }

  let pollutants = [];
  let categories = [];
  let rows = [];
  let datasetSource = null;
  let datasetIsFull = false;

  if (sharedLoader?.isDataLoaded?.()) {
    lineSupabaseLog("Using cached data from shared loader");
    const cachedData = sharedLoader.getCachedData();
    pollutants = cachedData.pollutants;
    categories = cachedData.categories || cachedData.groups;
    rows = cachedData.timeseries;
    datasetIsFull = true;
    datasetSource = 'cache';
  } else if (sharedLoader) {
    const raceCandidates = [];

    const bootstrapPromise = triggerLineFullDatasetBootstrap(sharedLoader, 'initial-race');
    raceCandidates.push(
      bootstrapPromise
        .then(payload => {
          if (payload?.pollutants?.length || payload?.timeseries?.length) {
            return { source: 'supabase', payload };
          }
          return null;
        })
        .catch(error => {
          lineSupabaseInfoLog('Supabase bootstrap race candidate failed', {
            message: error?.message || String(error)
          });
          return null;
        })
    );

    if (snapshotPromise) {
      raceCandidates.push(
        snapshotPromise
          .then(snapshot => {
            if (snapshot?.data) {
              return { source: 'snapshot', snapshot };
            }
            return null;
          })
          .catch(error => {
            lineSupabaseInfoLog('Default snapshot race candidate failed', {
              message: error?.message || String(error)
            });
            return null;
          })
      );
    }

    const initialResult = await waitForFirstDatasetCandidate(raceCandidates, error => {
      lineSupabaseInfoLog('Initial dataset candidate rejected', {
        message: error?.message || String(error)
      });
    });

    if (initialResult?.source === 'supabase') {
      const payload = initialResult.payload || {};
      pollutants = payload.pollutants || [];
      categories = payload.categories || payload.groups || [];
      rows = payload.timeseries || payload.rows || payload.data || [];
      datasetIsFull = true;
      datasetSource = 'shared-bootstrap';
      lineHasFullDataset = true;
      lineSupabaseInfoLog('Line chart fulfilled via initial Supabase bootstrap', {
        pollutants: pollutants.length,
        categories: categories.length,
        rows: rows.length
      });
    } else if (initialResult?.source === 'snapshot') {
      const snapshot = initialResult.snapshot;
      pollutants = snapshot.data.pollutants || [];
      categories = snapshot.data.categories || snapshot.data.groups || [];
      rows = snapshot.data.timeseries || snapshot.data.rows || snapshot.data.data || [];
      datasetIsFull = false;
      datasetSource = 'snapshot';
      const snapshotDuration = snapshotRequestedAt
        ? Number((lineSupabaseNow() - snapshotRequestedAt).toFixed(1))
        : null;
      lineSupabaseInfoLog('Line chart using default JSON snapshot', {
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

  if ((!pollutants.length || !categories.length || !rows.length) && sharedLoader?.isDataLoaded?.()) {
    const cachedData = sharedLoader.getCachedData();
    pollutants = cachedData.pollutants;
    categories = cachedData.categories || cachedData.groups;
    rows = cachedData.timeseries;
    datasetIsFull = true;
    datasetSource = 'cache';
  }

  if (!pollutants.length || !categories.length || !rows.length) {
    const heroDataset = await loadLineHeroDataset(sharedLoader);
    if (heroDataset?.pollutants?.length && (heroDataset.categories?.length || heroDataset.groups?.length)) {
      pollutants = heroDataset.pollutants;
      categories = heroDataset.categories || heroDataset.groups;
      rows = heroDataset.timeseries || heroDataset.rows || [];
      datasetIsFull = false;
      datasetSource = 'hero';
      lineSupabaseInfoLog('Line chart hydrated via Supabase hero dataset', {
        pollutants: pollutants.length,
        categories: categories.length,
        rows: rows.length
      });
      scheduleLineFullDataset(sharedLoader, 'hero');
    }
  }

  if (datasetSource === 'hero') {
    const selectorMetadata = await loadLineDefaultSelectorMetadata(sharedLoader);
    if (selectorMetadata) {
      const metadataPollutants = Array.isArray(selectorMetadata.pollutants)
        ? selectorMetadata.pollutants
        : [];
      const metadataCategories = Array.isArray(selectorMetadata.categories)
        ? selectorMetadata.categories
        : (Array.isArray(selectorMetadata.groups) ? selectorMetadata.groups : []);

      if (metadataPollutants.length) {
        pollutants = lineMergeRecordCollections(
          pollutants,
          metadataPollutants,
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
        categories = lineMergeRecordCollections(
          categories,
          metadataCategories,
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
  }

  if (!pollutants.length || !categories.length || !rows.length) {
    if (sharedLoader) {
      lineSupabaseLog("Loading data through shared loader");
      try {
        const sharedData = await sharedLoader.loadSharedData();
        pollutants = sharedData.pollutants;
        categories = sharedData.categories || sharedData.groups;
        rows = sharedData.timeseries;
        datasetIsFull = true;
        datasetSource = 'shared-loader';
      } catch (error) {
        console.error("Failed to load through shared loader, falling back to direct loading:", error);
        const result = await loadDataDirectly();
        pollutants = result.pollutants;
        categories = result.categories || result.groups;
        rows = result.rows;
        datasetIsFull = true;
        datasetSource = 'direct';
      }
    } else {
      lineSupabaseLog("No shared loader available, loading data directly");
      const result = await loadDataDirectly();
      pollutants = result.pollutants;
      categories = result.categories || result.groups;
      rows = result.rows;
      datasetIsFull = true;
      datasetSource = 'direct';
    }
  }

  const processed = applyLineDataset({ pollutants, categories, groups: categories, rows }, {
    source: datasetSource,
    markFullDataset: datasetIsFull
  });

  lineSupabaseLog(`Loaded ${rows.length} timeseries rows; ${allPollutants.length} pollutants; ${allCategories.length} categories`);
  return processed;
}


/**
 * Fallback function for direct data loading (when shared loader fails)
 */
async function loadDataDirectly() {
  lineSupabaseLog("Fetching data directly from Supabase...");

  const client = ensureInitialized();
  if (!client) {
    throw new Error('Supabase client not available');
  }

  const batchStart = lineSupabaseNow();
  lineSupabaseInfoLog('Starting direct Supabase fetch for line chart');
  const timedQuery = (label, promise) => {
    const start = lineSupabaseNow();
    lineSupabaseInfoLog('Supabase query started', { label });
    return promise.then(response => {
      const duration = Number((lineSupabaseNow() - start).toFixed(1));
      if (response?.error) {
        lineSupabaseInfoLog('Supabase query failed', {
          label,
          durationMs: duration,
          message: response.error.message || String(response.error)
        });
      } else {
        lineSupabaseInfoLog('Supabase query completed', {
          label,
          durationMs: duration,
          rows: Array.isArray(response?.data) ? response.data.length : 0
        });
      }
      return response;
    });
  };

  // Fetch pollutants, categories, and the timeseries table separately
  const [pollutantsResp, categoriesResp, dataResp] = await Promise.all([
    timedQuery('naei_global_t_pollutant', client.from('naei_global_t_pollutant').select('*')),
    timedQuery('naei_global_t_category', client.from('naei_global_t_category').select('*')),
    timedQuery('naei_2023ds_t_category_data', client.from('naei_2023ds_t_category_data').select('*'))
  ]);

  if (pollutantsResp.error) throw pollutantsResp.error;
  if (categoriesResp.error) throw categoriesResp.error;
  if (dataResp.error) throw dataResp.error;

  const payload = {
    pollutants: pollutantsResp.data || [],
    categories: categoriesResp.data || [],
    groups: categoriesResp.data || [],
    rows: dataResp.data || []
  };

  lineSupabaseInfoLog('Direct Supabase fetch completed', {
    durationMs: Number((lineSupabaseNow() - batchStart).toFixed(1)),
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
    getPollutantShortName,
    getCategoryShortTitle,
    // Temporary alias to avoid breaking older entry points while category rename rolls out
    getGroupShortTitle: getCategoryShortTitle
  };
  lineSupabaseLog('supabaseModule initialized successfully');
} catch (error) {
  console.error('Failed to initialize supabaseModule:', error);
}

