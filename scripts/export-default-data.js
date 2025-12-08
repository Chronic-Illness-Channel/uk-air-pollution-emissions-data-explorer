#!/usr/bin/env node
/*
 * Export the default "hero" dataset used for instant renders when no URL overrides are supplied.
 * The payload mirrors the Supabase tables but only includes:
 *  - Pollutants: PM2.5 + Activity Data
 *  - Categories: All, Ecodesign Stove - Ready To Burn, Gas Boilers
 *  - Timeseries rows for the pollutant/category combinations above
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NAEI_SUPABASE_URL
  || process.env.SUPABASE_URL
  || 'https://buqarqyqlugwaabuuyfy.supabase.co';
const SUPABASE_KEY = process.env.NAEI_SUPABASE_SECRET_KEY
  || process.env.NAEI_SUPABASE_KEY
  || process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1cWFycXlxbHVnd2FhYnV1eWZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyOTczNDEsImV4cCI6MjA3Njg3MzM0MX0._zommN8QkzS0hY__N7KfuIaalKWG-PrSPq1BWg_BBjg';

const OUTPUT_PATH = path.join(__dirname, '..', 'SharedResources', 'default-chart-data.json');

const DEFAULT_LINE_POLLUTANT = 'PM2.5';
const DEFAULT_BUBBLE_POLLUTANT = 'PM2.5';
const DEFAULT_ACTIVITY_POLLUTANT = 'Activity Data';
const DEFAULT_LINE_CATEGORIES = ['All'];
const DEFAULT_BUBBLE_CATEGORIES = ['Ecodesign Stove - Ready To Burn', 'Gas Boilers'];
const DEFAULT_YEAR = 2023;

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
     throw new Error('Supabase credentials are missing. Set NAEI_SUPABASE_URL and NAEI_SUPABASE_SECRET_KEY (or SUPABASE_SECRET_KEY).');
  }

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  console.log('Fetching full pollutant metadata...');
  const { data: pollutantRows, error: pollutantError } = await client
    .from('naei_global_t_pollutant')
    .select('id,pollutant,emission_unit')
    .order('pollutant', { ascending: true });
  if (pollutantError) throw pollutantError;

  if (!pollutantRows || pollutantRows.length === 0) {
    throw new Error('No pollutant metadata returned.');
  }

  console.log('Fetching full category metadata...');
  const { data: categoryRows, error: categoryError } = await client
    .from('naei_global_t_category')
    .select('id,category_title')
    .order('category_title', { ascending: true });
  if (categoryError) throw categoryError;

  if (!categoryRows || categoryRows.length === 0) {
    throw new Error('No category metadata returned.');
  }

  const pollutantIdMap = Object.fromEntries(pollutantRows.map(row => [row.pollutant, row.id]));
  const categoryIdMap = Object.fromEntries(categoryRows.map(row => [row.category_title, row.id]));

  const linePollutantId = pollutantIdMap[DEFAULT_LINE_POLLUTANT];
  const bubblePollutantId = pollutantIdMap[DEFAULT_BUBBLE_POLLUTANT];
  const activityPollutantId = pollutantIdMap[DEFAULT_ACTIVITY_POLLUTANT];

  if (!linePollutantId || !bubblePollutantId || !activityPollutantId) {
    throw new Error('Missing required pollutant IDs in metadata.');
  }

  const lineCategoryIds = DEFAULT_LINE_CATEGORIES.map(name => {
    const id = categoryIdMap[name];
    if (!id) {
      throw new Error(`Missing required line category: ${name}`);
    }
    return id;
  });

  const bubbleCategoryIds = DEFAULT_BUBBLE_CATEGORIES.map(name => {
    const id = categoryIdMap[name];
    if (!id) {
      throw new Error(`Missing required bubble category: ${name}`);
    }
    return id;
  });

  console.log('Fetching line-chart timeseries rows...');
  const { data: lineTimeseriesRows, error: lineTimeseriesError } = await client
    .from('naei_2023ds_t_category_data')
    .select('*')
    .eq('pollutant_id', linePollutantId)
    .in('category_id', lineCategoryIds);
  if (lineTimeseriesError) throw lineTimeseriesError;

  if (!lineTimeseriesRows || !lineTimeseriesRows.length) {
    throw new Error('No timeseries data returned for default line dataset.');
  }

  console.log('Fetching bubble snapshot rows...');
  const { data: bubbleSnapshotRows, error: bubbleSnapshotError } = await client
    .from('naei_2023ds_t_category_data')
    .select('id,pollutant_id,category_id,f2023')
    .in('pollutant_id', [bubblePollutantId, activityPollutantId])
    .in('category_id', bubbleCategoryIds);
  if (bubbleSnapshotError) throw bubbleSnapshotError;

  if (!bubbleSnapshotRows || !bubbleSnapshotRows.length) {
    throw new Error('No bubble snapshot rows returned.');
  }

  console.log('Fetching activity coverage map...');
  const { data: activityCoverageRows, error: activityCoverageError } = await client
    .from('naei_2023ds_t_category_data')
    .select('category_id')
    .eq('pollutant_id', activityPollutantId);
  if (activityCoverageError) throw activityCoverageError;

  const activityCategorySet = new Set(
    (activityCoverageRows || []).map(row => row.category_id)
  );

  const sampleRow = lineTimeseriesRows[0] || {};
  const yearKeys = Object.keys(sampleRow)
    .filter(key => /^f\d{4}$/.test(key))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const years = yearKeys.map(key => key.slice(1));

  const trimmedBubbleRows = bubbleSnapshotRows.map(row => ({
    id: row.id,
    pollutant_id: row.pollutant_id,
    category_id: row.category_id,
    f2023: row.f2023
  }));

  const timeseriesRows = [...lineTimeseriesRows, ...trimmedBubbleRows];

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'supabase',
    defaults: {
      lineChart: {
        pollutant: DEFAULT_LINE_POLLUTANT,
        categories: DEFAULT_LINE_CATEGORIES,
        startYear: years[0] ? Number(years[0]) : null,
        endYear: years[years.length - 1] ? Number(years[years.length - 1]) : null
      },
      bubbleChart: {
        pollutant: DEFAULT_BUBBLE_POLLUTANT,
        activityPollutant: DEFAULT_ACTIVITY_POLLUTANT,
        categories: DEFAULT_BUBBLE_CATEGORIES,
        year: DEFAULT_YEAR
      }
    },
    data: {
      pollutants: pollutantRows.map(row => {
        const base = {
          id: row.id,
          pollutant: row.pollutant
        };
        if (row.pollutant === DEFAULT_LINE_POLLUTANT && row.emission_unit) {
          base.emission_unit = row.emission_unit;
        }
        return base;
      }),
      categories: categoryRows.map(row => ({
        id: row.id,
        category_title: row.category_title,
        has_activity_data: activityCategorySet.has(row.id)
      })),
      timeseries: timeseriesRows,
      yearKeys,
      years,
      bubbleYear: DEFAULT_YEAR
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));

  console.log(`Default dataset written to ${OUTPUT_PATH}`);
  console.log(`Contains ${pollutantRows.length} pollutants, ${categoryRows.length} categories, ${timeseriesRows.length} timeseries rows.`);
}

main().catch(error => {
  console.error('Failed to export default dataset:', error);
  process.exitCode = 1;
});
