/**
 * Shared Color Palette Module
 * Provides consistent color assignment across NAEI data viewers
 * Version: 2.0 (December 2025)
 * Supabase color_source_rules drive explicit assignments with heuristics as fallback.
 */

// Distinct color palette for up to 10 series
const distinctPalette = [
  '#E42020', // Red
  '#3CB44B', // Green
  '#FFE119', // Yellow
  '#4363D8', // Blue
  '#F58231', // Orange
  '#911EB4', // Purple
  '#46F0F0', // Cyan
  '#F032E6', // Magenta
  '#BCF60C', // Lime
  '#FABEBE'  // Pink
];

// Category-based color preferences
const categoryBaseColor = {
  ecodesign: distinctPalette[4],  // Orange
  fireplace: distinctPalette[0],  // Red
  gas: distinctPalette[3],        // Blue
  power: distinctPalette[1],      // Green
  road: distinctPalette[6]        // Cyan
};

const colorTokenHexMap = {
  red: distinctPalette[0],
  green: distinctPalette[1],
  yellow: distinctPalette[2],
  blue: distinctPalette[3],
  orange: distinctPalette[4],
  purple: distinctPalette[5],
  cyan: distinctPalette[6],
  magenta: distinctPalette[7],
  lime: distinctPalette[8],
  pink: distinctPalette[9],
  teal: distinctPalette[6],
  amber: distinctPalette[4],
  grey: '#888888'
};

const paletteTokenOrder = Object.keys(colorTokenHexMap).reduce((map, token, index) => {
  map[token] = index;
  return map;
}, {});

const COLOR_RULES_VIEW = 'color_source_rules_with_sources';
const CATEGORY_METADATA_TABLE = 'naei_global_t_category';
const RULE_RETRY_DELAY_MS = 30000;
const CATEGORY_RETRY_DELAY_MS = 60000;

const ruleFetchState = {
  ready: false,
  promise: null,
  lastFetchedAt: null,
  lastError: null,
  nextRetryAt: 0,
  rulesBySourceId: new Map(),
  rulesBySourceName: new Map()
};

const categorySourceState = {
  index: null,
  promise: null,
  lastFetchedAt: null,
  lastError: null,
  nextRetryAt: 0
};

// Color assignment state
let colorCache = {};
let availableColors = [...distinctPalette];

const stoveFireplaceMatchers = [
  'stove',
  'fireplace',
  'chiminea',
  'fire pit',
  'fire-pit',
  'bonfire'
];

const restrictedGreens = new Set([
  '#3CB44B', // Bright green
  '#BCF60C'  // Lime
]);

const outlineRecommendedHexes = new Set([
  ...distinctPalette,
  '#0A77C4', // Energy card fallback
  '#F26522', // Legacy pollution card
  '#F5A000'  // Current pollution card
]);

function normalizeName(value = '') {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function resolveHexFromToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (colorTokenHexMap[normalized]) {
    return colorTokenHexMap[normalized];
  }
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    return trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
  }
  return null;
}

function ensureSupabaseClient() {
  try {
    if (window.SupabaseConfig?.initSupabaseClient) {
      return window.SupabaseConfig.initSupabaseClient();
    }
  } catch (error) {
    console.warn('[Colors] Supabase client init failed:', error?.message || error);
  }
  return null;
}

