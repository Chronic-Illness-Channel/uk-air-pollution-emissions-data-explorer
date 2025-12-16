/**
 * Main Chart and UI Module
 * Handles chart rendering, UI interactions, category management, and initialization
 * v2.4 - Now uses shared color module
 */

const lineUrlParams = new URLSearchParams(window.location.search || '');
const lineDebugLoggingEnabled = ['debug', 'logs', 'debugLogs'].some(flag => lineUrlParams.has(flag));
const lineDebugWarn = (...args) => {
  if (lineDebugLoggingEnabled) {
    console.warn(...args);
  }
};
window.__NAEI_DEBUG__ = window.__NAEI_DEBUG__ || lineDebugLoggingEnabled;

if (!lineDebugLoggingEnabled) {
  console.log = () => {};
  console.info = () => {};
  if (console.debug) {
    console.debug = () => {};
  }
}

// Global chart instance and state
let chart; // global chart instance
let seriesVisibility = [];
window.seriesVisibility = seriesVisibility; // Expose for export.js
let urlUpdateTimer = null; // Debounce timer for URL updates
let googleChartsReady = false;
let googleChartsLoadPromise = null;
let initialLoadComplete = false; // Track if initial chart load is done (prevent resize redraw)
let initFailureNotified = false; // Ensure we only notify parent once on failure
let chartReadyNotified = false; // Prevent duplicate chartReady messages
let hydrationRefreshPending = false;
let hydrationRefreshTimer = null;
let lastTrackedLineSelectionKey = null; // Avoid duplicate analytics events when selections stay the same
const DEFAULT_LINE_SELECTIONS = {
  pollutant: 'PM2.5',
  categories: ['All'],
  startYear: null,
  endYear: null
};

function matchesLineChartParam(value) {
  if (value === null || value === undefined) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '2' || normalized === 'linechart' || normalized === 'line';
}

function scheduleHydrationRefreshAttempt(attempt = 0) {
  if (!hydrationRefreshPending) {
    return;
  }

  if (!selectionsReady()) {
    if (attempt >= 6) {
      return;
    }
    hydrationRefreshTimer = setTimeout(() => scheduleHydrationRefreshAttempt(attempt + 1), 150);
    return;
  }

  hydrationRefreshPending = false;
  hydrationRefreshTimer = null;

  try {
    updateChart();
  } catch (error) {
    lineDebugWarn('Unable to refresh line chart after dataset hydration', error);
  }
}

function requestHydrationRefresh() {
  hydrationRefreshPending = true;
  if (hydrationRefreshTimer) {
    clearTimeout(hydrationRefreshTimer);
  }

  const delay = initialLoadComplete ? 30 : 160;
  hydrationRefreshTimer = setTimeout(() => scheduleHydrationRefreshAttempt(0), delay);
}

function hasGoogleCoreChartConstructors() {
  return Boolean(window.google?.visualization?.DataTable && window.google?.visualization?.LineChart);
}

// Provide a minimal fallback palette if the shared Colors module fails to load.
if (!window.Colors) {
  console.warn('Colors module not found in line chart – using fallback palette.');
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

function createLineStabilityHandle() {
  let resolved = false;
  let resolver = null;
  const promise = new Promise(resolve => {
    resolver = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };
  });
  return {
    promise,
    resolve() {
      resolver?.();
    }
  };
}

let lineChartStabilityHandle = {
  promise: Promise.resolve(),
  resolve() {}
};

function beginLineChartStabilityCycle() {
  lineChartStabilityHandle = createLineStabilityHandle();
  return lineChartStabilityHandle;
}

function waitForLineChartStability() {
  return lineChartStabilityHandle?.promise || Promise.resolve();
}

function isLineChartEmbedded() {
  try {
    return Boolean(window.parent && window.parent !== window);
  } catch (error) {
    return false;
  }
}

function readLineSnapshotDefaults() {
  const extractDefaults = cache => {
    if (!cache || !cache.defaultSnapshot) {
      return null;
    }
    return cache.defaultSnapshot?.defaults?.lineChart || null;
  };

  const local = extractDefaults(window.SharedDataCache);
  if (local) {
    return local;
  }

  try {
    const parentDefaults = extractDefaults(window.parent?.SharedDataCache);
    if (parentDefaults) {
      return parentDefaults;
    }
  } catch (error) {}

  return null;
}

function getLineDefaultSelections() {
  const snapshotDefaults = readLineSnapshotDefaults();
  return {
    pollutant: snapshotDefaults?.pollutant || DEFAULT_LINE_SELECTIONS.pollutant,
    categories: (snapshotDefaults?.categories?.length ? snapshotDefaults.categories : DEFAULT_LINE_SELECTIONS.categories),
    startYear: snapshotDefaults?.startYear ?? DEFAULT_LINE_SELECTIONS.startYear,
    endYear: snapshotDefaults?.endYear ?? DEFAULT_LINE_SELECTIONS.endYear
  };
}

const LINE_MIN_CHART_CANVAS_HEIGHT = 420;
const LINE_CHART_HEADER_BUFFER = 10;
const LINE_FOOTER_GAP = 6;
const LINE_MIN_HEIGHT_DELTA = 8;
const LINE_DEFAULT_PARENT_FOOTER = 140;
const LINE_DEFAULT_PARENT_VIEWPORT = 900;
const LINE_DEFAULT_CSS_FOOTER_RESERVE = 160;
const LINE_CSS_VISUAL_PADDING = 27;
const LINE_IS_EMBEDDED = window.parent && window.parent !== window;

function computeEffectiveLineViewportHeight() {
  const runtimeViewport = () => (
    window.visualViewport?.height
    || window.innerHeight
    || document.documentElement?.clientHeight
    || 0
  );

  if (!LINE_IS_EMBEDDED) {
    return runtimeViewport();
  }

  const managerViewport = lineLayoutHeightManager?.getParentViewportHeight?.();
  if (Number.isFinite(managerViewport) && managerViewport > 0) {
    return Math.round(managerViewport);
  }

  if (Number.isFinite(lineParentViewportHeight) && lineParentViewportHeight > 0) {
    return Math.round(lineParentViewportHeight);
  }

  const liveViewport = runtimeViewport();
  return liveViewport > 0 ? Math.round(liveViewport) : 0;
}

const lineLayoutHeightManager = window.LayoutHeightManager?.create({
  namespace: 'line',
  wrapperSelector: '.chart-wrapper',
  chartSelector: '#chart_div',
  minChartHeight: LINE_MIN_CHART_CANVAS_HEIGHT,
  footerGap: LINE_FOOTER_GAP,
  visualPadding: LINE_CSS_VISUAL_PADDING,
  minHeightDelta: LINE_MIN_HEIGHT_DELTA,
  heightDebounce: 250
});

if (lineLayoutHeightManager) {
  window.__lineLayoutHeightManager = lineLayoutHeightManager;

  lineLayoutHeightManager.onParentViewportChange?.(() => {
    syncLineChartHeight('parent-viewport', { redraw: true });
  });
}

window.addEventListener('lineFullDatasetHydrated', (event) => {
  if (lineDebugLoggingEnabled) {
    console.warn('Line chart full dataset hydrated; refreshing chart', event?.detail || {});
  }
  requestHydrationRefresh();
});

let lineParentFooterHeight = LINE_DEFAULT_PARENT_FOOTER;
let lineParentViewportHeight = LINE_DEFAULT_PARENT_VIEWPORT;
let lineLastSentHeight = 0;

function applyLineCssViewportHeight(value) {
  if (lineLayoutHeightManager?.applyViewportHeight) {
    return lineLayoutHeightManager.applyViewportHeight(value);
  }

  const finalValue = typeof value === 'string'
    ? value
    : `${Math.max(0, Math.round(Number(value) || 0))}px`;

  try {
    document.documentElement?.style?.setProperty('--line-viewport-height', finalValue);
  } catch (error) {
    lineDebugWarn('Unable to apply line viewport height CSS variable', error);
  }

  return finalValue;
}

function applyLineCssFooterReserve(pixels) {
  if (lineLayoutHeightManager?.applyFooterReserve) {
    return lineLayoutHeightManager.applyFooterReserve(pixels);
  }

  const numeric = Math.max(LINE_FOOTER_GAP, Math.round(Number(pixels) || 0));
  const padded = numeric + Math.max(0, Math.round(LINE_CSS_VISUAL_PADDING || 0));
  const finalValue = `${padded}px`;

  try {
    document.documentElement?.style?.setProperty('--line-footer-height', finalValue);
  } catch (error) {
    lineDebugWarn('Unable to apply line footer reserve CSS variable', error);
  }

  return finalValue;
}

function getLineStandaloneFooterHeight() {
  const footer = document.querySelector('footer');
  if (!footer) {
    return LINE_DEFAULT_PARENT_FOOTER;
  }

  const rect = footer.getBoundingClientRect();
  const styles = window.getComputedStyle(footer);
  const margins = (parseFloat(styles.marginTop) || 0) + (parseFloat(styles.marginBottom) || 0);
  const total = Math.round((rect.height || 0) + margins);
  return total || LINE_DEFAULT_PARENT_FOOTER;
}

function updateChartWrapperHeight(contextLabel = 'init') {
  const viewportHeight = computeEffectiveLineViewportHeight();
  if (!viewportHeight) {
    lineDebugWarn('Line viewport height unavailable while updating chart wrapper height');
    return lineLayoutHeightManager?.getLastEstimatedHeight?.() || LINE_MIN_CHART_CANVAS_HEIGHT;
  }

  if (!LINE_IS_EMBEDDED) {
    applyLineCssViewportHeight(`${viewportHeight}px`);
  }

  const managerFooter = lineLayoutHeightManager?.getParentFooterHeight?.();
  const footerSource = LINE_IS_EMBEDDED
    ? (Number.isFinite(managerFooter) ? managerFooter : lineParentFooterHeight)
    : getLineStandaloneFooterHeight();
  const footerReserve = Math.max(LINE_FOOTER_GAP, footerSource) + LINE_FOOTER_GAP;

  applyLineCssFooterReserve(footerReserve);

  const chromeBuffer = LINE_CHART_HEADER_BUFFER;
  const estimatedChartHeight = lineLayoutHeightManager
    ? lineLayoutHeightManager.estimateChartHeight({
        viewportHeight,
        footerReserve,
        chromeBuffer
      })
    : Math.max(
        LINE_MIN_CHART_CANVAS_HEIGHT,
        viewportHeight - footerReserve - chromeBuffer
      );

  window.__NAEI_LAST_CHART_HEIGHT = estimatedChartHeight;

  return estimatedChartHeight;
}

