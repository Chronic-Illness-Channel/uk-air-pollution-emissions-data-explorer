/**
 * Supabase Data Module
 * Handles all Supabase database connections, data loading, and analytics tracking
 * v2.4 - Now uses shared resources
 */

// Initialize Supabase client and analytics lazily to avoid dependency issues
let supabase = null;

function matchesLineChartParam(value) {
  if (value === null || value === undefined) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '2' || normalized === 'line' || normalized === 'linechart';
}

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
    const pageParam = params.get('page');
    const targetsLineChart = matchesLineChartParam(chartParam) || matchesLineChartParam(pageParam);
    if (!targetsLineChart) {
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
const LINE_SUPABASE_MAX_ATTEMPTS = 3;
const LINE_SUPABASE_RETRY_DELAY_MS = 500;
const lineRetryDelay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function withLineSupabaseRetries(taskFn, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || LINE_SUPABASE_MAX_ATTEMPTS);
  const delayMs = Math.max(0, Number(options.delayMs) || LINE_SUPABASE_RETRY_DELAY_MS);
  const label = options.label || 'supabase-task';
  let attempt = 0;
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await taskFn(attempt);
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      lineSupabaseInfoLog('Supabase attempt failed', { label, attempt, maxAttempts, message });
      if (attempt < maxAttempts) {
        await lineRetryDelay(delayMs);
      }
    }
  }

  const finalError = lastError || new Error(`${label} failed after ${maxAttempts} attempts`);
  throw finalError;
}
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
const systemAnalyticsEvents = new Set([
  'page_drawn',
  'sbase_data_queried',
  'sbase_data_loaded',
  'sbase_data_error',
  'json_data_loaded',
  'linechart_drawn'
]);
const LINE_SUPABASE_DATA_SOURCES = new Set(['hero', 'shared-bootstrap', 'shared-loader', 'direct', 'cache']);
const LINE_FAILURE_EVENT_COOLDOWN_MS = 60000;
const lineFailureEventScopes = new Map();
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

