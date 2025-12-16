/**
 * Chart Renderer Module
 * Handles Google Charts bubble chart rendering
 */

let chart = null;
let currentChartData = null;
let currentOptions = null;
let googleChartsReady = false;
let googleChartsLoadPromise = null;
let seriesVisibility = []; // Track which series are visible
let useLogScale = false; // Track whether logarithmic scaling is being used
window.seriesVisibility = seriesVisibility; // Expose for export.js
const CHART_RENDERER_MIN_CANVAS_HEIGHT = 420;
const chartLogger = (() => {
  const logger = window.BubbleLogger;
  if (logger?.tagged) {
    return logger.tagged('chart');
  }
  if (logger?.log) {
    return (...args) => {
      if (!logger.enabled) {
        return;
      }
      logger.log('[chart]', ...args);
    };
  }
  return () => {};
})();
const chartLoggerWarn = (() => {
  const logger = window.BubbleLogger;
  if (logger?.warn) {
    return (...args) => {
      if (!logger.enabled) {
        return;
      }
      logger.warn('[chart]', ...args);
    };
  }
  return () => {};
})();

function comparisonDebugLog(message, payload) {
  const logger = typeof window !== 'undefined' ? window.__bubbleComparisonDebugLog : null;
  if (typeof logger !== 'function') {
    return;
  }
  try {
    logger(message, payload);
  } catch (error) {
    // comparison debug logging is best-effort only
  }
}

// Provide a minimal fallback palette when shared Colors module fails to load
if (!window.Colors) {
  console.warn('Colors module not found for bubble chart – using fallback palette.');
  const fallbackPalette = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
  ];
  const colorAssignments = new Map();
  let nextColorIndex = 0;

  window.Colors = {
    resetColorSystem() {
      colorAssignments.clear();
      nextColorIndex = 0;
    },
    getColorForCategory(categoryName) {
      const key = categoryName || `category-${nextColorIndex}`;
      if (colorAssignments.has(key)) {
        return colorAssignments.get(key);
      }
      const chosen = fallbackPalette[nextColorIndex % fallbackPalette.length];
      colorAssignments.set(key, chosen);
      nextColorIndex += 1;
      return chosen;
    }
  };
}

function createDeferred() {
  let resolveFn = null;
  let settled = false;
  const promise = new Promise(resolve => {
    resolveFn = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
  });
  return {
    promise,
    resolve() {
      if (resolveFn) {
        resolveFn();
        resolveFn = null;
      }
    }
  };
}

let chartStabilityHandle = {
  promise: Promise.resolve(),
  resolve() {}
};

function beginChartStabilityCycle() {
  chartStabilityHandle = createDeferred();
  return chartStabilityHandle;
}

function waitForChartStability() {
  return chartStabilityHandle?.promise || Promise.resolve();
}

function waitForChromeStability(targetElements = []) {
  const fontPromise = document.fonts?.ready
    ? document.fonts.ready.catch(() => {})
    : Promise.resolve();

  const imagePromises = targetElements
    .filter(el => el && el.tagName === 'IMG' && el.complete === false)
    .map(img => new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }));

  return Promise.all([fontPromise, ...imagePromises])
    .then(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

function hasGoogleChartsCore() {
  return Boolean(window.google?.visualization?.DataTable && window.google?.visualization?.ScatterChart);
}

function ensureGoogleChartsLoaded() {
  if (googleChartsReady && hasGoogleChartsCore()) {
    return Promise.resolve();
  }

  if (googleChartsLoadPromise) {
    return googleChartsLoadPromise;
  }

  googleChartsLoadPromise = new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (timer, poller) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (poller) {
        clearInterval(poller);
      }
    };

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup(timeoutId, pollInterval);
        reject(new Error('Timed out waiting for Google Charts to load.'));
      }
    }, 15000);

    const tryResolve = () => {
      if (settled) {
        return;
      }
      if (!hasGoogleChartsCore()) {
        return;
      }
      settled = true;
      cleanup(timeoutId, pollInterval);
      googleChartsReady = true;
      resolve();
    };

    const handleFailure = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(timeoutId, pollInterval);
      const normalized = error instanceof Error ? error : new Error(String(error));
      reject(normalized);
    };

    const startLoad = () => {
      try {
        if (!window.google?.charts?.load) {
          handleFailure(new Error('Google Charts loader API is unavailable.'));
          return;
        }
        google.charts.load('current', {
          packages: ['corechart'],
          callback: tryResolve
        });
        google.charts.setOnLoadCallback(tryResolve);
      } catch (error) {
        handleFailure(error);
      }
    };

    const pollInterval = setInterval(tryResolve, 200);

    if (window.google?.charts?.load) {
      startLoad();
    } else {
      const existingLoader = document.querySelector('script[data-google-charts-loader]');
      if (existingLoader) {
        existingLoader.addEventListener('load', startLoad, { once: true });
        existingLoader.addEventListener('error', () => handleFailure(new Error('Failed to load Google Charts loader script.')), { once: true });
      } else {
        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/charts/loader.js';
        script.async = true;
        script.defer = true;
        script.dataset.googleChartsLoader = 'true';
        script.addEventListener('load', startLoad, { once: true });
        script.addEventListener('error', () => handleFailure(new Error('Failed to load Google Charts loader script.')), { once: true });
        document.head.appendChild(script);
      }
    }
  }).catch(error => {
    googleChartsLoadPromise = null;
    throw error;
  });

  return googleChartsLoadPromise;
}