function logLineViewportHeight(contextLabel = 'resize') {
  // Previously emitted detailed viewport diagnostics for every height update.
  // These logs created too much noise even when debug=1, so the hook is now silent.
  return;
}

function updateLineChartTitle(yearLabel, pollutantTitle) {
  const chartTitleEl = document.getElementById('chartTitle');
  if (!chartTitleEl) {
    return { element: null, height: 0 };
  }

  chartTitleEl.innerHTML = '';

  const yearElement = document.createElement('div');
  yearElement.className = 'chart-title__year-range';
  yearElement.textContent = yearLabel;
  chartTitleEl.appendChild(yearElement);

  const pollutantElement = document.createElement('div');
  pollutantElement.className = 'chart-title__pollutant';
  pollutantElement.textContent = pollutantTitle;
  chartTitleEl.appendChild(pollutantElement);

  const measuredHeight = chartTitleEl.getBoundingClientRect?.().height || 0;
  return { element: chartTitleEl, height: Math.round(measuredHeight) };
}


window.logLineViewportHeight = logLineViewportHeight;

function syncLineChartHeight(contextLabel = 'update', { redraw = false } = {}) {
  logLineViewportHeight(contextLabel);
  const estimated = updateChartWrapperHeight(contextLabel);
  if (redraw) {
    window._pendingHeightUpdate = true;
    updateChart();
  }
  return estimated;
}

function loadGoogleChartsLibrary() {
  if (googleChartsReady && hasGoogleCoreChartConstructors()) {
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
      if (!hasGoogleCoreChartConstructors()) {
        return; // Wait for visualization namespace to be ready
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

// Begin loading immediately so the chart can render as soon as data is ready
loadGoogleChartsLibrary().catch(error => {
  console.error('Unable to initialize Google Charts:', error);
});

// Build/version banner for diagnostics
(function(){
  try {
    const build = 'v2.4-embed-gate-2025-11-04T20:26Z';
    window.__LINECHART_BUILD__ = build;
    document.documentElement.setAttribute('data-linechart-build', build);
  } catch (e) { /* no-op */ }
})();

/**
 * Creates and displays a dismissible error notification.
 * @param {string} message - The error message to display.
 */
function showError(message) {
  try {
    // Create the notification element
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-notification';
    errorDiv.textContent = message;

    // Create the close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.className = 'close-button';
    closeButton.onclick = () => {
      errorDiv.style.opacity = '0';
      setTimeout(() => {
        if (errorDiv.parentNode) {
          errorDiv.parentNode.removeChild(errorDiv);
        }
      }, 300); // Allow fade out transition to complete
    };

    errorDiv.appendChild(closeButton);

    // Add to the body
    document.body.appendChild(errorDiv);

    // Fade in the notification
    setTimeout(() => {
      errorDiv.style.opacity = '1';
    }, 10);

  } catch (e) {
    console.error("Failed to show error notification:", e);
    // Fallback to alert if the notification system fails
    alert(message);
  }
}

// Export configuration constants
const EXPORT_MIN_SCALE = 16;
const EXPORT_MAX_DIM = 16000;
const EXPORT_MAX_PIXELS = 100_000_000;

// Chart options
let smoothLines = true; // default to smooth (curved) lines
window.smoothLines = smoothLines; // Expose for export.js

const isOperaBrowser = (() => {
  try {
    const ua = navigator.userAgent || '';
    return ua.includes('OPR/') || ua.includes('Opera');
  } catch (error) {
    console.warn('Unable to detect Opera browser:', error);
    return false;
  }
})();

function applyOperaFixedWidth(el, widthPx) {
  if (!el || !widthPx) {
    return;
  }

  const widthValue = `${Math.max(0, Math.round(widthPx))}px`;
  el.classList.add('opera-wide-select');
  el.style.setProperty('width', widthValue, 'important');
  el.style.setProperty('min-width', widthValue, 'important');
  el.style.setProperty('max-width', widthValue, 'important');
}

function freezeWidthForOpera(selectors = [], opts = {}) {
  if (!isOperaBrowser) {
    return;
  }

  const config = typeof opts === 'number' ? { extraPadding: opts } : (opts || {});
  const minWidth = Number.isFinite(config.minWidth) ? Number(config.minWidth) : null;
  const fixedWidth = Number.isFinite(config.fixedWidth) ? Number(config.fixedWidth) : null;
  const maxWidth = Number.isFinite(config.maxWidth) ? Number(config.maxWidth) : null;
  const extraPadding = Number.isFinite(config.extraPadding) ? Number(config.extraPadding) : 12;
  const attempts = Math.max(1, Number.isFinite(config.attempts) ? Number(config.attempts) : 4);
  const attemptDelay = Math.max(16, Number.isFinite(config.attemptDelay) ? Number(config.attemptDelay) : 120);
  const arrowAllowance = Number.isFinite(config.arrowAllowance) ? Number(config.arrowAllowance) : 0;
  const elements = Array.isArray(selectors) ? selectors : [selectors];

  const measureAndFreeze = () => {
    requestAnimationFrame(() => {
      elements.forEach(selector => {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el) {
          return;
        }

        el.style.width = '';
        el.style.minWidth = '';
        el.style.maxWidth = '';

        const rectWidth = Math.ceil(el.getBoundingClientRect().width || 0);
        const scrollWidth = Math.ceil(el.scrollWidth || 0);
        const baseWidth = Math.max(rectWidth, scrollWidth);
        let targetWidth = fixedWidth || Math.max(minWidth || 0, baseWidth + extraPadding);
        if (Number.isFinite(maxWidth)) {
          targetWidth = Math.min(maxWidth, targetWidth);
        }
        const finalWidth = targetWidth + arrowAllowance;
        if (finalWidth > 0) {
          applyOperaFixedWidth(el, finalWidth);
        }
      });
    });
  };

  let remaining = attempts;
  const schedule = () => {
    if (remaining <= 0) {
      return;
    }
    remaining -= 1;
    measureAndFreeze();
    if (remaining > 0) {
      setTimeout(schedule, attemptDelay);
    }
  };

  schedule();

  if (document.fonts?.ready) {
    document.fonts.ready.then(measureAndFreeze).catch(measureAndFreeze);
  }
}

const SMOOTHING_TOGGLE_LABELS = {
  smoothingOn: {
    text: 'Disable Smoothing',
    iconClass: 'smoothing-icon smoothing-icon-disable'
  },
  smoothingOff: {
    text: 'Enable Smoothing',
    iconClass: 'smoothing-icon smoothing-icon-enable'
  }
};

function populateSmoothingToggleContent(target, config) {
  if (!target) {
    return;
  }

  const normalized = {
    text: (config && config.text) || '',
    iconClass: (config && config.iconClass) || ''
  };

  while (target.firstChild) {
    target.removeChild(target.firstChild);
  }

  if (normalized.iconClass) {
    const iconSpan = document.createElement('span');
    iconSpan.className = normalized.iconClass;
    iconSpan.setAttribute('aria-hidden', 'true');
    target.appendChild(iconSpan);
  }

  const textSpan = document.createElement('span');
  textSpan.className = 'smoothing-label-text';
  textSpan.textContent = normalized.text;
  target.appendChild(textSpan);
}

function freezeSmoothingToggleWidth(options = {}) {
  const button = document.getElementById('toggleSmoothBtn');
  if (!button || !document.body) {
    return;
  }

  const config = typeof options === 'number' ? { attempts: options } : options;
  const attempts = Math.max(1, Number.isFinite(config.attempts) ? Number(config.attempts) : 4);
  const attemptDelay = Math.max(16, Number.isFinite(config.attemptDelay) ? Number(config.attemptDelay) : 140);
  const extraPadding = Number.isFinite(config.extraPadding) ? Number(config.extraPadding) : 6;

  const measureCandidate = (config) => {
    if (!config) {
      return 0;
    }
    const clone = button.cloneNode(true);
    clone.removeAttribute('id');
    populateSmoothingToggleContent(clone, config);
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.pointerEvents = 'none';
    clone.style.width = 'auto';
    clone.style.minWidth = '';
    clone.style.maxWidth = '';
    clone.style.whiteSpace = 'nowrap';
    document.body.appendChild(clone);
    const width = Math.ceil(clone.getBoundingClientRect().width || 0);
    clone.remove();
    return width;
  };

  const freezeWidth = () => {
    const labels = [
      button.dataset.labelOn ? {
        text: button.dataset.labelOn,
        iconClass: SMOOTHING_TOGGLE_LABELS.smoothingOn.iconClass
      } : null,
      button.dataset.labelOff ? {
        text: button.dataset.labelOff,
        iconClass: SMOOTHING_TOGGLE_LABELS.smoothingOff.iconClass
      } : null,
      SMOOTHING_TOGGLE_LABELS.smoothingOn,
      SMOOTHING_TOGGLE_LABELS.smoothingOff
    ].filter(Boolean);

    if (!labels.length) {
      return;
    }

    const widest = labels.reduce((maxWidth, label) => {
      return Math.max(maxWidth, measureCandidate(label));
    }, 0);

    if (widest > 0) {
      const paddedWidth = Math.ceil(widest + extraPadding);
      const widthValue = `${paddedWidth}px`;
      button.style.width = widthValue;
      button.style.minWidth = widthValue;
      button.style.maxWidth = widthValue;
      button.dataset.smoothingWidthFrozen = widthValue;
    }
  };

  let remaining = attempts;
  const schedule = () => {
    if (remaining <= 0) {
      return;
    }
    remaining -= 1;
    requestAnimationFrame(freezeWidth);
    if (remaining > 0) {
      setTimeout(schedule, attemptDelay);
    }
  };

  schedule();

  if (document.fonts?.ready) {
    document.fonts.ready.then(freezeWidth).catch(freezeWidth);
  }
}

function updateSmoothingToggleLabel(button, isSmooth) {
  if (!button) {
    return;
  }

  const labelConfig = isSmooth
    ? SMOOTHING_TOGGLE_LABELS.smoothingOn
    : SMOOTHING_TOGGLE_LABELS.smoothingOff;

  populateSmoothingToggleContent(button, labelConfig);
  button.setAttribute('aria-pressed', isSmooth ? 'true' : 'false');
  button.setAttribute('aria-label', labelConfig?.text || '');
  button.dataset.smoothingState = isSmooth ? 'on' : 'off';
}

function getElementBottom(el) {
  if (!el) {
    return 0;
  }
  const rect = el.getBoundingClientRect();
  const scrollOffset = window.scrollY || window.pageYOffset || 0;
  return Math.max(0, Math.round((rect.bottom || 0) + scrollOffset));
}

function measureLineContentHeight() {
  const body = document.body;
  const html = document.documentElement;
  const documentHeight = Math.max(
    body?.scrollHeight || 0,
    body?.offsetHeight || 0,
    html?.scrollHeight || 0,
    html?.offsetHeight || 0
  );

  const chartShell = document.querySelector('.chart-shell');
  const mainContent = document.getElementById('mainContent');
  const wrapperEl = lineLayoutHeightManager?.getWrapperElement?.() || document.querySelector('.chart-wrapper');
  const loadingOverlay = document.getElementById('loadingOverlay');

  const shellBottom = getElementBottom(chartShell);
  const mainContentBottom = getElementBottom(mainContent);
  const wrapperBottom = getElementBottom(wrapperEl);
  const overlayBottom = (loadingOverlay && !loadingOverlay.classList.contains('hidden') && loadingOverlay.offsetParent !== null)
    ? getElementBottom(loadingOverlay)
    : 0;

  const candidates = [
    { label: 'chartShell', value: shellBottom },
    { label: 'mainContent', value: mainContentBottom },
    { label: 'chartWrapper', value: wrapperBottom }
  ].filter(candidate => candidate.value > 0);

  let measuredHeight = 0;
  let preferredSource = 'none';

  if (candidates.length) {
    const bestCandidate = candidates.reduce((prev, next) => (next.value > prev.value ? next : prev));
    measuredHeight = bestCandidate.value;
    preferredSource = bestCandidate.label;
  }

  const fallbackEstimate = Math.max(
    LINE_MIN_CHART_CANVAS_HEIGHT + LINE_CHART_HEADER_BUFFER + LINE_FOOTER_GAP,
    lineLayoutHeightManager?.getLastEstimatedHeight?.() || window.__NAEI_LAST_CHART_HEIGHT || LINE_MIN_CHART_CANVAS_HEIGHT
  );

  if (!measuredHeight && documentHeight) {
    measuredHeight = documentHeight;
    preferredSource = 'document';
  }

  if (!measuredHeight) {
    measuredHeight = fallbackEstimate;
    preferredSource = 'fallback';
  }

  if (measuredHeight < 300) {
    measuredHeight = Math.max(1100, fallbackEstimate);
    preferredSource = 'fallback-min';
  }

  return {
    height: Math.round(measuredHeight),
    source: preferredSource,
    documentHeight: Math.round(documentHeight || 0),
    shellBottom,
    mainContentBottom,
    wrapperBottom,
    overlayBottom,
    fallbackEstimate: Math.round(fallbackEstimate)
  };
}

function sendContentHeightToParent(force = false) {
  try {
    if (!LINE_IS_EMBEDDED) {
      return;
    }

    const measurement = measureLineContentHeight();
    const measuredHeight = Math.max(LINE_MIN_CHART_CANVAS_HEIGHT, measurement.height);

    if (!force && lineLastSentHeight && Math.abs(measuredHeight - lineLastSentHeight) < LINE_MIN_HEIGHT_DELTA) {
      return;
    }

    lineLastSentHeight = measuredHeight;

    window.parent.postMessage({
      type: 'contentHeight',
      chart: 'line',
      height: measuredHeight
    }, '*');

    requestAnimationFrame(() => updateChartWrapperHeight('post-height-send'));
  } catch (error) {
    console.error('Unable to send line chart content height to parent:', error);
  }
}

applyLineCssFooterReserve(LINE_DEFAULT_CSS_FOOTER_RESERVE);
applyLineCssViewportHeight('100vh');
if (LINE_IS_EMBEDDED) {
  applyLineCssViewportHeight(`${lineParentViewportHeight}px`);
}

// Listen for messages from parent
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'overlayHidden') {
    initialLoadComplete = true;
    
    // Now that overlay is hidden and layout is stable, send final accurate height
    setTimeout(() => {
      sendContentHeightToParent();
    }, 100);
  }
  
  // Handle height request from parent (sent before hiding overlay to prevent layout shift)
  if (event.data && event.data.type === 'requestHeight') {
    sendContentHeightToParent();
  }

  if (event.data && event.data.type === 'parentViewportMetrics') {
    if (lineLayoutHeightManager) {
      const metrics = lineLayoutHeightManager.handleParentMetrics(event.data) || {};
      if (Number.isFinite(metrics.footerHeight)) {
        lineParentFooterHeight = Math.max(metrics.footerHeight, LINE_FOOTER_GAP);
      }
      if (Number.isFinite(metrics.viewportHeight)) {
        lineParentViewportHeight = metrics.viewportHeight;
      }
    } else {
      const previousFooter = lineParentFooterHeight;
      const previousViewport = lineParentViewportHeight;
      const footerCandidate = Number(event.data.footerHeight);
      const viewportCandidate = Number(event.data.viewportHeight);

      if (Number.isFinite(footerCandidate) && footerCandidate >= 0) {
        lineParentFooterHeight = Math.max(footerCandidate, LINE_FOOTER_GAP);
        applyLineCssFooterReserve(lineParentFooterHeight + LINE_FOOTER_GAP);
      }

      if (Number.isFinite(viewportCandidate) && viewportCandidate > 0) {
        lineParentViewportHeight = Math.round(viewportCandidate);
        applyLineCssViewportHeight(`${lineParentViewportHeight}px`);
      }

      const footerDelta = Math.abs((lineParentFooterHeight || 0) - (previousFooter || 0));
      const viewportDelta = Math.abs((lineParentViewportHeight || 0) - (previousViewport || 0));
      if (Math.max(footerDelta, viewportDelta) >= RESIZE_THRESHOLD) {
        if (parentViewportRedrawTimer) {
          clearTimeout(parentViewportRedrawTimer);
        }
        parentViewportRedrawTimer = setTimeout(() => {
          parentViewportRedrawTimer = null;
          syncLineChartHeight('parent-viewport', { redraw: true });
        }, 200);
      } else {
        updateChartWrapperHeight('parent-viewport');
        logLineViewportHeight('parent-viewport');
      }
      return;
    }
    // Layout manager present: it will invoke the registered callback after debouncing
    updateChartWrapperHeight('parent-viewport');
    logLineViewportHeight('parent-viewport');
  }
});