function splitMultiValueField(value) {
  if (Array.isArray(value)) {
    return value.map(entry => entry && entry.toString().trim()).filter(Boolean);
  }
  if (typeof value !== 'string') {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (!/[;\n]/.test(trimmed)) {
    return [trimmed];
  }
  return trimmed
    .split(/[;\n]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function extractSourceIdsFromRow(row = {}) {
  const ids = new Set();
  const tryAdd = candidate => {
    const num = Number(candidate);
    if (Number.isFinite(num)) {
      ids.add(num);
    }
  };

  if (row.source_id != null) {
    tryAdd(row.source_id);
  }
  if (Array.isArray(row.source_ids)) {
    row.source_ids.forEach(tryAdd);
  } else if (typeof row.source_ids === 'string') {
    row.source_ids.split(/[;,]+/).forEach(part => tryAdd(part.trim()));
  }

  Object.keys(row).forEach(key => {
    if (!/source.+id/i.test(key)) {
      return;
    }
    if (key === 'source_id' || key === 'source_ids') {
      return;
    }
    tryAdd(row[key]);
  });

  return ids;
}

function buildCategorySourceIndex(rows = []) {
  const index = new Map();
  rows.forEach(row => {
    if (!row || typeof row !== 'object') {
      return;
    }
    const title = row.category_title || row.group_name;
    if (!title) {
      return;
    }
    const normalized = normalizeName(title);
    if (!normalized) {
      return;
    }
    let entry = index.get(normalized);
    if (!entry) {
      entry = {
        id: Number.isFinite(row.id) ? row.id : row.category_id || null,
        title,
        normalizedTitle: normalized,
        sourceIds: new Set(),
        sourceNames: new Set()
      };
      index.set(normalized, entry);
    }

    extractSourceIdsFromRow(row).forEach(id => entry.sourceIds.add(id));
    splitMultiValueField(row.source_name || row.source || row.Source).forEach(name => entry.sourceNames.add(name));
  });
  return index;
}

function getCachedCategoryRows() {
  try {
    if (window.SharedDataLoader?.isDataLoaded?.()) {
      const rows = window.SharedDataLoader.getAllCategories?.();
      if (Array.isArray(rows) && rows.length) {
        return rows;
      }
    }
  } catch (error) {
    console.warn('[Colors] Unable to inspect SharedDataLoader cache:', error?.message || error);
  }

  if (Array.isArray(window.SharedDataCache?.data?.categories) && window.SharedDataCache.data.categories.length) {
    return window.SharedDataCache.data.categories;
  }
  return null;
}

function attemptCategoryIndexBuildFromCache() {
  if (categorySourceState.index) {
    return categorySourceState.index;
  }
  const cachedRows = getCachedCategoryRows();
  if (!cachedRows) {
    return null;
  }
  categorySourceState.index = buildCategorySourceIndex(cachedRows);
  categorySourceState.lastFetchedAt = Date.now();
  return categorySourceState.index;
}

function bootstrapCategoryMetadataFetch() {
  const now = Date.now();
  if (categorySourceState.promise || now < categorySourceState.nextRetryAt) {
    return categorySourceState.promise;
  }
  const client = ensureSupabaseClient();
  if (!client) {
    categorySourceState.nextRetryAt = now + CATEGORY_RETRY_DELAY_MS;
    return null;
  }
  categorySourceState.promise = (async () => {
    const { data, error } = await client
      .from(CATEGORY_METADATA_TABLE)
      .select('*');
    if (error) {
      throw error;
    }
    categorySourceState.index = buildCategorySourceIndex(data || []);
    categorySourceState.lastFetchedAt = Date.now();
    categorySourceState.lastError = null;
    return categorySourceState.index;
  })().catch(error => {
    categorySourceState.lastError = error;
    categorySourceState.nextRetryAt = Date.now() + CATEGORY_RETRY_DELAY_MS;
    categorySourceState.promise = null;
    console.warn('[Colors] Category metadata fetch failed:', error?.message || error);
    return null;
  });
  return categorySourceState.promise;
}

function getCategoryEntryByName(name) {
  if (!name) {
    return null;
  }
  const normalized = normalizeName(name);
  if (!normalized) {
    return null;
  }
  const existingIndex = categorySourceState.index || attemptCategoryIndexBuildFromCache();
  if (existingIndex && existingIndex.has(normalized)) {
    return existingIndex.get(normalized);
  }
  bootstrapCategoryMetadataFetch();
  return null;
}

function indexColorRules(rows = []) {
  ruleFetchState.rulesBySourceId = new Map();
  ruleFetchState.rulesBySourceName = new Map();

  const upsert = (bucketMap, key, rule) => {
    if (!key && key !== 0) {
      return;
    }
    const mapKey = rule.rule_kind === 'exclude' ? 'exclude' : 'assign';
    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = { assign: [], exclude: [] };
      bucketMap.set(key, bucket);
    }
    bucket[mapKey].push(rule);
  };

  rows.forEach(rule => {
    if (!rule) {
      return;
    }
    const colorHex = resolveHexFromToken(rule.color_token);
    if (!colorHex) {
      return;
    }
    const normalizedRule = {
      ...rule,
      color_hex: colorHex,
      priority: Number.isFinite(rule.priority) ? rule.priority : 100
    };
    if (rule.source_id != null) {
      upsert(ruleFetchState.rulesBySourceId, Number(rule.source_id), normalizedRule);
    }
    if (rule.source_name) {
      upsert(ruleFetchState.rulesBySourceName, normalizeName(rule.source_name), normalizedRule);
    }
  });

  const sortBucket = bucket => {
    bucket.assign.sort((a, b) => a.priority - b.priority);
    bucket.exclude.sort((a, b) => a.priority - b.priority);
  };
  ruleFetchState.rulesBySourceId.forEach(sortBucket);
  ruleFetchState.rulesBySourceName.forEach(sortBucket);
}

function ensureRuleBootstrapScheduled() {
  const now = Date.now();
  if (ruleFetchState.ready || ruleFetchState.promise || now < ruleFetchState.nextRetryAt) {
    return ruleFetchState.promise;
  }
  const client = ensureSupabaseClient();
  if (!client) {
    ruleFetchState.nextRetryAt = now + RULE_RETRY_DELAY_MS;
    return null;
  }
  ruleFetchState.promise = (async () => {
    const { data, error } = await client
      .from(COLOR_RULES_VIEW)
      .select('*')
      .order('priority', { ascending: true });
    if (error) {
      throw error;
    }
    indexColorRules(data || []);
    ruleFetchState.ready = true;
    ruleFetchState.lastFetchedAt = Date.now();
    ruleFetchState.lastError = null;
    return ruleFetchState.rulesBySourceId.size;
  })().catch(error => {
    ruleFetchState.lastError = error;
    ruleFetchState.nextRetryAt = Date.now() + RULE_RETRY_DELAY_MS;
    ruleFetchState.promise = null;
    console.warn('[Colors] Color rule fetch failed:', error?.message || error);
    return null;
  });
  return ruleFetchState.promise;
}

function evaluateRulesForCategory(categoryEntry) {
  if (!categoryEntry || !ruleFetchState.ready) {
    return null;
  }

  const disallowedHex = new Set();
  const assignments = [];
  const inspectBucket = bucket => {
    if (!bucket) {
      return;
    }
    bucket.exclude.forEach(rule => disallowedHex.add(rule.color_hex));
    bucket.assign.forEach(rule => {
      assignments.push({
        color_hex: rule.color_hex,
        priority: rule.priority,
        color_token: rule.color_token || '',
        source_id: rule.source_id || null
      });
    });
  };

  categoryEntry.sourceIds.forEach(id => inspectBucket(ruleFetchState.rulesBySourceId.get(id)));
  categoryEntry.sourceNames.forEach(name => inspectBucket(ruleFetchState.rulesBySourceName.get(normalizeName(name))));

  if (!assignments.length && !disallowedHex.size) {
    return null;
  }

  assignments.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    const orderA = paletteTokenOrder[a.color_token?.toLowerCase?.()] ?? distinctPalette.length;
    const orderB = paletteTokenOrder[b.color_token?.toLowerCase?.()] ?? distinctPalette.length;
    return orderA - orderB;
  });

  return {
    preferredHex: assignments[0]?.color_hex || null,
    disallowedHex
  };
}