function lineChartIsActive() {
  const chartParam = lineSupabaseUrlParams.get('chart');
  const pageParam = lineSupabaseUrlParams.get('page');
  const explicitTarget = matchesLineChartParam(chartParam) || matchesLineChartParam(pageParam);
  if (explicitTarget) {
    return true;
  }

  try {
    const parentSearch = (window.parent && window.parent !== window)
      ? window.parent.location?.search
      : null;
    const parentParams = parentSearch ? new URLSearchParams(parentSearch) : null;
    const parentChart = parentParams?.get('chart');
    if (parentChart) {
      const normalized = parentChart.trim().toLowerCase();
      if (normalized === '1' || normalized === 'bubble' || normalized === 'bubblechart') {
        return false;
      }
      if (normalized === '2' || normalized === 'line' || normalized === 'linechart') {
        return true;
      }
    }
  } catch (error) {
    /* ignore cross-origin errors */
  }

  return true;
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
  if (!lineChartIsActive()) {
    return false;
  }
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

function getLineSharedSnapshotHelper() {
  if (window.__lineSnapshotHelper) {
    return window.__lineSnapshotHelper;
  }

  let helper = null;
  try {
    if (window.parent && window.parent !== window && window.parent.SharedSnapshotLoader) {
      helper = window.parent.SharedSnapshotLoader;
    }
  } catch (error) {
    helper = null;
  }

  if (!helper && window.SharedSnapshotLoader) {
    helper = window.SharedSnapshotLoader;
  }

  window.__lineSnapshotHelper = helper || null;
  return window.__lineSnapshotHelper;
}

function normalizeLineSnapshot(snapshot) {
  const helper = getLineSharedSnapshotHelper();
  if (helper?.normalizeSnapshotPayload) {
    return helper.normalizeSnapshotPayload(snapshot);
  }
  if (!snapshot?.data) {
    return null;
  }
  const data = snapshot.data;
  const categories = data.categories || data.groups || [];
  return {
    pollutants: data.pollutants || [],
    categories,
    rows: data.timeseries || data.rows || data.data || []
  };
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
async function performLineAnalyticsWrite(eventName, details = {}) {
  const normalizedName = typeof eventName === 'string'
    ? eventName.trim()
    : (eventName || '');
  const payload = { ...details };
  const isSystemEvent = systemAnalyticsEvents.has(normalizedName);

  try {
    if (window.SiteAnalytics) {
      const tracker = isSystemEvent
        ? window.SiteAnalytics.trackSystem
        : window.SiteAnalytics.trackInteraction;
      if (typeof tracker === 'function') {
        await tracker(normalizedName, payload);
        return true;
      }
    }

    const client = ensureInitialized();
    if (client && window.Analytics?.trackAnalytics) {
      const legacyPayload = isSystemEvent
        ? { ...payload, __eventType: 'system' }
        : payload;
      await window.Analytics.trackAnalytics(client, normalizedName, legacyPayload);
      return true;
    }
  } catch (error) {
    lineSupabaseInfoLog('Analytics write skipped', {
      event: normalizedName || 'unknown',
      message: error?.message || String(error)
    });
  }

  return false;
}

async function trackAnalytics(eventName, details = {}) {
  try {
    return await performLineAnalyticsWrite(eventName, details);
  } catch (error) {
    lineSupabaseInfoLog('Analytics tracking failed', {
      event: eventName || 'unknown',
      message: error?.message || String(error)
    });
    return false;
  }
}

function shouldEmitLineFailureEvent(scopeKey = 'linechart', forceEvent = false) {
  if (forceEvent) {
    lineFailureEventScopes.set(scopeKey, Date.now());
    return true;
  }
  const now = Date.now();
  const last = lineFailureEventScopes.get(scopeKey) || 0;
  if (now - last < LINE_FAILURE_EVENT_COOLDOWN_MS) {
    return false;
  }
  lineFailureEventScopes.set(scopeKey, now);
  return true;
}

function swallowLinePromise(promise) {
  if (promise && typeof promise.then === 'function' && typeof promise.catch === 'function') {
    promise.catch(() => {});
  }
}

function resolveLineLoadMode(source) {
  switch (source) {
    case 'hero':
      return 'hero';
    case 'shared-bootstrap':
      return 'full-bootstrap';
    case 'shared-loader':
      return 'full-shared-loader';
    case 'cache':
      return 'full-cache';
    case 'direct':
      return 'full-direct';
    default:
      return 'unknown';
  }
}

function emitLineDatasetLoadedMetrics({ source, rowsCount = 0, startedAt = null, fullDataset = true } = {}) {
  if (!source || !LINE_SUPABASE_DATA_SOURCES.has(source)) {
    return Promise.resolve(false);
  }

  const durationMs = typeof startedAt === 'number'
    ? Number((lineSupabaseNow() - startedAt).toFixed(1))
    : null;

  return trackAnalytics('sbase_data_loaded', {
    page: 'linechart',
    source,
    loadMode: resolveLineLoadMode(source),
    durationMs,
    rows: rowsCount,
    fullDataset: Boolean(fullDataset)
  });
}

function recordLineSupabaseFailure(meta = {}) {
  const error = meta.error;
  const message = meta.message || error?.message || 'Line chart Supabase request failed';
  const source = meta.source || meta.label || 'linechart-supabase';
  const durationMs = typeof meta.durationMs === 'number' ? meta.durationMs : (meta.durationMs || null);
  const attempt = typeof meta.attempt === 'number' ? meta.attempt : (meta.attempt || null);
  const reason = meta.reason || null;
  const analyticsPayload = {
    page: 'linechart',
    source,
    message,
    durationMs,
    attempt,
    reason,
    errorCode: error?.code || null
  };

  const pageSlug = meta.pageSlug || '/linechart';
  const scopeKey = meta.scopeKey || 'linechart';
  const shouldEmitAnalytics = shouldEmitLineFailureEvent(scopeKey, Boolean(meta.forceEvent));

  const tasks = [];
  if (shouldEmitAnalytics) {
    tasks.push(trackAnalytics('sbase_data_error', analyticsPayload));
  }

  if (window.SiteErrors?.log) {
    tasks.push(window.SiteErrors.log({
      pageSlug,
      source,
      severity: meta.severity || 'error',
      message,
      error_code: error?.code || null,
      details: {
        ...meta.details,
        durationMs,
        attempt,
        reason,
        stack: error?.stack || null
      }
    }));
  }

  if (!tasks.length) {
    return Promise.resolve([]);
  }
  return Promise.allSettled(tasks);
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
    swallowLinePromise(emitLineDatasetLoadedMetrics({
      source,
      rowsCount: normalized.rows?.length || globalRows.length || 0,
      startedAt: start,
      fullDataset: true
    }));
    return normalized;
  };

  lineFullDatasetPromise = (async () => {
    const loader = sharedLoader ?? resolveLineSharedLoader();

    if (loader?.bootstrapFullDataset) {
      const payload = await withLineSupabaseRetries(
        () => loader.bootstrapFullDataset(bootstrapReason),
        { label: 'shared-bootstrap' }
      );
      return applyFromPayload(payload, 'shared-bootstrap');
    }

    if (loader?.loadSharedData) {
      const payload = await withLineSupabaseRetries(
        () => loader.loadSharedData(),
        { label: 'shared-loader' }
      );
      return applyFromPayload(payload, 'shared-loader');
    }

    const directPayload = await loadDataDirectly();
    return applyFromPayload(directPayload, 'direct');
  })().catch(error => {
    lineFullDatasetPromise = null;
    lineSupabaseWarnLog('Failed to hydrate full dataset', error.message || error);
    swallowLinePromise(recordLineSupabaseFailure({
      source: 'line-bootstrap',
      label: 'shared-bootstrap',
      reason: bootstrapReason,
      durationMs: Number((lineSupabaseNow() - start).toFixed(1)),
      error
    }));
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

function triggerLineHydration(sharedLoader, reason) {
  triggerLineFullDatasetBootstrap(sharedLoader, reason).catch(error => {
    lineSupabaseInfoLog('Line full dataset hydration failed', {
      reason,
      message: error?.message || String(error)
    });
  });
}

/**
 * Load all data for the line chart (mirrors the bubble chart bootstrap flow)
 * @param {Object} [options]
 * @param {boolean} [options.useDefaultSnapshot]
 */
async function loadData(options = {}) {
  lineSupabaseLog('Loading line chart data using shared data loader...');

  const sharedLoader = resolveLineSharedLoader();
  const sharedSnapshotHelper = getLineSharedSnapshotHelper();
  const urlOverridesActive = lineHasUrlOverrides();
  const { useDefaultSnapshot = !urlOverridesActive } = options;
  const defaultChartMode = Boolean(useDefaultSnapshot);
  const snapshotSourceAvailable = Boolean(
    sharedLoader?.loadDefaultSnapshot
    || sharedSnapshotHelper?.fetchDefaultSnapshotDirect
  );
  const requestDefaultSnapshot = () => {
    if (sharedLoader?.loadDefaultSnapshot) {
      return sharedLoader.loadDefaultSnapshot();
    }
    if (sharedSnapshotHelper?.fetchDefaultSnapshotDirect) {
      return sharedSnapshotHelper.fetchDefaultSnapshotDirect();
    }
    return null;
  };
  const selectCategoriesArray = (source) => {
    if (!source) {
      return [];
    }
    if (Array.isArray(source.categories)) {
      return source.categories;
    }
    if (Array.isArray(source.groups)) {
      return source.groups;
    }
    return [];
  };

  const loadStartedAt = lineSupabaseNow();
  let snapshotPromise = null;
  let snapshotRequestedAt = null;
  let snapshotDuration = null;
  let snapshotGeneratedAt = null;

  let pollutants = [];
  let categories = [];
  let rows = [];
  const haveData = () => pollutants.length && categories.length && rows.length;
  let datasetSource = null;
  let datasetIsFull = false;

  try {
    lineSupabaseInfoLog('Line chart snapshot eligibility', {
      defaultChartMode,
      snapshotSourceAvailable,
      urlOverridesActive,
      sharedLoaderAvailable: Boolean(sharedLoader)
    });
    await trackAnalytics('sbase_data_queried', {
      page: 'linechart',
      hasUrlOverrides: urlOverridesActive,
      snapshotEligible: defaultChartMode && snapshotSourceAvailable,
      sharedLoaderAvailable: Boolean(sharedLoader),
      timestamp: new Date().toISOString()
    });

    if (sharedLoader?.isDataLoaded?.()) {
      lineSupabaseLog('Using cached data from shared loader');
      const cachedData = sharedLoader.getCachedData();
      if (cachedData) {
        pollutants = cachedData.pollutants || [];
        categories = selectCategoriesArray(cachedData);
        rows = cachedData.timeseries || cachedData.rows || [];
        if (haveData()) {
          datasetIsFull = true;
          datasetSource = 'cache';
        }
      }
    }

    const canShortCircuitSnapshot = !haveData()
      && defaultChartMode
      && snapshotSourceAvailable
      && !sharedLoader?.isDataLoaded?.();

    if (canShortCircuitSnapshot) {
      if (!snapshotPromise) {
        snapshotRequestedAt = lineSupabaseNow();
        snapshotPromise = requestDefaultSnapshot();
      }

      if (snapshotPromise) {
        if (!lineHasFullDataset) {
          triggerLineHydration(sharedLoader, 'snapshot-prefetch');
        }

        const snapshot = await snapshotPromise.catch(error => {
          lineSupabaseInfoLog('Immediate line chart snapshot failed', {
            message: error?.message || String(error)
          });
          return null;
        });

        if (snapshot?.data) {
          const normalizedSnapshot = normalizeLineSnapshot(snapshot) || { pollutants: [], categories: [], rows: [] };
          const snapshotCategories = selectCategoriesArray(normalizedSnapshot);
          pollutants = normalizedSnapshot.pollutants || [];
          categories = snapshotCategories;
          rows = normalizedSnapshot.rows || [];
          datasetIsFull = false;
          datasetSource = 'snapshot';
          snapshotDuration = snapshotRequestedAt
            ? Number((lineSupabaseNow() - snapshotRequestedAt).toFixed(1))
            : null;
          snapshotGeneratedAt = normalizedSnapshot.generatedAt || snapshot.generatedAt || null;

          lineSupabaseInfoLog('Line chart rendering from default JSON snapshot (immediate)', {
            durationMs: snapshotDuration,
            generatedAt: snapshotGeneratedAt,
            summary: {
              pollutants: pollutants.length,
              categories: categories.length,
              rows: rows.length
            }
          });

          await trackAnalytics('json_data_loaded', {
            page: 'linechart',
            durationMs: snapshotDuration,
            generatedAt: snapshotGeneratedAt,
            rows: rows.length,
            pollutants: pollutants.length,
            categories: categories.length
          });
        } else {
          snapshotPromise = null;
        }
      }
    }

    if (!haveData() && sharedLoader) {
      const raceCandidates = [];

      if (!sharedLoader.isDataLoaded?.()) {
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
      }

      if (defaultChartMode && snapshotSourceAvailable) {
        snapshotRequestedAt = lineSupabaseNow();
        if (!snapshotPromise) {
          snapshotPromise = requestDefaultSnapshot();
        }
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
      }

      if (raceCandidates.length) {
        const initialResult = await waitForFirstDatasetCandidate(raceCandidates, error => {
          lineSupabaseInfoLog('Initial dataset candidate rejected', {
            message: error?.message || String(error)
          });
        });

        if (initialResult?.source === 'supabase') {
          const payload = initialResult.payload || {};
          pollutants = payload.pollutants || [];
          categories = selectCategoriesArray(payload);
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
          const normalizedSnapshot = normalizeLineSnapshot(initialResult.snapshot) || { pollutants: [], categories: [], rows: [] };
          const snapshotCategories = selectCategoriesArray(normalizedSnapshot);
          pollutants = normalizedSnapshot.pollutants || [];
          categories = snapshotCategories;
          rows = normalizedSnapshot.rows || [];
          datasetIsFull = false;
          datasetSource = 'snapshot';
          snapshotDuration = snapshotRequestedAt
            ? Number((lineSupabaseNow() - snapshotRequestedAt).toFixed(1))
            : null;
          snapshotGeneratedAt = initialResult.snapshot?.generatedAt || null;
          lineSupabaseInfoLog('Line chart using default JSON snapshot', {
            durationMs: snapshotDuration,
            generatedAt: snapshotGeneratedAt,
            summary: {
              pollutants: pollutants.length,
              categories: categories.length,
              rows: rows.length
            }
          });
          await trackAnalytics('json_data_loaded', {
            page: 'linechart',
            durationMs: snapshotDuration,
            generatedAt: snapshotGeneratedAt,
            rows: rows.length,
            pollutants: pollutants.length,
            categories: categories.length
          });
        }
      }
    }

    if (!haveData() && sharedLoader?.isDataLoaded?.()) {
      const cachedData = sharedLoader.getCachedData();
      if (cachedData) {
        pollutants = cachedData.pollutants || [];
        categories = selectCategoriesArray(cachedData);
        rows = cachedData.timeseries || cachedData.rows || [];
        if (haveData()) {
          datasetIsFull = true;
          datasetSource = 'cache';
        }
      }
    }

    if (!haveData()) {
      const heroDataset = await loadLineHeroDataset(sharedLoader);
      const heroCategories = selectCategoriesArray(heroDataset);
      if (heroDataset?.pollutants?.length && heroCategories.length) {
        pollutants = heroDataset.pollutants;
        categories = heroCategories;
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
        const metadataCategories = selectCategoriesArray(selectorMetadata);

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

    if (!haveData()) {
      if (sharedLoader) {
        lineSupabaseLog('Loading data through shared loader');
        try {
          const sharedData = await sharedLoader.loadSharedData();
          pollutants = sharedData.pollutants || [];
          categories = selectCategoriesArray(sharedData);
          rows = sharedData.timeseries || sharedData.rows || [];
          datasetIsFull = true;
          datasetSource = 'shared-loader';
          lineHasFullDataset = true;
        } catch (error) {
          console.error('Failed to load through shared loader, falling back to direct loading:', error);
          const result = await loadDataDirectly();
          pollutants = result.pollutants || [];
          categories = selectCategoriesArray(result);
          rows = result.rows || [];
          datasetIsFull = true;
          datasetSource = 'direct';
          lineHasFullDataset = true;
        }
      } else {
        lineSupabaseLog('No shared loader available, loading data directly');
        const result = await loadDataDirectly();
        pollutants = result.pollutants || [];
        categories = selectCategoriesArray(result);
        rows = result.rows || [];
        datasetIsFull = true;
        datasetSource = 'direct';
        lineHasFullDataset = true;
      }
    }

    if (!haveData()) {
      throw new Error('Line chart dataset unavailable');
    }

    const processed = applyLineDataset({ pollutants, categories, groups: categories, rows }, {
      source: datasetSource,
      markFullDataset: datasetIsFull
    });

    if (!datasetIsFull) {
      const hydrationReason = datasetSource === 'hero'
        ? 'hero'
        : (datasetSource === 'snapshot' ? 'snapshot' : 'post-load');
      triggerLineHydration(sharedLoader, hydrationReason);
    }

    lineSupabaseLog(`Loaded ${rows.length} timeseries rows; ${allPollutants.length} pollutants; ${allCategories.length} categories`);

    await emitLineDatasetLoadedMetrics({
      source: datasetSource,
      rowsCount: rows.length,
      startedAt: loadStartedAt,
      fullDataset: Boolean(datasetIsFull)
    });

    return processed;
  } catch (error) {
    console.error('Error loading line chart data:', error);
    await recordLineSupabaseFailure({
      source: datasetSource || 'unknown',
      durationMs: Number((lineSupabaseNow() - loadStartedAt).toFixed(1)),
      error,
      reason: 'load-data'
    });
    throw error;
  }
}


/**
 * Fallback function for direct data loading (when shared loader fails)
 */
async function loadDataDirectly() {
  return withLineSupabaseRetries(async (attempt) => {
    lineSupabaseLog('Fetching data directly from Supabase...');

    const client = ensureInitialized();
    if (!client) {
      throw new Error('Supabase client not available');
    }

    const batchStart = lineSupabaseNow();
    lineSupabaseInfoLog('Starting direct Supabase fetch for line chart', { attempt });
    const timedQuery = (label, promise) => {
      const start = lineSupabaseNow();
      lineSupabaseInfoLog('Supabase query started', { label, attempt });
      return promise.then(response => {
        const duration = Number((lineSupabaseNow() - start).toFixed(1));
        if (response?.error) {
          lineSupabaseInfoLog('Supabase query failed', {
            label,
            durationMs: duration,
            attempt,
            message: response.error.message || String(response.error)
          });
          swallowLinePromise(recordLineSupabaseFailure({
            source: 'line-direct-query',
            label,
            durationMs: duration,
            attempt,
            reason: 'direct-fetch',
            error: response.error
          }));
        } else {
          lineSupabaseInfoLog('Supabase query completed', {
            label,
            durationMs: duration,
            attempt,
            rows: Array.isArray(response?.data) ? response.data.length : 0
          });
        }
        return response;
      }).catch(error => {
        const duration = Number((lineSupabaseNow() - start).toFixed(1));
        lineSupabaseInfoLog('Supabase query threw', {
          label,
          durationMs: duration,
          attempt,
          message: error?.message || String(error)
        });
        swallowLinePromise(recordLineSupabaseFailure({
          source: 'line-direct-query',
          label,
          durationMs: duration,
          attempt,
          reason: 'direct-fetch',
          error
        }));
        throw error;
      });
    };

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
      attempt,
      summary: {
        pollutants: payload.pollutants.length,
        categories: payload.categories.length,
        rows: payload.rows.length
      }
    });

    return payload;
  }, { label: 'direct-fetch' });
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