function shouldSkipDirectionalNavigationTarget(target) {
  if (!target) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
  return ['input', 'textarea', 'select'].includes(tagName);
}

function setupParentNavigationForwarding(sourceLabel = 'line') {
  if (!LINE_IS_EMBEDDED || !window.parent) {
    return;
  }

  const forwardDirectionalKeys = (event) => {
    if (event.defaultPrevented) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    const target = event.target || document.activeElement;
    if (shouldSkipDirectionalNavigationTarget(target)) {
      return;
    }

    try {
      window.parent.postMessage({
        type: 'requestChartNavigation',
        direction: event.key === 'ArrowRight' ? 'next' : 'previous',
        source: sourceLabel
      }, '*');
      event.preventDefault();
    } catch (error) {
      lineDebugWarn('Unable to forward navigation request to parent', error);
    }
  };

  document.addEventListener('keydown', forwardDirectionalKeys);
}

setupParentNavigationForwarding('line');

// ---- Helpers for selection readiness & notices ----
function selectionsReady() {
  try {
    const pollutant = document.getElementById('pollutantSelect')?.value;
    const startYear = +document.getElementById('startYear')?.value;
    const endYear = +document.getElementById('endYear')?.value;
    const categories = getSelectedCategories();
    return Boolean(pollutant && startYear && endYear && startYear < endYear && categories.length);
  } catch (e) {
    return false;
  }
}

function ensureNoticeContainer() {
  let el = document.getElementById('chartNotice');
  if (!el) {
    const wrapper = document.querySelector('.chart-wrapper') || document.body;
    el = document.createElement('div');
    el.id = 'chartNotice';
    el.style.display = 'none';
    el.style.margin = '6px 0 4px 0';
    el.style.color = '#b91c1c';
    el.style.fontSize = '14px';
    el.style.fontWeight = '600';
    wrapper.insertBefore(el, document.getElementById('chart_div'));
  }
  return el;
}

function showNotice(msg) {
  const el = ensureNoticeContainer();
  el.textContent = msg;
  el.style.display = 'block';
}

function hideNotice() {
  const el = ensureNoticeContainer();
  el.textContent = '';
  el.style.display = 'none';
}

/**
 * Compute a safe export scale that respects EXPORT_MAX_DIM and EXPORT_MAX_PIXELS.
 * origW/origH are the logical SVG/chart sizes in CSS pixels. desiredScale is
 * the requested scale (e.g. Math.max(devicePixelRatio, EXPORT_MIN_SCALE)).
 */