// Kick off loading immediately for faster first paint
ensureGoogleChartsLoaded().catch(error => {
  console.error('Unable to initialize Google Charts for bubble chart:', error);
});

/**
 * Draw bubble chart
 * @param {number} year - Selected year
 * @param {number} pollutantId - Selected pollutant ID
 * @param {Array} categoryIds - Array of selected category IDs
 */
async function drawBubbleChart(year, pollutantId, categoryIds) {
  const stabilityHandle = beginChartStabilityCycle();
  try {
    if (!googleChartsReady || !hasGoogleChartsCore()) {
      await ensureGoogleChartsLoaded();
    }

    if (!googleChartsReady || !hasGoogleChartsCore()) {
      showMessage('Unable to load the Google Charts library. Please refresh and try again.', 'error');
      return;
    }

    // Get data points
    const dataPoints = window.supabaseModule.getScatterData(year, pollutantId, categoryIds);
    
    if (dataPoints.length === 0) {
      console.error('No data points returned!');
      showMessage('No data available for the selected year, pollutant, and categories.', 'error');
      return;
    }

    // Filter data points based on series visibility
    // Ensure visibility array is correctly sized
    if (seriesVisibility.length !== categoryIds.length) {
      seriesVisibility = Array(categoryIds.length).fill(true);
      window.seriesVisibility = seriesVisibility;
    }

    const normalizedCategoryIds = Array.isArray(categoryIds) ? categoryIds : [];

    const categoryDisplayOrder = new Map();
    normalizedCategoryIds.forEach((rawId, index) => {
      const numericId = Number(rawId);
      const categoryName = window.supabaseModule?.getCategoryName?.(numericId) || `${rawId}`;
      if (!categoryDisplayOrder.has(categoryName)) {
        categoryDisplayOrder.set(categoryName, index);
      }
    });

    const categoryIndexById = new Map();
    normalizedCategoryIds.forEach((rawId, index) => {
      const numericId = Number(rawId);
      if (Number.isFinite(numericId)) {
        categoryIndexById.set(numericId, index);
      }
    });

    const resolveCategoryIndex = (point) => {
      const numericId = Number(point.categoryId);
      if (Number.isFinite(numericId) && categoryIndexById.has(numericId)) {
        return categoryIndexById.get(numericId);
      }
      if (point.categoryName && categoryDisplayOrder.has(point.categoryName)) {
        return categoryDisplayOrder.get(point.categoryName);
      }
      return null;
    };

    const visibleDataPoints = dataPoints.filter(point => {
      const categoryIndex = resolveCategoryIndex(point);
      if (categoryIndex == null) {
        return true;
      }
      return seriesVisibility[categoryIndex];
    });

    const pollutantName = window.supabaseModule.getPollutantName(pollutantId);
    const pollutantUnit = window.supabaseModule.getPollutantUnit(pollutantId);
    const pollutantUnitMeta = window.EmissionUnits?.getUnitMeta(pollutantUnit);
    const buildAxisLabel = (label, unit) => unit ? `${label} (${unit})` : label;
    const pollutantAxisUnit = window.EmissionUnits?.formatAxisLabel(pollutantUnitMeta) || pollutantUnit || '';
    const actDataId = window.supabaseModule.actDataPollutantId || window.supabaseModule.activityDataId;
    const activityUnit = window.supabaseModule.getPollutantUnit(actDataId);
    const activityUnitMeta = window.EmissionUnits?.getUnitMeta(activityUnit);
    const activityAxisUnit = window.EmissionUnits?.formatAxisLabel(activityUnitMeta) || activityUnit || 'TJ';

    // Prepare Google DataTable for scatter chart with bubble-like styling
    const data = new google.visualization.DataTable();
    data.addColumn('number', buildAxisLabel('Activity Data', activityAxisUnit));
    data.addColumn('number', buildAxisLabel('Emissions', pollutantAxisUnit));
    data.addColumn({type: 'string', role: 'tooltip'});
  data.addColumn({type: 'string', role: 'style'});

  // Add data rows with emission factor calculation and sizing
  const orderedVisiblePoints = [...visibleDataPoints].sort((a, b) => {
    const orderA = categoryDisplayOrder.has(a.categoryName) ? categoryDisplayOrder.get(a.categoryName) : Number.POSITIVE_INFINITY;
    const orderB = categoryDisplayOrder.has(b.categoryName) ? categoryDisplayOrder.get(b.categoryName) : Number.POSITIVE_INFINITY;
    // Draw higher index first so lower index (top of selector) renders last and stays on top visually
    return orderB - orderA;
  });
  
  // Determine conversion factor based on pollutant unit (BEFORE calculating EFs)
  const conversionFactor = window.EmissionUnits?.getConversionFactor(pollutantUnitMeta || pollutantUnit)
    ?? 1000000;
  
  // Calculate all EF values first to determine dynamic scale factor (use visible points only)
  const allEFs = orderedVisiblePoints.map(p => p.EF !== undefined ? p.EF : (p.actDataValue !== 0 ? (p.pollutantValue / p.actDataValue) * conversionFactor : 0));
  const maxEF = Math.max(...allEFs);
  const minEF = Math.min(...allEFs.filter(ef => ef > 0)); // Exclude zeros
  
  // Use logarithmic scaling for bubble sizes when EF range is extreme (>1000x)
  // This is standard in atmospheric science and emission inventories
  const efRatio = maxEF / minEF;
  useLogScale = efRatio > 1000; // Update module-level variable
  
  const targetMaxRadius = 90;
  const targetMinRadius = 5;
  
  let scaleFactor;
  if (useLogScale) {
    // Logarithmic scale: bubble area ∝ log10(EF)
    // For log scale with small values (< 1), we work with absolute log values
    // and scale based on the range of log values
    const maxLog = Math.log10(maxEF);
    const minLog = Math.log10(minEF);
    const logRange = maxLog - minLog; // Total range in log space
    
    // Scale factor maps log range to radius range
    // We'll map the full log range to our target radius range
    scaleFactor = (targetMaxRadius - targetMinRadius) / logRange;
    
    // Logarithmic scaling is noteworthy, but keep output minimal
  } else {
    // Linear scale: bubble area ∝ EF
    scaleFactor = targetMaxRadius / Math.sqrt(maxEF);
    let minRadiusLinear = scaleFactor * Math.sqrt(minEF);
    
    if (minRadiusLinear < targetMinRadius) {
      scaleFactor = targetMinRadius / Math.sqrt(minEF);
      minRadiusLinear = targetMinRadius;
    }
    
    // No debug log for routine linear scaling
  }  
  orderedVisiblePoints.forEach((point, index) => {
    const color = window.Colors.getColorForCategory(point.categoryName);

    // Use Emission Factor (EF) directly for bubble size
    // If EF is already provided in point, use it; otherwise, calculate
    const emissionFactor = point.EF !== undefined ? point.EF : (point.actDataValue !== 0 ? (point.pollutantValue / point.actDataValue) * conversionFactor : 0);

    // Calculate bubble size using logarithmic or linear scaling
    let radius;
    if (useLogScale && emissionFactor > 0) {
      // Logarithmic: map position in log space to radius
      const logEF = Math.log10(emissionFactor);
      const logMin = Math.log10(minEF);
      const logMax = Math.log10(maxEF);
      
      // Position in log space (0 to 1)
      const logPosition = (logEF - logMin) / (logMax - logMin);
      
      // Map to radius range (min to max)
      radius = targetMinRadius + (logPosition * (targetMaxRadius - targetMinRadius));
    } else {
      // Linear: radius ∝ sqrt(EF)
      const sqrtEF = Math.sqrt(emissionFactor);
      radius = scaleFactor * sqrtEF;
    }
    
    // Use calculated radius directly
    const normalizedRadius = radius;

    // All EF values are converted to g/GJ
    // Use more decimal places for very small values
    const efDisplay = emissionFactor < 0.01 ? emissionFactor.toFixed(8) : emissionFactor.toFixed(2);
    const activityUnitLabel = window.EmissionUnits?.formatValueLabel(activityUnitMeta || activityUnit, point.actDataValue) || activityAxisUnit;
    const emissionUnitLabel = window.EmissionUnits?.formatValueLabel(pollutantUnitMeta || pollutantUnit, point.pollutantValue) || pollutantAxisUnit;
    const tooltip = `${point.categoryName}\nActivity: ${point.actDataValue.toLocaleString()}${activityUnitLabel ? ` ${activityUnitLabel}` : ''}\nEmissions: ${point.pollutantValue.toLocaleString()}${emissionUnitLabel ? ` ${emissionUnitLabel}` : ''}\nEmission Factor: ${efDisplay} g/GJ`;

    data.addRow([
      point.actDataValue, // X-axis
      point.pollutantValue, // Y-axis
      tooltip,
      `point {fill-color: ${color}; size: ${Math.round(normalizedRadius)};}`
    ]);
  });
  
  // Chart options
  const isActivityPollutant = window.EmissionUnits?.isActivityUnit(pollutantUnitMeta || pollutantUnit);
  const chartTitleText = isActivityPollutant ? 'Activity Data' : `UK ${pollutantName} Emissions`;
  const yAxisLabelBase = isActivityPollutant ? 'Activity Data' : `${pollutantName} Emissions`;
  const yAxisTitle = buildAxisLabel(yAxisLabelBase, pollutantAxisUnit);
  const xAxisTitle = buildAxisLabel('Activity Data', activityAxisUnit);

  // Create a custom title element with two lines
    const chartTitleElement = document.getElementById('chartTitle');
    if (chartTitleElement) {
      chartTitleElement.style.display = 'block';
      chartTitleElement.style.textAlign = 'center';
      chartTitleElement.style.marginBottom = '6px';

      const titleElement = document.createElement('div');
      titleElement.className = 'chart-title__pollutant';
      titleElement.textContent = chartTitleText;

      const yearElement = document.createElement('div');
      yearElement.className = 'chart-title__year-range';
      yearElement.textContent = `${year}`;

      // Clear previous content and append new elements
      chartTitleElement.innerHTML = '';
      chartTitleElement.appendChild(titleElement);
      chartTitleElement.appendChild(yearElement);
    }

    // Set a fixed height for the chart container to prevent layout shifts (same as line chart)
    const chartDiv = document.getElementById('chart_div');
    if (!chartDiv) {
      console.error('Missing #chart_div element');
      showMessage('Chart container not found', 'error');
      return;
    }

    // Build legend before sizing so its height is accounted for
    createCustomLegend(chart, data, categoryIds, dataPoints);
    const customLegendEl = document.getElementById('customLegend');
    await waitForChromeStability([chartTitleElement, customLegendEl]);

    const titleHeight = chartTitleElement ? Math.round(chartTitleElement.getBoundingClientRect().height || 0) : 0;
    const legendHeight = customLegendEl ? Math.round(customLegendEl.getBoundingClientRect().height || 0) : 0;
  const layoutManager = window.__bubbleLayoutHeightManager;
  const preLegendEstimate = (() => {
    const pendingEstimate = window.__BUBBLE_PRE_LEGEND_ESTIMATE;
    if (Number.isFinite(pendingEstimate) && pendingEstimate > 0) {
      return pendingEstimate;
    }
    if (layoutManager?.getLastEstimatedHeight) {
      const managerEstimate = layoutManager.getLastEstimatedHeight();
      if (Number.isFinite(managerEstimate) && managerEstimate > 0) {
        return managerEstimate;
      }
    }
    return null;
  })();
  const cachedHeight = Number.isFinite(preLegendEstimate) && preLegendEstimate > 0
    ? preLegendEstimate
    : window.__NAEI_LAST_CHART_HEIGHT;
  const chartRect = chartDiv.getBoundingClientRect();
  let requestedChartHeight = Number.isFinite(cachedHeight) && cachedHeight > 0
    ? cachedHeight
    : Math.round(chartRect.height || CHART_RENDERER_MIN_CANVAS_HEIGHT);

  const wrapper = chartDiv.closest('.chart-wrapper');
  let wrapperRect = null;
  let paddingBottom = 0;
  let chartTopOffset = 0;
  let availableHeight = null;
  if (wrapper) {
    wrapperRect = wrapper.getBoundingClientRect();
    const wrapperStyles = window.getComputedStyle(wrapper);
    paddingBottom = parseFloat(wrapperStyles.paddingBottom) || 0;
    chartTopOffset = chartRect.top - wrapperRect.top;
    availableHeight = Math.max(0, wrapperRect.height - chartTopOffset - paddingBottom);
    if (availableHeight > 0) {
      requestedChartHeight = Math.min(requestedChartHeight, availableHeight);
    }
  }

  if (!Number.isFinite(requestedChartHeight) || requestedChartHeight <= 0) {
    requestedChartHeight = CHART_RENDERER_MIN_CANVAS_HEIGHT;
  }

  const appliedChartHeight = Math.max(
    CHART_RENDERER_MIN_CANVAS_HEIGHT,
    Math.round(requestedChartHeight)
  );
  chartDiv.style.height = `${appliedChartHeight}px`;
  chartDiv.style.minHeight = `${appliedChartHeight}px`;
  chartDiv.style.maxHeight = `${appliedChartHeight}px`;
  const clampResult = window.__bubbleLayoutHeightManager?.ensureWrapperCapacity
    ? window.__bubbleLayoutHeightManager.ensureWrapperCapacity({
        wrapperElement: wrapper,
        chartHeight: appliedChartHeight,
        chromeBeforeChart: chartTopOffset,
        chromeAfterChart: paddingBottom
      })
    : enforceBubbleWrapperMinimumHeight({
        wrapperElement: wrapper,
        wrapperRect,
        chartTopOffset,
        paddingBottom,
        appliedChartHeight
      });
  comparisonDebugLog('chart renderer sizing', {
    appliedChartHeight,
    chartTopOffset,
    paddingBottom,
    availableHeight,
    wrapperHeight: wrapperRect?.height || null,
    clampResult,
    preLegendEstimate,
    pendingComparisonChromeHeight: Boolean(window.__bubblePendingComparisonChromeHeight)
  });
  const effectiveWrapperHeight = clampResult?.finalHeight
    || (wrapperRect ? Math.round(wrapperRect.height) : null);


  // Prepare colors for each category (use visible data points only)
  const colors = [];
  const uniqueCategoriesForColors = [...new Set(visibleDataPoints.map(point => point.categoryName))];
  uniqueCategoriesForColors.forEach(categoryName => {
    colors.push(window.Colors.getColorForCategory(categoryName));
  });

  // Calculate axis ranges with padding for bubbles (use visible data points only)
  const activityValues = visibleDataPoints.map(p => p.actDataValue);
  const pollutantValues = visibleDataPoints.map(p => p.pollutantValue);
  
  const maxActivity = Math.max(...activityValues);
  const maxPollutant = Math.max(...pollutantValues);
  
  // Add extra padding to prevent bubble clipping (bubbles need radius space)
  const activityPadding = maxActivity * 0.25;
  const pollutantPadding = maxPollutant * 0.25;
  
  // Get minimum values to add left/bottom padding
  const minActivity = Math.min(...activityValues);
  const minPollutant = Math.min(...pollutantValues);
  
  // Calculate minimum offsets (ensure bubbles don't start at the very edge)
  const activityMinOffset = Math.max(0, minActivity - (maxActivity * 0.05));
  const pollutantMinOffset = Math.max(0, minPollutant - (maxPollutant * 0.05));

  const chartAreaTop = 85;
  const chartAreaBottom = 120;
  const chartAreaHeight = Math.max(200, appliedChartHeight - (chartAreaTop + chartAreaBottom));

  currentOptions = {
    legend: { position: 'none' }, // Remove Google Chart legend
    title: '', // Invisible Google Chart title
    titleTextStyle: {
      fontSize: 0 // Minimize title space
    },
    width: '100%',
    height: appliedChartHeight,
    chartArea: {
      top: chartAreaTop,  // Slightly increased to avoid gridline at edge
      bottom: chartAreaBottom,
      left: 150,
      right: 80,
      height: chartAreaHeight,
      backgroundColor: 'transparent'
    },
    backgroundColor: 'transparent',
    tooltip: { trigger: 'focus' }, // Enable tooltips on hover
    hAxis: {
      title: xAxisTitle,
      format: 'short',
      gridlines: {
        color: '#cccccc',  // Darker grey for major gridlines
        count: 5
      },
      minorGridlines: {
        count: 4  // 4 minor gridlines between each major gridline
      },
      titleTextStyle: {
        italic: false,
        bold: false
      },
      viewWindow: {
        min: 0,
        max: maxActivity + activityPadding
      }
    },
    vAxis: {
      title: yAxisTitle,
      gridlines: {
        color: '#cccccc',  // Darker grey for major gridlines
        count: 5
      },
      minorGridlines: {
        count: 4  // 4 minor gridlines between each major gridline
      },
      titleTextStyle: {
        italic: false,
        bold: false
      },
      viewWindow: {
        min: 0,
        max: maxPollutant + pollutantPadding
      }
    },
    colors: colors,
    colorAxis: {
      legend: {
        position: 'none'
      }
    }
  };

  // Store current chart data for export
  currentChartData = {
    data: data,
    options: currentOptions,
    year: year,
    pollutantId: pollutantId,
    pollutantName: pollutantName,
    pollutantUnit: pollutantUnit,
    categoryIds,
    dataPoints: dataPoints
  };

  // Draw chart using ScatterChart with bubble-like styling to avoid clipping
  if (!chart) {
    chart = new google.visualization.ScatterChart(chartDiv);

    // Add listener for chart render completion (for loading management)
    google.visualization.events.addListener(chart, 'ready', () => {
      if (window.chartRenderCallback) {
        window.chartRenderCallback();
        window.chartRenderCallback = null; // Clear callback after use
      }
    });
    
    // Add error listener
    google.visualization.events.addListener(chart, 'error', (err) => {
      console.error('Google Charts error:', err);
    });
    
    // Add select listener to immediately clear any selections
    google.visualization.events.addListener(chart, 'select', () => {
      chart.setSelection([]);
    });
  }
  
  try {
    chart.draw(data, currentOptions);

    registerTooltipPositionHandlers(chart, data);
    
    // Add bubble size explanation text overlay at top of chart
    addBubbleExplanationOverlay();

    // Ensure chart region fades in once Google Charts has drawn content
    if (!chartDiv.classList.contains('visible')) {
      chartDiv.classList.add('visible');
    }
  } catch (err) {
    console.error('Error calling chart.draw():', err);
  }
  
  
  // Show chart with animation (add visible class to wrapper, not chart_div)
  const chartWrapper = document.querySelector('.chart-wrapper');
  if (chartWrapper) {
    chartWrapper.classList.add('visible');
  }  // Enable share and download buttons
  const shareBtnEl = document.getElementById('shareBtn');
  const downloadBtnEl = document.getElementById('downloadBtn');
  const downloadCSVBtnEl = document.getElementById('downloadCSVBtn');
  const downloadXLSXBtnEl = document.getElementById('downloadXLSXBtn');
  
  if (shareBtnEl) shareBtnEl.disabled = false;
  if (downloadBtnEl) downloadBtnEl.disabled = false;
  if (downloadCSVBtnEl) downloadCSVBtnEl.disabled = false;
  if (downloadXLSXBtnEl) downloadXLSXBtnEl.disabled = false;

    clearMessage();
    if (window.updateChartWrapperHeight) {
      window.updateChartWrapperHeight('drawChart');
    }
  } catch (error) {
    console.error('Error rendering bubble chart:', error);
    showMessage('Unable to render the chart right now. Please try again.', 'error');
  } finally {
    stabilityHandle.resolve();
  }
}

