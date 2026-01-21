(function (global) {
  const CATEGORY_TABLE = 'naei_global_t_category';
  const CATEGORY_ALL_SOURCES_TOKEN = '__ALL_SOURCES__';
  const CATEGORY_ALL_FUELS_TOKEN = '__ALL_FUELS__';

  const state = {
    metadata: null,
    metadataPromise: null,
    compositionMap: null,
    compositionPromise: null
  };

  // Avoid blocking chart renders forever if Supabase category metadata is slow or unreachable.
  const CATEGORY_META_TIMEOUT_MS = 4000;

  function getSupabaseClient() {
    try {
      if (global.SupabaseConfig?.initSupabaseClient) {
        return global.SupabaseConfig.initSupabaseClient();
      }
    } catch (error) {
      console.warn('[EcoReplacementUtils] Supabase client init failed:', error?.message || error);
    }
    return null;
  }

  function normalizeNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }
    if (typeof value === 'string') {
      const cleaned = value.replace(/,/g, '').trim();
      if (!cleaned) {
        return NaN;
      }
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    if (value == null) {
      return NaN;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
  }

  function sumActivityValues(...values) {
    return values.reduce((total, value) => {
      const numericValue = normalizeNumber(value);
      if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return total;
      }
      return total + numericValue;
    }, 0);
  }

  function calculateEmissionFactor(dataPoint) {
    if (!dataPoint) {
      return null;
    }
    const pollutionValue = normalizeNumber(dataPoint.pollutantValue);
    const activityValue = normalizeNumber(dataPoint.actDataValue);
    if (!Number.isFinite(pollutionValue) || !Number.isFinite(activityValue) || activityValue === 0) {
      return null;
    }
    return pollutionValue / activityValue;
  }

  function resolveYearKey(year) {
    if (typeof year === 'string') {
      if (year.startsWith('f')) {
        return year;
      }
      if (/^\d{4}$/.test(year)) {
        return `f${year}`;
      }
    }
    const numeric = Number(year);
    if (Number.isFinite(numeric)) {
      return `f${numeric}`;
    }
    return null;
  }

  function createTimeseriesIndex(rows = []) {
    const index = new Map();
    rows.forEach(row => {
      const pollutantId = Number(row?.pollutant_id ?? row?.pollutantId);
      const categoryId = Number(row?.category_id ?? row?.categoryId);
      if (!Number.isFinite(pollutantId) || !Number.isFinite(categoryId)) {
        return;
      }
      index.set(`${pollutantId}|${categoryId}`, row);
    });
    return index;
  }

  function getTimeseriesValue(index, pollutantId, categoryId, year) {
    if (!index || !Number.isFinite(Number(pollutantId)) || !Number.isFinite(Number(categoryId))) {
      return NaN;
    }
    const key = `${Number(pollutantId)}|${Number(categoryId)}`;
    const row = index.get(key);
    if (!row) {
      return NaN;
    }
    const yearKey = resolveYearKey(year);
    if (!yearKey) {
      return NaN;
    }
    return normalizeNumber(row[yearKey]);
  }

  async function ensureCategoryMetadata(sharedLoader) {
    if (Array.isArray(state.metadata) && state.metadata.length) {
      return state.metadata;
    }
    if (state.metadataPromise) {
      return state.metadataPromise;
    }
    state.metadataPromise = (async () => {
      const fetchMetadata = async () => {
        if (sharedLoader?.getAllCategoryMetadata) {
          try {
            const cached = await sharedLoader.getAllCategoryMetadata();
            if (Array.isArray(cached) && cached.length) {
              state.metadata = cached;
              return state.metadata;
            }
          } catch (error) {
            console.warn('[EcoReplacementUtils] Shared loader category metadata unavailable:', error?.message || error);
          }
        }
        const client = getSupabaseClient();
        if (!client) {
          console.warn('[EcoReplacementUtils] Supabase client missing; category inclusion will be inconclusive.');
          return [];
        }
        const response = await client.from(CATEGORY_TABLE).select('*');
        if (response.error) {
          throw response.error;
        }
        state.metadata = response.data || [];
        return state.metadata;
      };

      const result = await Promise.race([
        fetchMetadata(),
        new Promise(resolve => setTimeout(() => {
          console.warn('[EcoReplacementUtils] Category metadata fetch timed out; proceeding without inclusion signals.');
          resolve([]);
        }, CATEGORY_META_TIMEOUT_MS))
      ]);

      return result;
    })().catch(error => {
      state.metadataPromise = null;
      console.warn('[EcoReplacementUtils] Category metadata fetch failed:', error?.message || error);
      throw error;
    });
    return state.metadataPromise;
  }

  function normalizeCategoryValue(value) {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    return String(value).trim();
  }

  function isCategoryNullToken(value) {
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return !trimmed || trimmed.toLowerCase() === 'null';
    }
    return false;
  }

  function splitCategoryMultiValue(value) {
    if (Array.isArray(value)) {
      return value
        .map(normalizeCategoryValue)
        .filter(entry => entry && !isCategoryNullToken(entry));
    }
    const normalized = normalizeCategoryValue(value);
    if (!normalized || isCategoryNullToken(normalized)) {
      return [];
    }
    if (!/[;\n]/.test(normalized)) {
      return [normalized];
    }
    return normalized
      .split(/[;\n]+/)
      .map(entry => entry.trim())
      .filter(entry => entry && !isCategoryNullToken(entry));
  }

  function splitCategoryCodeList(value) {
    const normalized = normalizeCategoryValue(value);
    if (!normalized) {
      return [];
    }
    return normalized
      .split(/[;,\n]+/)
      .map(entry => entry.trim())
      .filter(entry => entry && !isCategoryNullToken(entry));
  }

  function buildCategoryCompositionMap(rows = []) {
    const map = new Map();
    rows.forEach(row => {
      const id = Number(row?.id ?? row?.category_id);
      if (!Number.isFinite(id)) {
        return;
      }
      const title = normalizeCategoryValue(row?.category_title || row?.group_name || row?.name);
      let entry = map.get(id);
      if (!entry) {
        entry = {
          id,
          title,
          sources: new Set(),
          activities: new Set(),
          sourceToActivities: new Map(),
          nfrCodes: new Set(),
          coversAllSources: false,
          coversAllFuels: false,
          hasSourceSignals: false,
          hasActivitySignals: false
        };
        map.set(id, entry);
      }

      const sourceValues = splitCategoryMultiValue(row?.source_name ?? row?.source ?? row?.Source);
      const activityValues = splitCategoryMultiValue(row?.activity_name ?? row?.activity ?? row?.Activity);
      const nfrValues = splitCategoryCodeList(row?.nfr_code ?? row?.nfr_codes ?? '');

      if (nfrValues.length) {
        entry.hasSourceSignals = true;
        nfrValues.forEach(code => entry.nfrCodes.add(code));
      }

      if (!sourceValues.length) {
        entry.coversAllSources = true;
        sourceValues.push(CATEGORY_ALL_SOURCES_TOKEN);
      } else {
        entry.hasSourceSignals = true;
      }

      if (!activityValues.length) {
        entry.coversAllFuels = true;
        activityValues.push(CATEGORY_ALL_FUELS_TOKEN);
      } else {
        entry.hasActivitySignals = true;
      }

      sourceValues.forEach(source => {
        if (source !== CATEGORY_ALL_SOURCES_TOKEN) {
          entry.sources.add(source);
        }
        let activitySet = entry.sourceToActivities.get(source);
        if (!activitySet) {
          activitySet = new Set();
          entry.sourceToActivities.set(source, activitySet);
        }
        activityValues.forEach(activity => {
          if (activity !== CATEGORY_ALL_FUELS_TOKEN) {
            entry.activities.add(activity);
          }
          activitySet.add(activity);
        });
      });
    });
    return map;
  }

  function doesActivitySetCoverAllFuels(activitySet) {
    if (!activitySet || !activitySet.size) {
      return true;
    }
    return activitySet.has(CATEGORY_ALL_FUELS_TOKEN);
  }

  function collectContainerActivitySet(container, sourceKey) {
    const merged = new Set();
    const specificSet = container.sourceToActivities.get(sourceKey);
    const globalSet = container.sourceToActivities.get(CATEGORY_ALL_SOURCES_TOKEN);
    if (specificSet) {
      specificSet.forEach(value => merged.add(value));
    }
    if (globalSet) {
      globalSet.forEach(value => merged.add(value));
    }
    return merged;
  }

  function evaluateCategorySubset(candidate, container) {
    if (!candidate || !container) {
      return null;
    }

    const candidateHasSources = candidate.hasSourceSignals || candidate.nfrCodes.size;
    if (!candidateHasSources) {
      return null;
    }

    if (!candidate.sourceToActivities.size && candidate.nfrCodes.size) {
      if (!container.nfrCodes.size) {
        return null;
      }
      const subset = Array.from(candidate.nfrCodes).every(code => container.nfrCodes.has(code));
      return subset;
    }

    const containerSupportsAllSources = container.coversAllSources || container.sourceToActivities.has(CATEGORY_ALL_SOURCES_TOKEN);
    if (!containerSupportsAllSources && !container.sourceToActivities.size) {
      return null;
    }

    for (const [sourceKey, candidateActivities] of candidate.sourceToActivities.entries()) {
      const normalizedSource = sourceKey || CATEGORY_ALL_SOURCES_TOKEN;
      const sourceCovered = normalizedSource === CATEGORY_ALL_SOURCES_TOKEN
        ? containerSupportsAllSources
        : containerSupportsAllSources
          || container.sourceToActivities.has(normalizedSource)
          || container.sources.has(normalizedSource);

      if (!sourceCovered) {
        return false;
      }

      if (doesActivitySetCoverAllFuels(candidateActivities)) {
        if (container.coversAllFuels) {
          continue;
        }
        const containerActivities = collectContainerActivitySet(container, normalizedSource);
        if (!doesActivitySetCoverAllFuels(containerActivities)) {
          return false;
        }
        continue;
      }

      if (container.coversAllFuels) {
        continue;
      }

      const containerActivities = collectContainerActivitySet(container, normalizedSource);
      if (!containerActivities.size) {
        return false;
      }
      if (doesActivitySetCoverAllFuels(containerActivities)) {
        continue;
      }

      for (const activity of candidateActivities) {
        if (activity === CATEGORY_ALL_FUELS_TOKEN) {
          if (!doesActivitySetCoverAllFuels(containerActivities)) {
            return false;
          }
          continue;
        }
        if (!containerActivities.has(activity)) {
          return false;
        }
      }
    }

    if (candidate.nfrCodes.size && container.nfrCodes.size) {
      const subset = Array.from(candidate.nfrCodes).every(code => container.nfrCodes.has(code));
      if (!subset) {
        return false;
      }
    }

    return true;
  }

  async function ensureCompositionMap(sharedLoader) {
    if (state.compositionMap) {
      return state.compositionMap;
    }
    if (!state.compositionPromise) {
      state.compositionPromise = (async () => {
        const rows = await ensureCategoryMetadata(sharedLoader);
        if (!Array.isArray(rows) || !rows.length) {
          return null;
        }
        state.compositionMap = buildCategoryCompositionMap(rows);
        return state.compositionMap;
      })().catch(error => {
        state.compositionPromise = null;
        console.warn('[EcoReplacementUtils] Category composition map unavailable:', error?.message || error);
        throw error;
      });
    }
    return state.compositionPromise;
  }

  async function assessCategoryInclusion(candidateId, containerId, options = {}) {
    const childId = Number(candidateId);
    const parentId = Number(containerId);
    if (!Number.isFinite(childId) || !Number.isFinite(parentId)) {
      return { included: null, reason: 'invalid-id' };
    }
    try {
      const map = await ensureCompositionMap(options.sharedLoader || null);
      if (!map) {
        return { included: null, reason: 'missing-map' };
      }
      const candidate = map.get(childId);
      const container = map.get(parentId);
      if (!candidate || !container) {
        return { included: null, reason: 'missing-category' };
      }
      const evaluation = evaluateCategorySubset(candidate, container);
      if (evaluation === null) {
        return { included: null, reason: 'inconclusive' };
      }
      return { included: evaluation === true, reason: 'evaluated' };
    } catch (error) {
      console.warn('[EcoReplacementUtils] assessCategoryInclusion failed:', error?.message || error);
      return { included: null, reason: 'error' };
    }
  }

  async function computeEnergyProfile(options = {}) {
    const {
      timeseriesIndex,
      ecoCategoryId,
      fireplaceCategoryId,
      activityPollutantId,
      year,
      inclusionAssessment,
      sharedLoader
    } = options;

    if (!timeseriesIndex || !Number.isFinite(Number(activityPollutantId))) {
      return {
        ecoEnergy: NaN,
        fireplaceEnergy: NaN,
        replacementEnergy: NaN,
        inclusion: { included: null, reason: 'missing-data' }
      };
    }

    const yearKey = resolveYearKey(year);
    const ecoEnergy = getTimeseriesValue(timeseriesIndex, activityPollutantId, ecoCategoryId, yearKey);
    const fireplaceEnergy = getTimeseriesValue(timeseriesIndex, activityPollutantId, fireplaceCategoryId, yearKey);
    const inclusion = inclusionAssessment || await assessCategoryInclusion(ecoCategoryId, fireplaceCategoryId, { sharedLoader });
    const replacementEnergy = inclusion?.included
      ? normalizeNumber(fireplaceEnergy)
      : sumActivityValues(ecoEnergy, fireplaceEnergy);

    return {
      ecoEnergy: normalizeNumber(ecoEnergy),
      fireplaceEnergy: normalizeNumber(fireplaceEnergy),
      replacementEnergy: normalizeNumber(replacementEnergy),
      inclusion
    };
  }

  async function computeReplacementScenario(options = {}) {
    const {
      pollutantId,
      timeseriesIndex,
      ecoCategoryId,
      fireplaceCategoryId,
      baselineFireplaceCategoryId,
      year,
      activityPollutantId,
      energyProfile,
      sharedLoader
    } = options;

    if (!timeseriesIndex || !Number.isFinite(Number(pollutantId))) {
      return null;
    }

    const profile = energyProfile || await computeEnergyProfile({
      timeseriesIndex,
      ecoCategoryId,
      fireplaceCategoryId,
      activityPollutantId,
      year,
      sharedLoader
    });

    const yearKey = resolveYearKey(year);
    const ecoEmission = getTimeseriesValue(timeseriesIndex, pollutantId, ecoCategoryId, yearKey);
    const fireplaceEmission = getTimeseriesValue(timeseriesIndex, pollutantId, fireplaceCategoryId, yearKey);
    const baselineFireplaceEmission = getTimeseriesValue(
      timeseriesIndex,
      pollutantId,
      Number.isFinite(baselineFireplaceCategoryId) ? baselineFireplaceCategoryId : fireplaceCategoryId,
      yearKey
    );
    const baselineFireplaceEnergy = Number.isFinite(activityPollutantId)
      ? getTimeseriesValue(
        timeseriesIndex,
        activityPollutantId,
        Number.isFinite(baselineFireplaceCategoryId) ? baselineFireplaceCategoryId : fireplaceCategoryId,
        yearKey
      )
      : NaN;
    const remainderEmission = Math.max(0, normalizeNumber(baselineFireplaceEmission) - normalizeNumber(fireplaceEmission));
    const remainderEnergy = Math.max(0, normalizeNumber(baselineFireplaceEnergy) - normalizeNumber(profile.fireplaceEnergy));
    const ecoEmissionFactor = calculateEmissionFactor({
      pollutantValue: ecoEmission,
      actDataValue: profile.ecoEnergy
    });

    const replacementEmission = (Number.isFinite(ecoEmissionFactor)
      && Number.isFinite(profile.replacementEnergy)
      && profile.replacementEnergy > 0)
      ? ecoEmissionFactor * profile.replacementEnergy
      : null;

    return {
      pollutantId: Number(pollutantId),
      ecoEmission: normalizeNumber(ecoEmission),
      fireplaceEmission: normalizeNumber(fireplaceEmission),
      baselineFireplaceEmission: normalizeNumber(baselineFireplaceEmission),
      fireplaceRemainderEmission: remainderEmission,
      baselineFireplaceEnergy: normalizeNumber(baselineFireplaceEnergy),
      fireplaceRemainderEnergy: remainderEnergy,
      replacementEmission: normalizeNumber(replacementEmission),
      ecoEmissionFactor: Number.isFinite(ecoEmissionFactor) ? ecoEmissionFactor : null,
      energyProfile: profile
    };
  }

  const api = {
    normalizeNumber,
    sumActivityValues,
    calculateEmissionFactor,
    createTimeseriesIndex,
    getTimeseriesValue,
    assessCategoryInclusion,
    computeEnergyProfile,
    computeReplacementScenario,
    constants: {
      CATEGORY_ALL_SOURCES_TOKEN,
      CATEGORY_ALL_FUELS_TOKEN
    }
  };

  global.EcoReplacementUtils = api;
})(window);