function computeSafeExportScale(origW, origH, desiredScale) {
  if (!origW || !origH || !isFinite(desiredScale) || desiredScale <= 0) return 1;
  // Max scale to keep each dimension under EXPORT_MAX_DIM
  const maxDimScale = Math.min(EXPORT_MAX_DIM / origW, EXPORT_MAX_DIM / origH);
  // Max scale to keep total pixels under EXPORT_MAX_PIXELS
  const maxAreaScale = Math.sqrt(EXPORT_MAX_PIXELS / (origW * origH));
  const allowed = Math.max(1, Math.min(desiredScale, maxDimScale, maxAreaScale));
  if (allowed < desiredScale) {
    console.warn('Export scale ' + desiredScale + ' reduced to ' + allowed + ' to avoid huge canvas (' + Math.round(origW*allowed) + 'x' + Math.round(origH*allowed) + ')');
    try {
      window.__export_debug = window.__export_debug || {};
      window.__export_debug.lastClamped = { origW, origH, desiredScale, allowed };
    } catch (e) {}
  }
  return allowed;
}

/* ---------------- Setup Functions ---------------- */
function getCategoryDisplayTitle(record) {
  if (!record || typeof record !== 'object') {
    return '';
  }
  const title = record.category_title
    || record.group_name
    || record.title
    || '';
  return typeof title === 'string' ? title : '';
}

function setupSelectors(pollutants, categories) {
  const sel = document.getElementById('pollutantSelect');
  sel.innerHTML = '<option value="">Select pollutant</option>';

  if (pollutants && pollutants.length) {
    const pollutantNames = [...new Set(pollutants.map(p => p.pollutant))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    pollutantNames.forEach(p => sel.add(new Option(p, p)));
  }

  if (categories && categories.length) {
    const categoryNames = [...new Set(categories.map(getCategoryDisplayTitle))]
      .filter(Boolean)
      .sort((a, b) => {
        if (a.toLowerCase() === 'all') return -1;
        if (b.toLowerCase() === 'all') return 1;
        return a.localeCompare(b);
      });
    window.allCategoriesList = categoryNames;
  }

  const years = window.globalYears || [];
  const startSel = document.getElementById('startYear');
  const endSel = document.getElementById('endYear');

  startSel.innerHTML = '';
  endSel.innerHTML = '';

  years.forEach(y => {
    startSel.add(new Option(y, y));
    endSel.add(new Option(y, y));
  });

  startSel.value = years[0] || '';
  endSel.value = years[years.length - 1] || '';

  sel.addEventListener('change', updateChart);
  startSel.addEventListener('change', () => {
    updateYearDropdowns();
    updateChart();
  });
  endSel.addEventListener('change', () => {
    updateYearDropdowns();
    updateChart();
  });

  // Category selectors will be added by the init() function after URL parameter processing
  // This prevents double category creation that causes visual jumping
}

function updateYearDropdowns() {
  const startSel = document.getElementById('startYear');
  const endSel = document.getElementById('endYear');
  const allYears = (window.globalYears || []).map(y => parseInt(y));

  let currentStart = parseInt(startSel.value);
  let currentEnd = parseInt(endSel.value);

  // If the start year is greater than or equal to the end year, auto-correct it.
  if (currentStart >= currentEnd) {
    // Find the index of the current end year
    const endIdx = allYears.indexOf(currentEnd);
    // Set the start year to be one step before the end year, if possible
    if (endIdx > 0) {
      currentStart = allYears[endIdx - 1];
    } else {
      // If end year is the very first year, we can't go back.
      // This is an edge case. Let's just ensure start is not equal to end.
      // A better UX might be to adjust the end year forward instead.
      // For now, this prevents a crash.
      if (allYears.length > 1) {
        currentEnd = allYears[1];
      }
    }
    startSel.value = currentStart;
  }

  const startVal = startSel.value;
  const endVal = endSel.value;

  // Repopulate the start year dropdown: must be less than currentEnd
  startSel.innerHTML = '';
  allYears.forEach(year => {
    if (year < parseInt(endVal)) {
      startSel.add(new Option(year, year));
    }
  });
  startSel.value = startVal;

  // Repopulate the end year dropdown: must be greater than currentStart
  endSel.innerHTML = '';
  allYears.forEach(year => {
    if (year > parseInt(startVal)) {
      endSel.add(new Option(year, year));
    }
  });
  endSel.value = endVal;
}

function getSelectedCategories(){
  return [...document.querySelectorAll('#categoryContainer select')]
    .map(s => s.value)
    .filter(Boolean);
}
window.getSelectedCategories = getSelectedCategories;

function addCategorySelector(defaultValue = "", usePlaceholder = true){
  const categoryName = (defaultValue && typeof defaultValue === 'object')
    ? getCategoryDisplayTitle(defaultValue)
    : defaultValue;
  const container = document.getElementById('categoryContainer');
  const div = document.createElement('div');
  div.className = 'categoryRow';
  div.draggable = true;

  // category control wrapper (keeps drag handle and select together)
  const controlWrap = document.createElement('div');
  controlWrap.className = 'category-control';

  // convert drag handle into an accessible button so it's keyboard-focusable
  const handleBtn = document.createElement('button');
  handleBtn.type = 'button';
  handleBtn.className = 'dragHandle';
  handleBtn.setAttribute('aria-label', 'Reorder category (use arrow keys)');
  handleBtn.title = 'Drag to reorder (or focus and use Arrow keys)';
  handleBtn.textContent = '⠿';
  handleBtn.style.marginRight = '6px';
  controlWrap.appendChild(handleBtn);

  // category select
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Category selector');
  sel.name = 'categorySelector';
  if (usePlaceholder){
    const ph = new Option('Select category','');
    ph.disabled = true; ph.selected = true;
    sel.add(ph);
  }
  const allCategories = window.allCategoriesList || [];

  const selected = getSelectedCategories();
  allCategories.forEach(category => {
    if (!selected.includes(category) || category === categoryName) sel.add(new Option(category,category));
  });
  if (categoryName) sel.value = categoryName;
  sel.addEventListener('change', () => { refreshCategoryDropdowns(); updateChart(); });

  controlWrap.appendChild(sel);
  // append the control wrap first; remove button will be appended to row as a sibling
  div.appendChild(controlWrap);

  // keyboard handlers for reordering when handleBtn is focused
  handleBtn.addEventListener('keydown', (e) => {
    try {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        let prev = div.previousElementSibling;
        while (prev && !prev.classList.contains('categoryRow')) prev = prev.previousElementSibling;
        if (prev) {
          container.insertBefore(div, prev);
          refreshCategoryDropdowns();
          refreshButtons();
          updateChart();
          // move focus back to the handle for continued keyboard moves
          handleBtn.focus();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        let next = div.nextElementSibling;
        while (next && !next.classList.contains('categoryRow')) next = next.nextElementSibling;
        if (next) {
          container.insertBefore(div, next.nextElementSibling);
          refreshCategoryDropdowns();
          refreshButtons();
          updateChart();
          handleBtn.focus();
        }
      }
    } catch (err) {
      console.warn('Keyboard reorder failed', err);
    }
  });

  container.appendChild(div);
  addDragAndDropHandlers(div);
  refreshButtons();
}

function refreshCategoryDropdowns(){
  const selected = getSelectedCategories();
  const all = window.allCategoriesList || [];


  document.querySelectorAll('#categoryContainer select').forEach(select => {
    const current = select.value;
    Array.from(select.options).forEach(opt => { if (opt.value !== '') opt.remove(); });
    all.forEach(category => {
      if (!selected.includes(category) || category === current) {
        const option = new Option(category,category);
        if (category === current) option.selected = true;
        select.add(option);
      }
    });
  });
}

function refreshButtons() {
  const container = document.getElementById('categoryContainer');
  // Remove any existing Add/Remove buttons to rebuild cleanly
  container.querySelectorAll('.add-btn, .remove-btn').forEach(n => n.remove());

  const rows = container.querySelectorAll('.categoryRow');

  // Add remove buttons only if there are 2 or more categories
    if (rows.length >= 2) {
    rows.forEach(row => {
        if (!row.querySelector('.remove-btn')) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '<span class="remove-icon" aria-hidden="true"></span> Remove Category';
        // make ARIA label include the current category name if available
        const sel = row.querySelector('select');
        const categoryName = sel ? (sel.value || (sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].text) || '') : '';
          removeBtn.setAttribute('aria-label', categoryName ? 'Remove category ' + categoryName : 'Remove category');
        removeBtn.onclick = () => {
          row.remove();
          refreshButtons();
          refreshCategoryDropdowns();
          updateChart();
        };
        // Append remove button as a sibling to the control wrapper so it
        // sits inline on wide screens but drops underneath on small screens
        row.appendChild(removeBtn);
      }
    });
  }

  // Add "Add Category" button just below the last selector
  let addBtn = container.querySelector('.add-btn');
  if (!addBtn) {
    addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.innerHTML = '<span class="add-icon" aria-hidden="true"></span> Add Category';
    addBtn.onclick = () => addCategorySelector("", true);
    container.appendChild(addBtn);
  }

  // Disable button if 10 categories are present
  if (rows.length >= 10) {
    addBtn.textContent = 'Max Categories = 10';
    addBtn.disabled = true;
  } else {
    addBtn.innerHTML = '<span class="add-icon" aria-hidden="true"></span> Add Category';
    addBtn.disabled = false;
  }

  // Notify parent about layout changes when control stack grows/shrinks
  if (window.parent && window.parent !== window) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          sendContentHeightToParent();
        } catch (err) {
          console.warn('Failed to send height after refreshButtons:', err);
        }
      }, 0);
    });
  }
}

function calculateYearTicks(years, chartWidth) {
  // Deterministic tick selection: evenly sample years to avoid overlap and shifting
  if (!years || !years.length) return [];

  const uniqueYears = [...new Set(years.map(y => String(y)))];
  if (uniqueYears.length <= 1) return uniqueYears;

  // For small number of years, show all
  if (uniqueYears.length <= 10) return uniqueYears;

  const minSpacing = 60; // px between labels
  const maxLabels = Math.max(2, Math.floor(chartWidth / minSpacing));

  if (uniqueYears.length <= maxLabels) return uniqueYears;

  const step = Math.ceil(uniqueYears.length / maxLabels);
  const result = uniqueYears.filter((y, idx) => idx % step === 0);

  // Always include last year
  const lastYear = uniqueYears[uniqueYears.length - 1];
  if (result[result.length - 1] !== lastYear) result.push(lastYear);

  return result;
}