/**
 * Create a custom legend for the scatter chart
 * @param {Object} chart - Google Chart instance
 * @param {Object} data - Google DataTable instance
 * @param {Array} categoryIds - Array of selected category IDs
 */
function createCustomLegend(chart, data, categoryIds, dataPoints) {
  const legendContainer = document.getElementById('customLegend');
  if (!legendContainer) {
    console.error('Missing #customLegend element');
    return;
  }

  legendContainer.innerHTML = ''; // Clear existing legend
  legendContainer.style.display = 'flex';
  legendContainer.style.justifyContent = 'center';
  legendContainer.style.flexWrap = 'wrap';
  legendContainer.style.gap = '10px';

    // Ensure visibility array is correctly sized
    if (seriesVisibility.length !== categoryIds.length) {
      seriesVisibility = Array(categoryIds.length).fill(true);
      window.seriesVisibility = seriesVisibility; // Update window reference
    }

    const pointsByCategoryId = new Map();
    dataPoints.forEach(point => {
      const numericId = Number(point.categoryId);
      if (!Number.isFinite(numericId)) {
        return;
      }
      if (!pointsByCategoryId.has(numericId)) {
        pointsByCategoryId.set(numericId, point);
      }
    });

    categoryIds.forEach((categoryId, index) => {
      const numericId = Number(categoryId);
      const pointForCategory = Number.isFinite(numericId)
        ? pointsByCategoryId.get(numericId)
        : null;
      const categoryName = pointForCategory?.categoryName
        || (typeof window.supabaseModule?.getCategoryName === 'function'
          ? window.supabaseModule.getCategoryName(categoryId)
          : `Category ${categoryId}`);
      const hasData = Boolean(pointForCategory);

      const legendItem = document.createElement('span');
      legendItem.style.display = 'inline-flex';
      legendItem.style.alignItems = 'center';
      legendItem.style.cursor = 'pointer';
      legendItem.style.fontWeight = '600';
      legendItem.style.margin = '5px 10px';
      const baseColor = window.Colors.getColorForCategory(categoryName);

      const colorCircle = document.createElement('span');
      colorCircle.style.display = 'inline-block';
      colorCircle.style.backgroundColor = baseColor;
      colorCircle.style.width = '12px';
      colorCircle.style.height = '12px';
      colorCircle.style.borderRadius = '50%';
      colorCircle.style.marginRight = '8px';

      const displayName = hasData ? categoryName : `${categoryName} (No data available)`;
      const label = document.createTextNode(displayName);

      legendItem.appendChild(colorCircle);
      legendItem.appendChild(label);

      const updateLegendAppearance = (isVisible) => {
        const isActive = hasData && isVisible;
        legendItem.style.opacity = isActive ? '1' : '0.4';
        legendItem.style.color = isActive ? '#000' : '#666';
        legendItem.style.cursor = hasData ? 'pointer' : 'default';
        colorCircle.style.backgroundColor = baseColor;

        if (!hasData) {
          legendItem.title = 'No data available';
        } else {
          legendItem.removeAttribute('title');
        }
      };

      legendItem.dataset.categoryId = categoryId;

      updateLegendAppearance(seriesVisibility[index]);

      if (hasData) {
        const handleToggle = () => {
          seriesVisibility[index] = !seriesVisibility[index];
          window.seriesVisibility = seriesVisibility; // Update window reference

          updateLegendAppearance(seriesVisibility[index]);

          if (!seriesVisibility.some(Boolean)) {
            seriesVisibility[index] = true;
            updateLegendAppearance(true);
          }

          const currentData = window.ChartRenderer.getCurrentChartData();
          if (currentData) {
            window.ChartRenderer.drawBubbleChart(
              currentData.year,
              currentData.pollutantId,
              currentData.categoryIds
            );
          }
        };

        legendItem.addEventListener('click', handleToggle);
        legendItem.addEventListener('keypress', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleToggle();
          }
        });
      } else {
        legendItem.classList.add('legend-disabled');
        legendItem.style.cursor = 'not-allowed';
      }

      legendContainer.appendChild(legendItem);
    });
}