function getRuleDiagnostics() {
  return {
    ready: ruleFetchState.ready,
    lastFetchedAt: ruleFetchState.lastFetchedAt,
    ruleSources: ruleFetchState.rulesBySourceId.size,
    lastError: ruleFetchState.lastError ? (ruleFetchState.lastError.message || String(ruleFetchState.lastError)) : null
  };
}

function refreshColorRules() {
  ruleFetchState.ready = false;
  ruleFetchState.promise = null;
  ruleFetchState.nextRetryAt = 0;
  ensureRuleBootstrapScheduled();
}

function isStoveOrFireplace(name = '') {
  const lower = String(name).toLowerCase();
  return stoveFireplaceMatchers.some(token => lower.includes(token));
}

function pickNextAvailableColor(disallowed = new Set()) {
  const disallowedSet = disallowed instanceof Set ? disallowed : new Set(disallowed ? [disallowed] : []);
  const usedColors = new Set(Object.values(colorCache));
  const unrestricted = availableColors.filter(color => !usedColors.has(color));
  const filtered = unrestricted.filter(color => !disallowedSet.has(color));
  if (filtered.length) {
    return filtered[0];
  }
  if (unrestricted.length) {
    return unrestricted[0];
  }
  // Fall back to palette cycling if we somehow exhausted every shade
  return distinctPalette[usedColors.size % distinctPalette.length];
}