/* ---------------- Drag and drop handlers ---------------- */
function addDragAndDropHandlers(div){
  div.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', '');
    div.classList.add('dragging');
  });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));
  div.addEventListener('dragover', e => {
    e.preventDefault();
    const container = document.getElementById('categoryContainer');
    const dragging = container.querySelector('.dragging');
    if (!dragging) return;
    const after = getDragAfterElement(container, e.clientY);
    const addBtn = container.querySelector('.add-btn');
    if (!after || after === addBtn) container.insertBefore(dragging, addBtn);
    else container.insertBefore(dragging, after);
  });
  div.addEventListener('drop', () => { refreshCategoryDropdowns(); updateChart(); });
}

function getDragAfterElement(container, y){
  const draggable = [...container.querySelectorAll('.categoryRow:not(.dragging)')];
  return draggable.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * Adds custom year labels to the X-axis of the chart.
 * This function is called after every chart draw/redraw.
 */
function addCustomXAxisLabels() {
  try {
    const chartContainer = document.getElementById('chart_div');
    const svg = chartContainer.querySelector('svg');
    if (!svg || !chart) return;

    const chartLayout = chart.getChartLayoutInterface();
    const chartArea = chartLayout.getChartAreaBoundingBox();
    const labelY = chartArea.top + chartArea.height + 20;
    const ns = 'http://www.w3.org/2000/svg';

    const startYear = +document.getElementById('startYear').value;
    const endYear = +document.getElementById('endYear').value;
    const yearsAll = window.globalYears || [];
    const startIdx = yearsAll.indexOf(String(startYear));
    const endIdx = yearsAll.indexOf(String(endYear));
    if (startIdx === -1 || endIdx === -1) return;
    const years = yearsAll.slice(startIdx, endIdx + 1);

    // Use calculateYearTicks to determine which years to show
    const chartWidth = chartArea.width;
    const labelsToShow = calculateYearTicks(years, chartWidth);

    const positions = [];
    const labels = [];
    const minSpacing = 40; // Minimum pixels between labels

    // First pass: collect all positions
    for (const year of labelsToShow) {
      const yearIndex = years.indexOf(year);
      if (yearIndex === -1) continue;
      
      const x = chartLayout.getXLocation(yearIndex);
      positions.push(x);

      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', labelY);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', 'Arial, sans-serif');
      text.setAttribute('font-size', '14');
      text.setAttribute('font-weight', '500');
      text.setAttribute('fill', '#333');
      text.setAttribute('data-custom-year', 'true');
      text.textContent = year;

      labels.push({ element: text, x: x, year: year });
    }

    // If the penultimate label is too close to the final label, drop it
    if (labels.length >= 2) {
      const lastIdx = labels.length - 1;
      const lastX = parseFloat(labels[lastIdx].x || labels[lastIdx].element.getAttribute('x'));
      const prevX = parseFloat(labels[lastIdx - 1].x || labels[lastIdx - 1].element.getAttribute('x'));
      if ((lastX - prevX) < minSpacing) {
        labels.splice(lastIdx - 1, 1);
      }
    }

    // Add all labels to the SVG
    labels.forEach(label => {
      svg.appendChild(label.element);
    });
  } catch (e) {
    console.warn('[CustomYearTicks] Could not add custom year labels:', e);
  }
}

/* ---------------- URL Update Function ---------------- */
function updateUrlFromChartState() {
  // Ensure the data needed for ID lookups is available.
  const pollutants = window.allPollutantsData || [];
  const categories = window.allCategoryInfo || [];

  if (!pollutants.length || !categories.length) {
    return;
  }

  clearTimeout(urlUpdateTimer);
  urlUpdateTimer = setTimeout(() => {
    try {
      const pollutantName = document.getElementById('pollutantSelect')?.value;
      const startYear = document.getElementById('startYear')?.value;
      const endYear = document.getElementById('endYear')?.value;
      const categoryNames = getSelectedCategories();

      if (!pollutantName || !startYear || !endYear || categoryNames.length === 0) {
        return; // Not enough info to create a valid URL
      }

      // Find pollutant ID
      const pollutant = pollutants.find(p => p.pollutant === pollutantName);
      const pollutantId = pollutant ? pollutant.id : null;

      // Find category IDs
      const categoryIds = categoryNames.map(name => {
        const category = categories.find(entry => getCategoryDisplayTitle(entry) === name);
        return category ? category.id : null;
      }).filter(id => id !== null);

      if (!pollutantId || categoryIds.length !== categoryNames.length) {
        console.warn("Could not map all names to IDs for URL update.");
        console.warn('pollutantId:', pollutantId, 'categoryIds:', categoryIds, 'categoryNames:', categoryNames);
        return;
      }

      if (parseInt(startYear) >= parseInt(endYear)) {
        console.warn(`URL update skipped: Invalid year range (start=${startYear}, end=${endYear}).`);
        return;
      }

      // Build query parameters
      const queryParts = [
        `pollutant_id=${encodeURIComponent(pollutantId)}`,
        `category_ids=${categoryIds.join(',')}`,
        `start_year=${encodeURIComponent(startYear)}`,
        `end_year=${encodeURIComponent(endYear)}`
      ];

      const queryString = queryParts.join('&');
      const nextUrl = `${window.location.pathname}?${queryString}`;
      try {
        window.history.replaceState({}, '', nextUrl);
      } catch (historyError) {
        lineDebugWarn('Line chart history update failed', historyError);
      }
      
      // Send URL update to parent window when the line chart is the active view
      if (window.parent && window.parent !== window) {
        try {
          const parentParams = new URLSearchParams(window.parent.location.search);
          const chartParam = parentParams.get('chart');
          const pageParam = parentParams.get('page');
          const canUpdateParent = matchesLineChartParam(chartParam)
            || matchesLineChartParam(pageParam)
            || (!chartParam && !pageParam);
          
          // Only send if parent currently targets the line chart
          if (canUpdateParent) {
              window.parent.postMessage({
                type: 'updateURL',
                params: queryParts,
                chart: '2'
              }, '*');
          } else {
            return;
          }
        } catch (e) {
          // Cross-origin restriction - send anyway (standalone mode)
          window.parent.postMessage({
              type: 'updateURL',
              params: queryParts,
              chart: '2'
          }, '*');
        }
      }

    } catch (error) {
      console.error("Failed to update URL from chart state:", error);
    }
  }, 300); // Debounce for 300ms
}

function buildLineChartViewMeta({
  pollutantName,
  startYear,
  endYear,
  categoryNames = []
} = {}) {
  const pollutantRecord = (window.allPollutantsData || []).find(entry => entry.pollutant === pollutantName);
  const pollutantId = pollutantRecord ? pollutantRecord.id : null;
  const categoryRecords = window.allCategoryInfo || [];
  const categoryIds = categoryNames
    .map(name => {
      const match = categoryRecords.find(entry => getCategoryDisplayTitle(entry) === name);
      return match ? match.id : null;
    })
    .filter(id => id !== null);

  const queryParts = [];
  if (pollutantId) {
    queryParts.push(`pollutant_id=${encodeURIComponent(pollutantId)}`);
  }
  if (categoryIds.length) {
    queryParts.push(`category_ids=${categoryIds.join(',')}`);
  }
  if (startYear) {
    queryParts.push(`start_year=${encodeURIComponent(startYear)}`);
  }
  if (endYear) {
    queryParts.push(`end_year=${encodeURIComponent(endYear)}`);
  }

  const normalizedQuery = queryParts.join('&');
  const queryString = normalizedQuery ? `?${normalizedQuery}` : null;
  const shareUrl = normalizedQuery
    ? `${window.location.origin}${window.location.pathname}?${normalizedQuery}`
    : window.location.href;

  return {
    pageSlug: '/linechart',
    pollutant: pollutantName || null,
    pollutant_id: pollutantId || null,
    start_year: startYear || null,
    end_year: endYear || null,
    year_range: (startYear && endYear) ? (endYear - startYear + 1) : null,
    categories: categoryNames,
    categories_count: categoryNames.length,
    category_ids: categoryIds,
    query: queryString,
    share_url: shareUrl
  };
}

function publishLineChartViewMeta(meta) {
  if (!meta) {
    return;
  }
  window.__LINE_CHART_VIEW_META__ = meta;
  try {
    window.dispatchEvent(new CustomEvent('lineChartViewMeta', { detail: meta }));
  } catch (error) {
    // Ignore dispatch failures to avoid noisy consoles in older browsers
  }
}