function registerTooltipPositionHandlers(chartInstance, dataTable) {
  if (!chartInstance) return;

  if (!chartInstance.__tooltipHandlers) {
    chartInstance.__tooltipHandlers = [];
  }

  if (chartInstance.__tooltipHandlers.length) {
    chartInstance.__tooltipHandlers.forEach(handlerId => {
      google.visualization.events.removeListener(handlerId);
    });
    chartInstance.__tooltipHandlers = [];
  }

  const mouseOverHandler = google.visualization.events.addListener(chartInstance, 'onmouseover', (event) => {
    adjustTooltipForTopBubbles(event, dataTable, chartInstance);
  });
  const mouseOutHandler = google.visualization.events.addListener(chartInstance, 'onmouseout', () => {
    resetTooltipPosition();
  });

  chartInstance.__tooltipHandlers.push(mouseOverHandler, mouseOutHandler);
}

function adjustTooltipForTopBubbles(event, dataTable, chartInstance) {
  if (!event || event.row == null) {
    return;
  }

  requestAnimationFrame(() => {
    const tooltipEl = document.querySelector('.google-visualization-tooltip');
    if (!tooltipEl) {
      return;
    }

    const layout = chartInstance.getChartLayoutInterface();
    if (!layout) {
      return;
    }

    const chartArea = layout.getChartAreaBoundingBox();
    const yValue = dataTable.getValue(event.row, 1);
    const bubbleCenterY = layout.getYLocation(yValue);
    const tooltipHeight = tooltipEl.offsetHeight;
    const topBuffer = 40;
    const downwardOffset = 14;

    tooltipEl.dataset.defaultTop = tooltipEl.style.top || '';
    tooltipEl.dataset.defaultTransform = tooltipEl.style.transform || '';

    if (bubbleCenterY - tooltipHeight <= chartArea.top + topBuffer) {
      const proposedTop = bubbleCenterY + downwardOffset;
      const maxTop = chartArea.top + chartArea.height - tooltipHeight - 10;
      tooltipEl.style.top = `${Math.min(proposedTop, maxTop)}px`;
      tooltipEl.style.transform = 'translate(-50%, 0)';
      tooltipEl.dataset.tooltipAdjusted = 'true';
    } else if (tooltipEl.dataset.tooltipAdjusted === 'true') {
      tooltipEl.style.top = tooltipEl.dataset.defaultTop;
      tooltipEl.style.transform = tooltipEl.dataset.defaultTransform;
      tooltipEl.dataset.tooltipAdjusted = '';
    }
  });
}