function markColorAsUsed(color) {
  if (!color || typeof color !== 'string') {
    return;
  }
  const index = availableColors.indexOf(color);
  if (index !== -1) {
    availableColors.splice(index, 1);
  }
}

/**
 * Reset the color assignment system
 */
function resetColorSystem() {
  colorCache = {};
  availableColors = [...distinctPalette];
}

/**
 * Get a consistent color for a category/series name
 * @param {string} name - Category or series name
 * @returns {string} Hex color code
 */
function getColorForCategory(name) {
  if (!name) {
    return '#888888';
  }
  if (colorCache[name]) {
    return colorCache[name];
  }

  // Warm async resources in the background so rule data is ready for imminent calls
  ensureRuleBootstrapScheduled();
  bootstrapCategoryMetadataFetch();

  const normalizedName = String(name);
  const treatAsStoveFireplace = isStoveOrFireplace(normalizedName);
  const disallowedColors = new Set();
  if (treatAsStoveFireplace) {
    restrictedGreens.forEach(color => disallowedColors.add(color));
  }

  let chosenColor = null;
  const categoryEntry = getCategoryEntryByName(normalizedName);
  const ruleAssessment = categoryEntry ? evaluateRulesForCategory(categoryEntry) : null;
  if (ruleAssessment?.disallowedHex?.size) {
    ruleAssessment.disallowedHex.forEach(color => disallowedColors.add(color));
  }

  const usedColors = new Set(Object.values(colorCache));

  if (ruleAssessment?.preferredHex
      && !disallowedColors.has(ruleAssessment.preferredHex)
      && !usedColors.has(ruleAssessment.preferredHex)) {
    chosenColor = ruleAssessment.preferredHex;
  }

  if (!chosenColor) {
    const lower = normalizedName.toLowerCase();
    const cat = Object.keys(categoryBaseColor).find(c => lower.includes(c));
    let baseColor = cat ? categoryBaseColor[cat] : null;
    if (baseColor && disallowedColors.has(baseColor)) {
      baseColor = null;
    }
    if (baseColor && usedColors.has(baseColor)) {
      baseColor = null;
    }
    chosenColor = baseColor;
  }

  if (!chosenColor) {
    chosenColor = pickNextAvailableColor(disallowedColors);
  }

  if (!chosenColor) {
    chosenColor = distinctPalette[Object.keys(colorCache).length % distinctPalette.length];
  }

  colorCache[name] = chosenColor;
  markColorAsUsed(chosenColor);
  return chosenColor;
}

/**
 * Get the current color cache
 * @returns {Object} Map of names to colors
 */
function getColorCache() {
  return { ...colorCache };
}

/**
 * Set a specific color for a name
 * @param {string} name - Category or series name
 * @param {string} color - Hex color code
 */
function setColorForCategory(name, color) {
  colorCache[name] = color;
  markColorAsUsed(color);
}

function shouldOutlineLightCard(color) {
  if (!color || typeof color !== 'string') {
    return false;
  }
  const normalized = color.trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  if (outlineRecommendedHexes.has(normalized)) {
    return true;
  }
  // Allow shorthand hex (e.g., #abc) to still match the recommendation set
  if (/^#([0-9A-F]{3})$/i.test(normalized)) {
    const expanded = normalized.replace(/^#([0-9A-F])([0-9A-F])([0-9A-F])$/i, (_, r, g, b) => (
      `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
    ));
    return outlineRecommendedHexes.has(expanded);
  }
  return false;
}

attemptCategoryIndexBuildFromCache();
ensureRuleBootstrapScheduled();

// Export color functions and constants
window.Colors = {
  distinctPalette,
  categoryBaseColor,
  resetColorSystem,
  getColorForCategory,
  getColorCache,
  setColorForCategory,
  refreshColorRules,
  getRuleDiagnostics,
  shouldOutlineLightCard
};