async function updateChart(){
  if (!googleChartsReady || !hasGoogleCoreChartConstructors()) {
    try {
      await loadGoogleChartsLibrary();
    } catch (error) {
      console.error('Google Charts failed to load; chart render aborted.', error);
      showError('Unable to load the Google Charts library. Please refresh the page and try again.');
      return;
    }

    if (!googleChartsReady || !hasGoogleCoreChartConstructors()) {
      showError('Google Charts is unavailable. Please refresh and try again.');
      return;
    }
  }

  let stabilityHandle = null;
  const settleChartStability = () => {
    if (stabilityHandle) {
      stabilityHandle.resolve();
      stabilityHandle = null;
    }
  };

  try {
  const pollutant = document.getElementById('pollutantSelect').value;
  const startYear = +document.getElementById('startYear').value;
  const endYear = +document.getElementById('endYear').value;
  const selectedCategories = getSelectedCategories();
  if (!pollutant || !startYear || !endYear || !selectedCategories.length) return;

  const preLegendEstimate = updateChartWrapperHeight('updateChart');

  // Update the URL with the new state (debounced)
  updateUrlFromChartState();

  publishLineChartViewMeta(buildLineChartViewMeta({
    pollutantName: pollutant,
    startYear,
    endYear,
    categoryNames: selectedCategories
  }));

  // Track chart view analytics only when the selection changes
  const nextSelectionKey = JSON.stringify({
    pollutant,
    startYear,
    endYear,
    categories: selectedCategories
  });

  if (nextSelectionKey !== lastTrackedLineSelectionKey) {
    lastTrackedLineSelectionKey = nextSelectionKey;
    window.supabaseModule.trackAnalytics('linechart_drawn', {
      pollutant: pollutant,
      start_year: startYear,
      end_year: endYear,
      categories: selectedCategories,
      categories_count: selectedCategories.length,
      year_range: endYear - startYear + 1
    });
  }

  window.Colors.resetColorSystem();
  if (seriesVisibility.length !== selectedCategories.length) {
    seriesVisibility = Array(selectedCategories.length).fill(true);
    window.seriesVisibility = seriesVisibility; // Keep export.js in sync
  }

  const categoryData = window.categoryData || {};

  const layeredCategories = selectedCategories.map((category, uiIndex) => ({
    name: category,
    uiIndex,
    color: window.Colors.getColorForCategory(category)
  }));
  const drawingCategories = layeredCategories.slice().reverse();
  const drawingIndexByUi = new Map();
  drawingCategories.forEach((entry, index) => {
    drawingIndexByUi.set(entry.uiIndex, index);
  });

  // Use the global year keys to determine which years to display
  const yearsAll = window.globalYears || [];
  const yearKeys = window.globalYearKeys || [];
  const startIdx = yearsAll.indexOf(String(startYear));
  const endIdx = yearsAll.indexOf(String(endYear));
  const years = yearsAll.slice(startIdx, endIdx + 1);
  const keysForYears = yearKeys.slice(startIdx, endIdx + 1);

  // Build rows of data (year + series values). Use null for missing.
  const chartRows = years.map((yearLabel, rowIdx) => {
    const key = keysForYears[rowIdx];
    const row = [yearLabel];
    drawingCategories.forEach(({ name }) => {
      const dataRow = categoryData[pollutant]?.[name];
      const raw = key && dataRow ? dataRow[key] : null;
      const val = (raw === null || raw === undefined) ? null : parseFloat(raw);
      row.push(Number.isNaN(val) ? null : val);
    });
    return row;
  });

  if (chartRows.length === 0) return;

  stabilityHandle = beginLineChartStabilityCycle();

  // --- Determine which categories actually have data ---
  const dataPresenceByDrawingIndex = drawingCategories.map((_, seriesIndex) => (
    chartRows.some(row => typeof row[seriesIndex + 1] === 'number')
  ));
  const categoryHasData = layeredCategories.map(entry => {
    const drawingIndex = drawingIndexByUi.get(entry.uiIndex);
    return typeof drawingIndex === 'number'
      ? dataPresenceByDrawingIndex[drawingIndex]
      : false;
  });

  // Get unit before creating DataTable (needed for tooltips)
  const unit = pollutantUnits[pollutant] || "";

  // Create DataTable explicitly to guarantee column types
  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Year');           // year as string
  drawingCategories.forEach(({ name }) => {
    dataTable.addColumn('number', name);              // data column
    dataTable.addColumn({type: 'string', role: 'tooltip'}); // custom tooltip
  });
  
  // Add rows with custom tooltips for dynamic decimal precision
  chartRows.forEach(row => {
    const newRow = [row[0]]; // year
    for (let i = 1; i < row.length; i++) {
      const value = row[i];
      newRow.push(value); // actual value
      
      // Generate tooltip with dynamic precision
      if (value === null || value === undefined) {
        newRow.push(null);
      } else {
        const categoryEntry = drawingCategories[i - 1];
        const categoryName = categoryEntry ? categoryEntry.name : '';
        let formattedValue;
        
        // Use more decimals for very small values
        if (Math.abs(value) < 0.001 && value !== 0) {
          formattedValue = value.toFixed(9).replace(/\.?0+$/, ''); // Up to 9 decimals for very small values
        } else if (Math.abs(value) < 1 && value !== 0) {
          formattedValue = value.toFixed(6).replace(/\.?0+$/, ''); // Up to 6 decimals, remove trailing zeros
        } else {
          formattedValue = value.toFixed(3).replace(/\.?0+$/, ''); // 3 decimals for normal values
        }
        
        const tooltip = categoryName + '\nYear: ' + row[0] + '\nValue: ' + formattedValue + (unit ? ' ' + unit : '');
        newRow.push(tooltip);
      }
    }
    dataTable.addRow(newRow);
  });

  const seriesOptions = {};
  drawingCategories.forEach((entry, seriesIndex) => {
    const isVisible = seriesVisibility[entry.uiIndex];
    const color = entry.color;
    seriesOptions[seriesIndex] = isVisible
      ? { color, lineWidth: 3, pointSize: 4 }
      : { color, lineWidth: 0, pointSize: 0 };
  });

  // Estimate left margin dynamically based on Y-axis label width
  const maxValue = Math.max(
    ...chartRows.flatMap(r => r.slice(1).filter(v => typeof v === "number"))
  );
  
  // Determine how Google Charts will format the label based on value magnitude
  let labelString;
  if (maxValue >= 100) {
    // Large values: Google Charts shows as integers or 1 decimal
    labelString = Math.round(maxValue).toString();
  } else if (maxValue >= 1) {
    // Medium values: shows 1-2 decimals
    labelString = maxValue.toFixed(1);
  } else if (maxValue >= 0.01) {
    // Small values: shows 2-3 decimals
    labelString = maxValue.toFixed(3);
  } else if (maxValue >= 0.0001) {
    // Very small values: Google Charts typically shows 6 significant figures
    labelString = maxValue.toFixed(6);
  } else {
    // Extremely small values: use scientific notation estimate
    labelString = maxValue.toExponential(2); // e.g., "1.23e-7"
  }
  
  const labelLength = labelString.length;
  // Dynamic left margin: scale based on label length
  // For short labels (1-3 chars): 60px base
  // For longer labels: add 6px per character beyond 3 (reduced from 7px)
  const baseMargin = 60;
  const extraChars = Math.max(0, labelLength - 3);
  const leftMargin = Math.min(140, baseMargin + (extraChars * 6)); // dynamic left padding

  const chartContainer = document.getElementById('chart_div');
  if (!chartContainer) {
    console.error('chart_div element not found when attempting to draw line chart');
    settleChartStability();
    return;
  }

  // Build custom legend before measuring height so offsets match the bubble chart
  const legendDiv = document.getElementById('customLegend');
  legendDiv.innerHTML = '';

  if (seriesVisibility.length !== selectedCategories.length) {
    seriesVisibility = Array(selectedCategories.length).fill(true);
    window.seriesVisibility = seriesVisibility; // Update window reference
  }

  layeredCategories.forEach((entry, i) => {
    const item = document.createElement('span');
    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '12px';
    dot.style.height = '12px';
    dot.style.borderRadius = '50%';
    dot.style.backgroundColor = entry.color;
    item.appendChild(dot);

    const labelText = document.createTextNode(entry.name + (categoryHasData[i] ? '' : ' (No data available)'));
    item.appendChild(labelText);

    item.style.opacity = (!categoryHasData[i] || !seriesVisibility[i]) ? '0.4' : '1';
    if (!categoryHasData[i]) {
      item.title = 'No data available';
    }

    if (categoryHasData[i]) {
      item.addEventListener('click', () => {
        seriesVisibility[i] = !seriesVisibility[i];
        window.seriesVisibility = seriesVisibility; // Update window reference
        updateChart();
      });
    }

    legendDiv.appendChild(item);
  });
  const yearLabel = startYear === endYear ? String(startYear) : `${startYear} - ${endYear}`;
  const pollutantTitle = unit ? `${pollutant} - ${unit}` : pollutant;
  updateLineChartTitle(yearLabel, pollutantTitle);
  const chartTitleEl = document.getElementById('chartTitle');
  await waitForChromeStability([legendDiv, chartTitleEl]);
  const titleHeight = chartTitleEl ? Math.round(chartTitleEl.getBoundingClientRect().height || 0) : 0;
  const chartRect = chartContainer.getBoundingClientRect();
  const wrapperElement = chartContainer.closest('.chart-wrapper');
  const wrapperRect = wrapperElement ? wrapperElement.getBoundingClientRect() : null;
  const wrapperStyles = wrapperElement ? window.getComputedStyle(wrapperElement) : null;
  const paddingBottom = wrapperStyles ? (parseFloat(wrapperStyles.paddingBottom) || 0) : 0;
  const chartTopOffset = wrapperRect ? Math.max(0, chartRect.top - wrapperRect.top) : 0;
  const legendHeight = legendDiv ? Math.round(legendDiv.getBoundingClientRect().height || 0) : 0;
  const cachedHeight = Number.isFinite(preLegendEstimate) && preLegendEstimate > 0
    ? preLegendEstimate
    : (lineLayoutHeightManager?.getLastEstimatedHeight?.() ?? window.__NAEI_LAST_CHART_HEIGHT);

  let requestedChartHeight = Math.round(
    Number.isFinite(cachedHeight) && cachedHeight > 0
      ? cachedHeight
      : (chartRect.height || LINE_MIN_CHART_CANVAS_HEIGHT)
  );

  if (!Number.isFinite(requestedChartHeight) || requestedChartHeight <= 0) {
    requestedChartHeight = LINE_MIN_CHART_CANVAS_HEIGHT;
  }

  let availableHeight = wrapperRect
    ? Math.max(0, wrapperRect.height - chartTopOffset - paddingBottom)
    : null;

  if (Number.isFinite(availableHeight) && availableHeight > 0) {
    requestedChartHeight = Math.min(requestedChartHeight, availableHeight);
  }

  const appliedChartHeight = Math.max(
    LINE_MIN_CHART_CANVAS_HEIGHT,
    Math.round(requestedChartHeight)
  );

  chartContainer.style.height = `${appliedChartHeight}px`;
  chartContainer.style.minHeight = `${appliedChartHeight}px`;
  chartContainer.style.maxHeight = `${appliedChartHeight}px`;

  const wrapperAdjustment = window.__lineLayoutHeightManager?.ensureWrapperCapacity
    ? window.__lineLayoutHeightManager.ensureWrapperCapacity({
        wrapperElement: wrapperElement || chartContainer.closest('.chart-wrapper'),
        chartHeight: appliedChartHeight,
        chromeBeforeChart: chartTopOffset,
        chromeAfterChart: paddingBottom
      })
    : {
        expanded: false,
        requiredHeight: null,
        finalHeight: wrapperRect ? Math.round(wrapperRect.height) : null
      };
  const effectiveWrapperHeight = wrapperAdjustment.finalHeight
    || (wrapperRect ? Math.round(wrapperRect.height) : null);

  if (Number.isFinite(effectiveWrapperHeight)) {
    availableHeight = Math.max(0, effectiveWrapperHeight - chartTopOffset - paddingBottom);
  }

  const yAxisTitle = pollutantTitle;

  const options = {
    title: '',
    width: '100%',
    legend: 'none',
    chartArea: {
      top: 10,
      left: leftMargin,
      right: 20,
      bottom: 60
    },
    hAxis: {
      title: 'Year',
      textStyle: { color: 'transparent' }, // Hide Google Charts labels
      titleTextStyle: {
        fontSize: window.innerWidth < 768 && window.innerHeight < window.innerWidth ? 14 : 16,
        bold: false,
        italic: false
      },
      gridlines: { color: '#e0e0e0' },
      baselineColor: '#666'
    },
    vAxis: {
      title: yAxisTitle,
      viewWindow: { 
        min: 0 
      },
      textStyle: { 
        fontSize: 14 
      },
      titleTextStyle: {
        fontSize: window.innerWidth < 768 && window.innerHeight < window.innerWidth ? 14 : 16,
        bold: false,
        italic: false,
        wrap: false
      },
      textPosition: 'out', // Ensure title is positioned outside to avoid overlap
    },
    series: seriesOptions,
    curveType: smoothLines ? 'function' : 'none',
    lineWidth: 3,
    pointSize: 4
  };
  

  // draw chart and show pollutant as visible page title
  chart = new google.visualization.LineChart(chartContainer);

  // Add a 'ready' event listener that will fire after every draw (v2.3 style)
  // Remove any existing listeners first to prevent duplicates
  google.visualization.events.removeAllListeners(chart);
  google.visualization.events.addListener(chart, 'ready', addCustomXAxisLabels);

  // Compute safe width/height to avoid negative SVG dimensions
  const safeWidth = Math.max(chartContainer.offsetWidth || 0, 200);
  const safeHeight = Math.max(appliedChartHeight, LINE_MIN_CHART_CANVAS_HEIGHT);
  options.width = safeWidth;
  options.height = safeHeight;
  window.__NAEI_LAST_CHART_HEIGHT = safeHeight;

  // On mobile, show only first and last year for clarity
  const isMobile = window.innerWidth < 600;
  if (isMobile) {
    options.hAxis.slantedText = true;
    options.chartArea.width = '70%';
  }

  // Delay slightly to let layout stabilize (prevents negative sizes and bouncing)
  setTimeout(() => {
    try {
      chart.draw(dataTable, options);
      // Only add visible class when parent is already visible to prevent flash
      if (document.getElementById('mainContent').classList.contains('loaded')) {
        chartContainer.classList.add('visible');
        const wrapperEl = chartContainer.closest('.chart-wrapper');
        if (wrapperEl) {
          wrapperEl.classList.add('visible');
        }
      }

      const scheduleHeightPost = () => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            sendContentHeightToParent();
            settleChartStability();
          }, 100);
        });
      };

      // After chart finishes drawing, update height if we're in a resize
      if (window._pendingHeightUpdate) {
        window._pendingHeightUpdate = false;
        scheduleHeightPost();
      } else {
        // Always send height after drawing (for filter changes that may affect button container layout)
        scheduleHeightPost();
      }
    } catch (error) {
      console.error('Google Charts draw failed:', error);
      showError('Unable to render the chart right now. Please try again.');
      settleChartStability();
    }
  }, 100);

  updateChartWrapperHeight('post-legend');


  // ensure controls reflect available choices
          refreshCategoryDropdowns();
  refreshButtons();
  } catch (error) {
    console.error('Unable to update line chart:', error);
    showError('Unable to render the chart right now. Please try again.');
    settleChartStability();
  }
}