function resetTooltipPosition() {
  requestAnimationFrame(() => {
    const tooltipEl = document.querySelector('.google-visualization-tooltip');
    if (tooltipEl && tooltipEl.dataset.tooltipAdjusted === 'true') {
      tooltipEl.style.top = tooltipEl.dataset.defaultTop || '';
      tooltipEl.style.transform = tooltipEl.dataset.defaultTransform || '';
      tooltipEl.dataset.tooltipAdjusted = '';
      tooltipEl.dataset.defaultTop = '';
      tooltipEl.dataset.defaultTransform = '';
    }
  });
}

/**
 * Add bubble size explanation text overlay at top of chart
 */
function addBubbleExplanationOverlay() {
  const chartDiv = document.getElementById('chart_div');
  if (!chartDiv) return;
  
  // Remove existing overlay if present
  const existingOverlay = chartDiv.querySelector('.bubble-explanation-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }
  
  // Create overlay div with scale information - positioned ON the chart
  const overlay = document.createElement('div');
  overlay.className = 'bubble-explanation-overlay';
  overlay.style.position = 'absolute';
  overlay.style.top = '15px';  // Top of chart, opposite to x-axis label
  overlay.style.left = '50%';
  overlay.style.transform = 'translateX(-50%)';
  overlay.style.textAlign = 'center';
  overlay.style.fontSize = '13px';
  overlay.style.color = '#666';
  overlay.style.lineHeight = '1.4';
  overlay.style.pointerEvents = 'none'; // Allow clicks to pass through
  overlay.style.zIndex = '10'; // Ensure it's visible
  overlay.style.maxWidth = '95%'; // Wide container to minimize wrapping
  
  // Update text based on scaling type with natural wrapping like footer
  if (useLogScale) {
    overlay.innerHTML = '<span style="white-space: nowrap;">Bubble size proportional to log₁₀(Emission Factor)</span> <span style="white-space: nowrap;">- logarithmic scale used due to wide EF range</span><br>Hover over bubble to see values';
  } else {
    overlay.innerHTML = '<span style="white-space: nowrap;">Bubble size proportional to Emission Factor</span> <span style="white-space: nowrap;">(area-scaled, radius = √EF)</span><br>Hover over bubble to see values';
  }
  
  // Append to chart_div so it overlays the chart
  chartDiv.appendChild(overlay);
}

function refreshChartLayoutBounds({ reason = 'comparison-change' } = {}) {
  const chartDiv = document.getElementById('chart_div');
  if (!chartDiv) {
    return null;
  }

  const wrapper = chartDiv.closest('.chart-wrapper');
  if (!wrapper) {
    return null;
  }

  const wrapperRect = wrapper.getBoundingClientRect();
  const chartRect = chartDiv.getBoundingClientRect();
  const wrapperStyles = window.getComputedStyle(wrapper);
  const paddingBottom = parseFloat(wrapperStyles.paddingBottom) || 0;
  const chartTopOffset = wrapperRect ? Math.max(0, chartRect.top - wrapperRect.top) : 0;
  const chartHeight = Math.max(
    CHART_RENDERER_MIN_CANVAS_HEIGHT,
    Math.round(chartRect.height || chartDiv.offsetHeight || CHART_RENDERER_MIN_CANVAS_HEIGHT)
  );

  const clampResult = window.__bubbleLayoutHeightManager?.ensureWrapperCapacity
    ? window.__bubbleLayoutHeightManager.ensureWrapperCapacity({
        wrapperElement: wrapper,
        chartHeight,
        chromeBeforeChart: chartTopOffset,
        chromeAfterChart: paddingBottom
      })
    : enforceBubbleWrapperMinimumHeight({
        wrapperElement: wrapper,
        wrapperRect,
        chartTopOffset,
        paddingBottom,
        appliedChartHeight: chartHeight
      });

  comparisonDebugLog('chart wrapper refresh', {
    reason,
    chartHeight,
    chartTopOffset,
    paddingBottom,
    clampResult
  });

  return clampResult;
}

function enforceBubbleWrapperMinimumHeight(params) {
  if (!params?.wrapperElement) {
    return {
      expanded: false,
      requiredHeight: null,
      finalHeight: params?.wrapperRect ? Math.round(params.wrapperRect.height || 0) : null
    };
  }

  return {
    expanded: false,
    requiredHeight: null,
    finalHeight: params.wrapperRect ? Math.round(params.wrapperRect.height || 0) : null
  };
}

/**
 * Display a status message to the user
 * @param {string} message - Message to display
 * @param {string} type - Message type: 'error', 'warning', 'info'
 */
function showMessage(message, type = 'info') {
  let messageDiv = document.getElementById('statusMessage');
  if (!messageDiv) {
    messageDiv = document.createElement('div');
    messageDiv.id = 'statusMessage';
    const chartWrapper = document.querySelector('.chart-wrapper');
    chartWrapper.parentNode.insertBefore(messageDiv, chartWrapper);
  }
  
  messageDiv.className = `status-message ${type}`;
  messageDiv.textContent = message;
  messageDiv.style.display = 'block';
}

/**
 * Clear status message
 */
function clearMessage() {
  const messageDiv = document.getElementById('statusMessage');
  if (messageDiv) {
    messageDiv.style.display = 'none';
  }
}

/**
 * Get current chart data for export
 * @returns {Object} Current chart data
 */
function getCurrentChartData() {
  return currentChartData;
}

/**
 * Get chart instance
 * @returns {Object} Google Chart instance
 */
function getChartInstance() {
  return chart;
}

// Export chart renderer functions
window.ChartRenderer = {
  drawBubbleChart,
  showMessage,
  clearMessage,
  getCurrentChartData,
  getChartInstance,
  waitForStability: waitForChartStability,
  refreshLayoutBounds: refreshChartLayoutBounds
};
