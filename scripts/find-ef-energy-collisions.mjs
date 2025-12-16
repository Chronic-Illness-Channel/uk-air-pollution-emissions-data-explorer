#!/usr/bin/env node

/**
 * Scan the live Supabase dataset (or an optional JSON snapshot) to find
 * pollutant/year combinations where the emission-factor leader is also the
 * energy leader. Supports optional filters via --pollutant, --year, and --limit.
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATASET = path.resolve(__dirname, '../SharedResources/default-chart-data.json');
const DEFAULT_SUPABASE_URL = process.env.NAEI_SUPABASE_URL
  || process.env.SUPABASE_URL
  || 'https://buqarqyqlugwaabuuyfy.supabase.co';
const DEFAULT_SUPABASE_KEY = process.env.NAEI_SUPABASE_SECRET_KEY
  || process.env.NAEI_SUPABASE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1cWFycXlxbHVnd2FhYnV1eWZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyOTczNDEsImV4cCI6MjA3Njg3MzM0MX0._zommN8QkzS0hY__N7KfuIaalKWG-PrSPq1BWg_BBjg';
const DEFAULT_SUPABASE_TABLE = process.env.NAEI_SUPABASE_DATA_TABLE
  || process.env.SUPABASE_DATA_TABLE
  || 'naei_2023ds_t_category_data';

function parseArgs(argv) {
  const options = {
    datasetPath: null,
    pollutantFilter: null,
    yearFilter: null,
    limit: 20,
    tableName: DEFAULT_SUPABASE_TABLE,
    activityOverride: null
  };
  const positional = [];

  argv.forEach(arg => {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      return;
    }

    const [rawKey, rawValue = ''] = arg.slice(2).split('=');
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();

    if (key === 'pollutant') {
      const asNumber = Number(value);
      options.pollutantFilter = Number.isFinite(asNumber) ? asNumber : value.toLowerCase();
      return;
    }

    if (key === 'year') {
      const asYear = Number(value);
      if (Number.isFinite(asYear)) {
        options.yearFilter = asYear;
      }
      return;
    }

    if (key === 'limit') {
      const asLimit = Number(value);
      if (Number.isFinite(asLimit) && asLimit > 0) {
        options.limit = asLimit;
      }
      return;
    }

    if (key === 'dataset') {
      options.datasetPath = value ? path.resolve(process.cwd(), value) : DEFAULT_DATASET;
      return;
    }

    if (key === 'table') {
      if (value) {
        options.tableName = value;
      }
      return;
    }

    if (key === 'activity') {
      if (!value) {
        return;
      }
      const numeric = Number(value);
      options.activityOverride = Number.isFinite(numeric) ? numeric : value;
      return;
    }
  });

  if (!options.datasetPath && positional[0]) {
    options.datasetPath = path.resolve(process.cwd(), positional[0]);
  }

  return options;
}

function normalizeNumber(input) {
  if (typeof input === 'number') {
    return input;
  }
  if (typeof input === 'string') {
    const cleaned = input.replace(/,/g, '').trim();
    if (!cleaned) {
      return NaN;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function formatNumber(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  });
}

function stripYearKey(key) {
  if (typeof key !== 'string') {
    return key;
  }
  return key.replace(/^f/i, '');
}

function detectActivityPollutant(dataset, override) {
  const allPollutants = dataset?.data?.pollutants || [];

  if (typeof override === 'number' && Number.isFinite(override)) {
    return override;
  }

  if (typeof override === 'string' && override.trim()) {
    const normalized = override.trim().toLowerCase();
    const match = allPollutants.find(p => String(p.pollutant).toLowerCase() === normalized);
    if (match) {
      return match.id;
    }
  }

  if (dataset?.meta?.activityPollutantId) {
    return dataset.meta.activityPollutantId;
  }

  const activityName = dataset?.defaults?.bubbleChart?.activityPollutant;
  if (activityName) {
    const match = allPollutants.find(p => p.pollutant === activityName);
    if (match) {
      return match.id;
    }
  }

  const fallback = allPollutants.find(p => String(p.pollutant).toLowerCase().includes('activity data'));
  return fallback ? fallback.id : null;
}

function buildTimeseriesMap(timeseries = []) {
  const map = new Map();
  timeseries.forEach(entry => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const key = `${entry.pollutant_id}:${entry.category_id}`;
    map.set(key, entry);
  });
  return map;
}

function getSeriesValue(timeseriesMap, pollutantId, categoryId, yearKey) {
  const entry = timeseriesMap.get(`${pollutantId}:${categoryId}`);
  if (!entry) {
    return NaN;
  }
  return normalizeNumber(entry[yearKey]);
}

function selectLeaders(rows, key) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return { leader: null, follower: null };
  }
  const sorted = [...rows].sort((a, b) => b[key] - a[key]);
  return {
    leader: sorted[0] || null,
    follower: sorted[1] || null
  };
}

async function loadDatasetFromFile(datasetPath) {
  const resolved = datasetPath || DEFAULT_DATASET;
  const raw = await fs.readFile(resolved, 'utf8');
  return JSON.parse(raw);
}

function resolveSupabaseConfig() {
  if (!DEFAULT_SUPABASE_URL || !DEFAULT_SUPABASE_KEY) {
    throw new Error('Supabase credentials are missing. Provide NAEI_SUPABASE_URL and NAEI_SUPABASE_SECRET_KEY (or SUPABASE_URL / SUPABASE_SECRET_KEY)');
  }
  return {
    url: DEFAULT_SUPABASE_URL,
    key: DEFAULT_SUPABASE_KEY
  };
}

async function fetchAllRows(client, tableName, batchSize = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from(tableName)
      .select('*')
      .range(from, from + batchSize - 1);
    if (error) {
      throw error;
    }
    if (!data || data.length === 0) {
      break;
    }
    rows.push(...data);
    if (data.length < batchSize) {
      break;
    }
    from += batchSize;
  }
  return rows;
}

async function fetchDatasetFromSupabase(tableName) {
  const { url, key } = resolveSupabaseConfig();
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  console.log(`Fetching pollutant and category metadata from Supabase (${url})...`);
  const [pollutantsResponse, categoriesResponse] = await Promise.all([
    client
      .from('naei_global_t_pollutant')
      .select('id,pollutant,emission_unit')
      .order('pollutant', { ascending: true }),
    client
      .from('naei_global_t_category')
      .select('id,category_title')
      .order('category_title', { ascending: true })
  ]);

  if (pollutantsResponse.error) {
    throw pollutantsResponse.error;
  }
  if (categoriesResponse.error) {
    throw categoriesResponse.error;
  }

  const pollutants = pollutantsResponse.data || [];
  const categories = categoriesResponse.data || [];

  console.log(`Fetching full timeseries from Supabase table ${tableName}...`);
  const timeseries = await fetchAllRows(client, tableName);
  if (!timeseries.length) {
    throw new Error(`No rows returned from ${tableName}`);
  }

  const sampleRow = timeseries[0];
  const yearKeys = Object.keys(sampleRow)
    .filter(key => /^f\d{4}$/i.test(key))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  const activityMatch = pollutants.find(p => String(p.pollutant).toLowerCase().includes('activity data'));
  const activityPollutantId = activityMatch?.id || null;

  const activityCategorySet = new Set(
    timeseries
      .filter(row => activityPollutantId && row.pollutant_id === activityPollutantId)
      .map(row => row.category_id)
  );

  const augmentedCategories = categories.map(category => ({
    ...category,
    has_activity_data: activityCategorySet.has(category.id)
  }));

  return {
    meta: {
      activityPollutantId
    },
    defaults: {
      bubbleChart: {
        activityPollutant: activityMatch?.pollutant || 'Activity Data'
      }
    },
    data: {
      pollutants,
      categories: augmentedCategories,
      timeseries,
      yearKeys
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataset = options.datasetPath
    ? await loadDatasetFromFile(options.datasetPath)
    : await fetchDatasetFromSupabase(options.tableName);
  const activityPollutantId = detectActivityPollutant(dataset, options.activityOverride);

  if (!activityPollutantId) {
    console.error('Unable to determine Activity Data pollutant id.');
    process.exit(1);
  }

  const categories = dataset?.data?.categories || [];
  const pollutants = dataset?.data?.pollutants || [];
  const timeseries = dataset?.data?.timeseries || [];
  const yearKeys = dataset?.data?.yearKeys || [];

  if (!timeseries.length) {
    console.error('Dataset has no timeseries records.');
    process.exit(1);
  }

  const categoryMap = new Map(categories.map(category => [category.id, category.category_title]));
  const pollutantMap = new Map(pollutants.map(pollutant => [pollutant.id, pollutant.pollutant]));
  const timeseriesMap = buildTimeseriesMap(timeseries);

  const targetPollutants = pollutants.filter(p => p.id !== activityPollutantId);

  const filteredPollutants = targetPollutants.filter(p => {
    if (options.pollutantFilter === null) {
      return true;
    }
    if (typeof options.pollutantFilter === 'number') {
      return p.id === options.pollutantFilter;
    }
    return String(p.pollutant).toLowerCase() === options.pollutantFilter;
  });

  const filteredYearKeys = yearKeys.filter(yearKey => {
    if (!options.yearFilter) {
      return true;
    }
    const yearNumber = Number(stripYearKey(yearKey));
    return yearNumber === options.yearFilter;
  });

  const overlaps = [];
  let inspectedCombos = 0;

  filteredPollutants.forEach(pollutant => {
    filteredYearKeys.forEach(yearKey => {
      const yearNumber = Number(stripYearKey(yearKey));
      if (!Number.isFinite(yearNumber)) {
        return;
      }

      const rows = [];
      timeseries
        .filter(entry => entry.pollutant_id === pollutant.id)
        .forEach(entry => {
          const pollutantValue = normalizeNumber(entry[yearKey]);
          const activityValue = getSeriesValue(timeseriesMap, activityPollutantId, entry.category_id, yearKey);
          if (!Number.isFinite(pollutantValue) || !Number.isFinite(activityValue) || activityValue === 0) {
            return;
          }
          rows.push({
            categoryId: entry.category_id,
            categoryTitle: categoryMap.get(entry.category_id) || `Category ${entry.category_id}`,
            pollutantValue,
            activityValue,
            emissionFactor: pollutantValue / activityValue
          });
        });

      if (rows.length < 2) {
        return;
      }

      inspectedCombos += 1;

      const { leader: energyLeader } = selectLeaders(rows, 'activityValue');
      const { leader: efLeader } = selectLeaders(rows, 'emissionFactor');
      const { leader: pollutionLeader } = selectLeaders(rows, 'pollutantValue');

      if (!energyLeader || !efLeader) {
        return;
      }

      if (energyLeader.categoryId === efLeader.categoryId) {
        overlaps.push({
          pollutantId: pollutant.id,
          pollutantName: pollutantMap.get(pollutant.id) || `Pollutant ${pollutant.id}`,
          year: yearNumber,
          categoryId: energyLeader.categoryId,
          categoryTitle: energyLeader.categoryTitle,
          energyValue: energyLeader.activityValue,
          pollutantValue: energyLeader.pollutantValue,
          emissionFactor: energyLeader.emissionFactor,
          pollutionLeaderTitle: pollutionLeader?.categoryTitle || null,
          pollutionLeaderMatches: pollutionLeader ? pollutionLeader.categoryId === energyLeader.categoryId : false
        });
      }
    });
  });

  const datasetSourceLabel = options.datasetPath
    ? path.relative(process.cwd(), options.datasetPath)
    : `Supabase table ${options.tableName}`;

  console.log(`Scanned ${inspectedCombos} pollutant/year combinations using ${datasetSourceLabel}`);

  if (!overlaps.length) {
    console.log('No overlaps where a category is both the EF leader and energy leader.');
    return;
  }

  console.log(`Found ${overlaps.length} overlaps where the EF leader and energy leader are the same category.`);
  const displayRows = overlaps.slice(0, options.limit);
  displayRows.forEach((row, index) => {
    const prefix = `${index + 1}.`;
    console.log(
      `${prefix} ${row.pollutantName} (${row.year}) — ${row.categoryTitle} | Energy: ${formatNumber(row.energyValue, 1)}, Emission Factor: ${formatNumber(row.emissionFactor, 5)}, Pollution: ${formatNumber(row.pollutantValue, 3)}${row.pollutionLeaderMatches ? ' (also pollution leader)' : ''}`
    );
  });

  if (overlaps.length > displayRows.length) {
    console.log(`…and ${overlaps.length - displayRows.length} more. Use --limit=N to see additional rows.`);
  }

  const summaryByPollutant = overlaps.reduce((map, row) => {
    const key = row.pollutantName;
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());

  console.log('\nOverlaps by pollutant:');
  summaryByPollutant.forEach((count, name) => {
    console.log(`- ${name}: ${count}`);
  });
}

main().catch(error => {
  console.error('Failed to analyse dataset:', error);
  process.exit(1);
});