// Track last window dimensions to detect real user resizes vs parent iframe height adjustments
let lastWindowWidth = window.innerWidth;
let lastWindowHeight = window.innerHeight;
const RESIZE_THRESHOLD = 3;
let pendingHeightPokeTimer = null;
let parentViewportRedrawTimer = null;

// Resize handler - only update height when WIDTH changes (real user resize)
window.addEventListener('resize', () => {
  clearTimeout(window._resizeTimer);
  window._resizeTimer = setTimeout(() => {
    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;
    const widthDelta = Math.abs((currentWidth || 0) - (lastWindowWidth || 0));
    const heightDelta = Math.abs((currentHeight || 0) - (lastWindowHeight || 0));

    if (widthDelta < RESIZE_THRESHOLD && heightDelta < RESIZE_THRESHOLD) {
      logLineViewportHeight('window-resize');
      updateChartWrapperHeight('window-resize');
      if (!pendingHeightPokeTimer) {
        pendingHeightPokeTimer = setTimeout(() => {
          pendingHeightPokeTimer = null;
          sendContentHeightToParent(true);
        }, 200);
      }
      return;
    }

    lastWindowWidth = currentWidth;
    lastWindowHeight = currentHeight;
    syncLineChartHeight('window-resize', { redraw: true });
    // Height will be sent after chart finishes drawing (see updateChart's setTimeout callback)
  }, 200);
});

async function renderInitialView() {
  return new Promise(resolve => {
    const params = parseUrlParameters();
    const defaultSelections = getLineDefaultSelections();
    const pollutantSelect = document.getElementById('pollutantSelect');
    
    // Use a small timeout to allow the DOM to update with the options from setupSelectors
    setTimeout(() => {
      if (params.pollutantName) {
        pollutantSelect.value = params.pollutantName;
      } else {
        const fallbackPollutant = defaultSelections.pollutant;
        if ([...pollutantSelect.options].some(o => o.value === fallbackPollutant)) {
          pollutantSelect.value = fallbackPollutant;
        }
      }

      // Clear existing category selectors and add new ones based on URL
      const categoryContainer = document.getElementById('categoryContainer');
      if (!categoryContainer) {
        console.error('categoryContainer element missing during renderInitialView');
        resolve();
        return;
      }
      categoryContainer.innerHTML = ''; // Clear any default selectors

      const resolvedCategories = (params.categoryNames && params.categoryNames.length > 0)
        ? params.categoryNames
        : (defaultSelections.categories?.length ? defaultSelections.categories : DEFAULT_LINE_SELECTIONS.categories);
      const uniqueCategories = [...new Set(resolvedCategories.filter(Boolean))];
      (uniqueCategories.length ? uniqueCategories : DEFAULT_LINE_SELECTIONS.categories)
        .forEach(name => addCategorySelector(name, false));

      const startYearSelect = document.getElementById('startYear');
      const endYearSelect = document.getElementById('endYear');
      
      // Set year values from URL params (already validated in parseUrlParameters)
      const fallbackStartYear = params.startYear || defaultSelections.startYear;
      const fallbackEndYear = params.endYear || defaultSelections.endYear;
      if (fallbackStartYear && startYearSelect.querySelector('option[value="' + fallbackStartYear + '"]')) {
        startYearSelect.value = fallbackStartYear;
      }
      if (fallbackEndYear && endYearSelect.querySelector('option[value="' + fallbackEndYear + '"]')) {
        endYearSelect.value = fallbackEndYear;
      }
      
      updateYearDropdowns();
      
      // Don't call updateChart here; revealMainContent will do it.
      resolve();
    }, 50);
  });
}

async function revealMainContent() {
  return new Promise(resolve => {
    const mainContent = document.getElementById('mainContent');
    
    // Make content visible immediately (we're in iframe, parent handles loading)
    mainContent.style.display = 'block';
    mainContent.removeAttribute('aria-hidden');
    mainContent.classList.add('loaded'); // Add loaded class immediately
    updateChartWrapperHeight('revealMainContent-visible');
    freezeSmoothingToggleWidth();
    freezeWidthForOpera('#downloadBtn', {
      extraPadding: 0,
      attempts: 6,
      attemptDelay: 160
    });
    freezeWidthForOpera(['#startYear', '#endYear'], {
      fixedWidth: 100,
      attempts: 6,
      attemptDelay: 160
    });
    
    // Since iframe has fixed height, we can render immediately
    // Now render the chart at the correct size
    (function gateFirstRender(){
          let tries = 0;
          const maxTries = 30; // ~3s
          function tick(){
            if (selectionsReady()) {
              requestAnimationFrame(() => {
                syncLineChartHeight('initial-draw', { redraw: true });
                afterDraw();
              });
            } else if (++tries < maxTries) {
              setTimeout(tick, 100);
            } else {
              console.warn('Selections not ready after waiting — drawing anyway');
              requestAnimationFrame(() => {
                syncLineChartHeight('initial-draw-timeout', { redraw: true });
                afterDraw();
              });
            }
          }
          function afterDraw(){
            waitForLineChartStability().then(() => {
              setTimeout(() => {
                const chartDiv = document.getElementById('chart_div');
                if (chartDiv) {
                  chartDiv.classList.add('visible');
                  const wrapperEl = chartDiv.closest('.chart-wrapper');
                  if (wrapperEl) {
                    wrapperEl.classList.add('visible');
                  }
                  updateChartWrapperHeight('chart-visible');
                }

                const loadingOverlay = document.getElementById('loadingOverlay');
                if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
                  loadingOverlay.classList.add('hidden');
                  setTimeout(() => {
                    loadingOverlay.style.display = 'none';
                  }, 350);
                }

                setTimeout(() => {
                  updateUrlFromChartState();
                  notifyChartReady();
                  resolve();
                }, 16);
              }, 16);
            }).catch(error => {
              console.error('Line chart stability wait failed:', error);
              resolve();
            });
          }
          tick();
        })();
  });
}



/* ---------------- URL Parameters and Initialization ---------------- */
function parseUrlParameters() {
  // Try to get params from parent window if in iframe, otherwise use own window
  let searchParams;
  try {
    if (window.parent && window.parent !== window && window.parent.location.search) {
      searchParams = window.parent.location.search;
    } else {
      searchParams = window.location.search;
    }
  } catch (e) {
    // Cross-origin restriction, use own window
    searchParams = window.location.search;
  }
  
  const params = new URLSearchParams(searchParams);
  
  // Only honor URL overrides when the parent explicitly targets the line chart
  const chartParam = params.get('chart');
  const pageParam = params.get('page');
  const embedded = isLineChartEmbedded();
  const chartTargetsLine = matchesLineChartParam(chartParam);
  const pageTargetsLine = matchesLineChartParam(pageParam);
  const allowOverrides = !embedded || chartTargetsLine || pageTargetsLine;
  if (!allowOverrides) {
    return {
      pollutantName: null,
      categoryNames: [],
      startYear: null,
      endYear: null
    };
  }
  
  const pollutantId = params.get('pollutant_id');
  const categoryIdParam = params.get('category_ids')
    || params.get('categoryIds')
    || params.get('category_id');
  const categoryIds = categoryIdParam
    ? categoryIdParam.split(',').map(Number).filter(Boolean)
    : [];
  const startYearParam = params.get('start_year');
  const endYearParam = params.get('end_year');

  const pollutants = window.allPollutantsData || window.allPollutants || [];
  const categories = window.allCategoryInfo || window.allCategories || [];
  const availableYears = window.globalYears || [];

  let pollutantName = null;
  if (pollutantId) {
    const pollutant = pollutants.find(p => String(p.id) === String(pollutantId));
    if (pollutant) {
      pollutantName = pollutant.pollutant;
    }
  }

  let categoryNames = [];
  if (categoryIds && categoryIds.length > 0) {
    categoryNames = categoryIds.map(id => {
      const category = categories.find(entry => String(entry.id) === String(id));
      return category ? getCategoryDisplayTitle(category) : null;
    }).filter(Boolean);
  }

  // Validate years against available years
  let startYear = null;
  let endYear = null;

  if (availableYears.length > 0) {
    // Check if provided years are valid
    const isStartYearValid = startYearParam && availableYears.includes(startYearParam);
    const isEndYearValid = endYearParam && availableYears.includes(endYearParam);
    
    if (isStartYearValid && isEndYearValid) {
      // Both years valid - check if start < end
      const startIdx = availableYears.indexOf(startYearParam);
      const endIdx = availableYears.indexOf(endYearParam);
      
      if (startIdx < endIdx) {
        // Valid range
        startYear = startYearParam;
        endYear = endYearParam;
      } else {
        // Invalid range - use defaults
        console.warn('Invalid year range in URL: start=' + startYearParam + ', end=' + endYearParam + '. Using defaults.');
        startYear = availableYears[0];
        endYear = availableYears[availableYears.length - 1];
      }
    } else if (isStartYearValid) {
      // Only start year valid
      startYear = startYearParam;
      // Find a valid end year after the start
      const startIdx = availableYears.indexOf(startYearParam);
      endYear = availableYears[availableYears.length - 1];
      console.warn('Invalid end year in URL: ' + endYearParam + '. Using ' + endYear + '.');
    } else if (isEndYearValid) {
      // Only end year valid
      endYear = endYearParam;
      // Find a valid start year before the end
      startYear = availableYears[0];
      console.warn('Invalid start year in URL: ' + startYearParam + '. Using ' + startYear + '.');
    } else if (startYearParam || endYearParam) {
      // Years provided but both invalid
      console.warn('Invalid years in URL: start=' + startYearParam + ', end=' + endYearParam + '. Using defaults.');
      startYear = availableYears[0];
      endYear = availableYears[availableYears.length - 1];
    }
    // If no years provided, leave as null to use dropdown defaults
  }

  return {
    pollutantName,
    categoryNames,
    startYear,
    endYear
  };
}

/**
 * Setup event listeners for interactive controls
 */
function setupEventListeners() {
  // Smoothing toggle button
  const toggleSmoothBtn = document.getElementById('toggleSmoothBtn');
  if (toggleSmoothBtn) {
    updateSmoothingToggleLabel(toggleSmoothBtn, smoothLines);
    toggleSmoothBtn.addEventListener('click', () => {
      smoothLines = !smoothLines;
      window.smoothLines = smoothLines; // Keep window.smoothLines in sync
      updateSmoothingToggleLabel(toggleSmoothBtn, smoothLines);
      updateChart();
    });
  }

  // CSV download button
  const downloadCSVBtn = document.getElementById('downloadCSVBtn');
  if (downloadCSVBtn) {
    downloadCSVBtn.addEventListener('click', () => exportData('csv'));
  }

  // Excel download button
  const downloadXLSXBtn = document.getElementById('downloadXLSXBtn');
  if (downloadXLSXBtn) {
    downloadXLSXBtn.addEventListener('click', () => exportData('xlsx'));
  }

  if (lineLayoutHeightManager) {
    lineLayoutHeightManager.observeWrapper(() => {
      window._pendingHeightUpdate = true;
      updateChart();
      setTimeout(() => sendContentHeightToParent(true), 150);
    });
  }
}

/**
 * Main initialization function.
 * This is the entry point for the application.
 */
async function init() {
  try {
    updateChartWrapperHeight('init');
    logLineViewportHeight('init');
    // Wait for supabaseModule to be available (with timeout)
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds total
    while ((!window.supabaseModule || !window.supabaseModule.loadData) && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (!window.supabaseModule || !window.supabaseModule.loadData) {
      throw new Error('supabaseModule not available after waiting. Check console for loading errors.');
    }
    
    
    // First, load all necessary data from Supabase
    const {
      pollutants,
      categories,
      groups,
      yearKeys,
      pollutantUnits,
      categoryData
    } = await window.supabaseModule.loadData();
    const resolvedCategories = Array.isArray(categories) ? categories : (Array.isArray(groups) ? groups : []);
    const resolvedCategoryData = categoryData || {};

    // Store data on the window object for global access
    window.allPollutants = pollutants;
    window.allCategories = resolvedCategories;
    window.allCategoryInfo = resolvedCategories;
    window.globalYearKeys = yearKeys;
    window.globalYears = yearKeys.map(key => key.substring(1));
    window.pollutantUnits = pollutantUnits;
    window.categoryData = resolvedCategoryData;
    
    // Then, set up the UI selectors with the loaded data
    setupSelectors(pollutants, resolvedCategories);

    // Group info content now lives in the dedicated tab; no need to load it inside the chart iframe.

    // Set up event listeners for buttons
    setupEventListeners();
    setupShareButton();

    // Then, render the initial view based on URL parameters or defaults
    await renderInitialView();

    // Finally, reveal the main content and draw the chart
  await revealMainContent();
    
    // Chart ready signal is now sent from revealMainContent after loading overlay fades

  } catch (error) {
    console.error("Initialization failed:", error);
    // Use the new non-blocking error notification
    showError('Error loading line chart: ' + error.message + '. Please check the console and refresh the page.');
    notifyParentOfInitFailure(error);
  }
}

function notifyParentOfInitFailure(error) {
  if (initFailureNotified) {
    return;
  }
  initFailureNotified = true;

  try {
    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
      mainContent.style.display = 'block';
      mainContent.removeAttribute('aria-hidden');
      mainContent.classList.add('loaded');
    }

    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
      }, 350);
    }
  } catch (layoutError) {
    console.error('Failed to reveal main content during failure handling:', layoutError);
  }

  try {
    if (window.parent && window.parent !== window) {
      const message = (error && error.message) ? error.message : 'Unknown initialization error';
  console.warn('Notifying parent about initialization failure');
      window.parent.postMessage({
        type: 'chartReady',
        chart: 'line',
        status: 'error',
        message
      }, '*');
    }
  } catch (postError) {
    console.error('Failed to notify parent of initialization failure:', postError);
  }

  setTimeout(() => {
    try {
      sendContentHeightToParent();
    } catch (heightError) {
      console.error('Failed to send fallback content height to parent:', heightError);
    }
  }, 150);
}

// Add the chart ready message when the chart is fully loaded
function notifyChartReady() {
  if (chartReadyNotified) {
    sendContentHeightToParent();
    return;
  }

  chartReadyNotified = true;

  try {
    setTimeout(() => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'chartReady',
            chart: 'line',
            timestamp: new Date().toISOString()
          }, '*');
        }
      } catch (postError) {
        console.error('Failed to post line chartReady message:', postError);
      }

      setTimeout(() => {
        try {
          sendContentHeightToParent(true);
        } catch (heightError) {
          console.error('Unable to send initial line chart height:', heightError);
        }
      }, 50);

      if (chart && typeof chart.setOptions === 'function') {
        chart.setOptions({
          animation: {
            duration: 1000,
            easing: 'out',
            startup: false
          }
        });
      }
    }, 16);
  } catch (error) {
    console.error('Error in notifyChartReady:', error);
  }
}

// Call this after chart is fully loaded
if (window.google && window.google.visualization && chart) {
  google.visualization.events.addListener(chart, 'ready', function() {
    // Notify parent that chart is ready
    notifyChartReady();
  });
}

// Listen for parent window messages
window.addEventListener('message', (event) => {
  // Message handling can be added here for future features
  // Charts now handle their own loading completion
});

// Initialise on DOM ready
document.addEventListener('DOMContentLoaded', init);