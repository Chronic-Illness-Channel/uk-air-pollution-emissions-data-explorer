/**
 * Main Application Module
 * Handles UI initialization, user interactions, and coordination between modules
 */

const isOperaBrowser = (() => {
  try {
    const ua = navigator.userAgent || '';
    return ua.includes('OPR/') || ua.includes('Opera');
  } catch (error) {
    // Unable to detect Opera browser; returning false
    return false;
  }
})();

function applyOperaFixedWidth(el, widthPx) {
  if (!el || !widthPx) {
    return;
  }
  el.classList.add('opera-wide-select');
  const widthValue = `${Math.round(widthPx)}px`;
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
        // Clear prior width locks so we re-measure the natural content width each pass
        el.style.width = '';
        el.style.minWidth = '';
        el.style.maxWidth = '';
        const rectWidth = Math.ceil(el.getBoundingClientRect().width || 0);
        const scrollWidth = Math.ceil((el.scrollWidth || 0));
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

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const MOBILE_UA_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i;

function detectMobileExperience() {
  try {
    if (typeof window.__NAEI_IS_MOBILE_DEVICE__ === 'boolean') {
      return window.__NAEI_IS_MOBILE_DEVICE__;
    }
  } catch (error) {
    /* noop */
  }

  try {
    if (window.parent && window.parent !== window) {
      const parentFlag = window.parent.__NAEI_IS_MOBILE_DEVICE__;
      if (typeof parentFlag === 'boolean') {
        return parentFlag;
      }
    }
  } catch (error) {
    // Cross-origin access may fail when embedded elsewhere; rely on local detection
  }

  try {
    const pointerCoarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    const maxTouchPoints = navigator.maxTouchPoints || 0;
    const ua = navigator.userAgent || '';
    if (MOBILE_UA_PATTERN.test(ua)) {
      return true;
    }
    const narrowEdge = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 900;
    if ((pointerCoarse || maxTouchPoints > 1) && narrowEdge) {
      return true;
    }
  } catch (error) {
    /* noop */
  }
  return false;
}

const IS_MOBILE_EXPERIENCE = detectMobileExperience();
window.__NAEI_DISABLE_BUBBLE_TUTORIAL__ = IS_MOBILE_EXPERIENCE;

const HAS_OWN = Object.prototype.hasOwnProperty;
// Comparison chrome debug noise temporarily disabled; re-enable by restoring prior block when needed.
// const DEFAULT_COMPARISON_DEBUG = true;
// const COMPARISON_DEBUG_PREFIX = '[comparison-debug]';
// function isComparisonDebugEnabled() { ... }
// function comparisonDebugLog(message, payload) { ... }
function comparisonDebugLog() {}

const DEFAULT_CATEGORY_DEBUG = false;
const CATEGORY_DEBUG_PREFIX = '[bubble-defaults]';

function isBubbleDefaultDebugEnabled() {
  if (typeof window !== 'undefined'
    && window
    && HAS_OWN.call(window, '__NAEI_BUBBLE_DEFAULT_DEBUG__')) {
    return Boolean(window.__NAEI_BUBBLE_DEFAULT_DEBUG__);
  }
  return DEFAULT_CATEGORY_DEBUG;
}

function bubbleDefaultDebug(message, payload) {
  if (!isBubbleDefaultDebugEnabled()) {
    return;
  }
  try {
    if (typeof payload !== 'undefined') {
      console.log(CATEGORY_DEBUG_PREFIX, message, payload);
    } else {
      console.log(CATEGORY_DEBUG_PREFIX, message);
    }
  } catch (error) {
    // If logging fails we intentionally stay quiet to avoid cascading errors
  }
}
let lastTrackedBubbleSelectionKey = null; // Prevent duplicate analytics events for unchanged selections
let comparisonStatementVisible = false; // Track whether comparison cards are currently rendered
let pendingComparisonChromeRefresh = null; // Debounce chart redraws triggered by comparison layout changes
let pendingComparisonRedraw = null; // Collapse rapid comparison checkbox toggles into a single redraw
let pendingComparisonChromeHeight = false; // Indicates comparison chrome visibility changed and needs height sync
window.__bubblePendingComparisonChromeHeight = pendingComparisonChromeHeight;
function setPendingComparisonChromeHeight(nextValue) {
  pendingComparisonChromeHeight = Boolean(nextValue);
  window.__bubblePendingComparisonChromeHeight = pendingComparisonChromeHeight;
  return pendingComparisonChromeHeight;
}
const comparisonExportStore = {
  visible: false,
  cards: null,
  warning: null,
  metrics: null,
  calcBlocks: null,
  inclusionNote: null,
  shouldReplaceEnergyCalc: false
};
window.__bubbleComparisonExport = comparisonExportStore;

function setComparisonExportStore(payload) {
  if (!payload) {
    clearComparisonExportStore();
    return;
  }
  comparisonExportStore.cards = payload.cards || null;
  comparisonExportStore.warning = payload.warning || null;
  comparisonExportStore.metrics = payload.metrics || null;
  comparisonExportStore.calcBlocks = payload.calcBlocks || null;
  comparisonExportStore.inclusionNote = payload.inclusionNote || null;
  comparisonExportStore.shouldReplaceEnergyCalc = Boolean(payload.shouldReplaceEnergyCalc);
  comparisonExportStore.visible = Boolean(payload.cards);
}

function clearComparisonExportStore() {
  comparisonExportStore.cards = null;
  comparisonExportStore.warning = null;
  comparisonExportStore.metrics = null;
  comparisonExportStore.calcBlocks = null;
  comparisonExportStore.inclusionNote = null;
  comparisonExportStore.shouldReplaceEnergyCalc = false;
  comparisonExportStore.visible = false;
}
let comparisonMeasurementDiv = null;
let lastMeasuredComparisonChromeHeight = 0;
window.__bubbleComparisonChromeHeight = 0;
let suppressWrapperObserverUntil = 0; // Timestamp (ms) until which wrapper resize observer callbacks are ignored
const WRAPPER_OBSERVER_SUPPRESS_MS = 450;
const MIN_CHART_WRAPPER_HEIGHT = 480;
const MIN_CHART_CANVAS_HEIGHT = 420;
const CHART_HEADER_BUFFER = 10; // spacing between title/legend and chart
const FOOTER_GAP = 6; // breathing room between chart bottom and footer
const MIN_HEIGHT_DELTA = 8; // px difference required before re-sending height
const DEFAULT_PARENT_FOOTER = 140;
const DEFAULT_PARENT_VIEWPORT = 900;
const CSS_DEFAULT_FOOTER_RESERVE = 160; // Mirrors --bubble-footer-height default in styles.css
const CSS_VISUAL_PADDING = 27; // Extra breathing room so chart clears the footer visually
const RESIZE_THRESHOLD = 3;
const INLINE_TUTORIAL_BREAKPOINT = 820;
const TUTORIAL_SLIDE_MATRIX = [
  ['002', '003', '004', '005'],
  ['002', '003', '004', '007'],
  ['002', '003', '004', '009'],
  ['002', '003', '004', '011', '012'],
  ['002', '003', '004', '011', '014'],
  ['002', '003', '016'],
  ['002', '017'],
  ['002', '018'],
  ['002', '019'],
  ['002', '020']
];
const IS_EMBEDDED = window.parent && window.parent !== window;

const layoutHeightManager = window.LayoutHeightManager?.create({
  namespace: 'bubble',
  wrapperSelector: '.chart-wrapper',
  chartSelector: '#chart_div',
  minChartHeight: MIN_CHART_CANVAS_HEIGHT,
  footerGap: FOOTER_GAP,
  visualPadding: CSS_VISUAL_PADDING,
  minHeightDelta: MIN_HEIGHT_DELTA,
  heightDebounce: 250
});

// Keep the latest comparison chrome measurement synced so other modules (renderer/layout manager)
// can reserve the correct amount of space before DOM updates land.
function persistComparisonChromeHeight(value) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) && numeric > 0
    ? Math.round(numeric)
    : 0;
  lastMeasuredComparisonChromeHeight = safeValue;
  window.__bubbleComparisonChromeHeight = safeValue;
  return safeValue;
}

function suppressWrapperHeightObserver(durationMs = WRAPPER_OBSERVER_SUPPRESS_MS) {
  const duration = Math.max(0, Number(durationMs) || 0);
  if (duration <= 0) {
    suppressWrapperObserverUntil = 0;
    return;
  }
  suppressWrapperObserverUntil = Date.now() + duration;
    comparisonDebugLog('suppressWrapperHeightObserver', {
      durationMs: duration,
      resumeInMs: suppressWrapperObserverUntil - Date.now()
    });
}

function shouldIgnoreWrapperObserverTick() {
    if (!suppressWrapperObserverUntil) {
      return false;
    }
    const now = Date.now();
    if (now < suppressWrapperObserverUntil) {
      comparisonDebugLog('wrapper observer tick ignored', {
        remainingMs: suppressWrapperObserverUntil - now,
        pendingComparisonChromeHeight
      });
      return true;
    }
    return false;
}

if (layoutHeightManager) {
  window.__bubbleLayoutHeightManager = layoutHeightManager;

  const parentChangeDelay = layoutHeightManager.settings?.parentChangeDebounce || 200;
  layoutHeightManager.onParentViewportChange?.((payload = {}) => {
    const { viewportHeight, footerHeight, delta } = payload;
    comparisonDebugLog('parent viewport change event', {
      viewportHeight,
      footerHeight,
      delta,
      pendingComparisonChromeHeight,
      comparisonStatementVisible
    });
    lastKnownViewportHeight = viewportHeight || lastKnownViewportHeight;
    updateChartWrapperHeight('parent-viewport');
    drawChart(true);
    setTimeout(() => sendContentHeightToParent(true), parentChangeDelay);
  });
}

const tutorialOverlayApi = {
  open: null,
  hide: null,
  isActive: () => false
};
let pendingTutorialOpenReason = null;

let lastSentHeight = 0;
let lastKnownViewportWidth = 0;
let lastKnownViewportHeight = window.innerHeight || 0;
let pendingHeightPokeTimer = null;
let parentViewportRedrawTimer = null;
let parentFooterHeight = DEFAULT_PARENT_FOOTER;
let parentViewportHeight = DEFAULT_PARENT_VIEWPORT;
let chartReadyNotified = false;
let chartRenderingUnlocked = false;
let pendingDrawRequest = null;

function applyCssFooterReserve(pixels) {
  if (layoutHeightManager) {
    return layoutHeightManager.applyFooterReserve(pixels);
  }
  try {
    const safePixels = Math.max(FOOTER_GAP, Math.round(Number(pixels) || 0));
    const padded = safePixels + CSS_VISUAL_PADDING;
    document.documentElement?.style?.setProperty('--bubble-footer-height', `${padded}px`);
  } catch (error) {
  }
}

applyCssFooterReserve(CSS_DEFAULT_FOOTER_RESERVE);

function applyCssViewportHeight(value) {
  if (layoutHeightManager) {
    return layoutHeightManager.applyViewportHeight(value);
  }
  try {
    if (typeof value === 'string') {
      document.documentElement?.style?.setProperty('--bubble-viewport-height', value);
      return;
    }
    const pixels = Math.round(Number(value) || 0);
    if (pixels > 0) {
      document.documentElement?.style?.setProperty('--bubble-viewport-height', `${pixels}px`);
    }
  } catch (error) {
  }
}

applyCssViewportHeight('100vh');
if (IS_EMBEDDED) {
  applyCssViewportHeight(`${parentViewportHeight}px`);
}

function getElementHeight(el) {
  if (!el) {
    return 0;
  }
  const rect = el.getBoundingClientRect();
  return Math.round(rect.height || 0);
}

function getElementTop(el) {
  if (!el) {
    return 0;
  }
  const rect = el.getBoundingClientRect();
  const scrollOffset = window.scrollY || window.pageYOffset || 0;
  return Math.max(0, Math.round((rect.top || 0) + scrollOffset));
}

function getElementBottom(el) {
  if (!el) {
    return 0;
  }
  const rect = el.getBoundingClientRect();
  const scrollOffset = window.scrollY || window.pageYOffset || 0;
  return Math.max(0, Math.round((rect.bottom || 0) + scrollOffset));
}

function getStandaloneFooterHeight() {
  const footer = document.querySelector('footer');
  if (!footer) {
    return DEFAULT_PARENT_FOOTER;
  }

  const rect = footer.getBoundingClientRect();
  const styles = window.getComputedStyle(footer);
  const margins = (parseFloat(styles.marginTop) || 0) + (parseFloat(styles.marginBottom) || 0);
  return Math.round((rect.height || 0) + margins);
}

window.addEventListener('message', (event) => {
  if (!event?.data) {
    return;
  }

  if (event.data.type === 'parentViewportMetrics') {
    if (layoutHeightManager) {
      const metrics = layoutHeightManager.handleParentMetrics(event.data) || {};
      if (Number.isFinite(metrics.footerHeight)) {
        parentFooterHeight = Math.max(metrics.footerHeight, FOOTER_GAP);
      }
      if (Number.isFinite(metrics.viewportHeight)) {
        parentViewportHeight = metrics.viewportHeight;
      }
    } else {
      const previousFooter = parentFooterHeight;
      const previousViewport = parentViewportHeight;
      const footerCandidate = Number(event.data.footerHeight);
      const viewportCandidate = Number(event.data.viewportHeight);

      if (Number.isFinite(footerCandidate) && footerCandidate >= 0) {
        parentFooterHeight = Math.max(footerCandidate, FOOTER_GAP);
        applyCssFooterReserve(parentFooterHeight + FOOTER_GAP);
      }

      if (Number.isFinite(viewportCandidate) && viewportCandidate > 0) {
        parentViewportHeight = viewportCandidate;
        applyCssViewportHeight(`${parentViewportHeight}px`);
      }

      const footerDelta = Math.abs((parentFooterHeight || 0) - (previousFooter || 0));
      const viewportDelta = Math.abs((parentViewportHeight || 0) - (previousViewport || 0));
      if (Math.max(footerDelta, viewportDelta) >= RESIZE_THRESHOLD) {
        if (parentViewportRedrawTimer) {
          clearTimeout(parentViewportRedrawTimer);
        }
        parentViewportRedrawTimer = setTimeout(() => {
          parentViewportRedrawTimer = null;
          lastKnownViewportHeight = parentViewportHeight;
          drawChart(true);
          setTimeout(() => sendContentHeightToParent(true), 200);
        }, 200);
      }
    }

    updateChartWrapperHeight('parent-viewport');
  }

  if (event.data.type === 'openBubbleTutorial') {
    if (window.__NAEI_DISABLE_BUBBLE_TUTORIAL__) {
      return;
    }
    const reason = event.data.reason || 'parent';
    const skipScroll = reason !== 'user';
    if (typeof tutorialOverlayApi.open === 'function') {
      const isActive = typeof tutorialOverlayApi.isActive === 'function' && tutorialOverlayApi.isActive();
      if (!isActive) {
        tutorialOverlayApi.open(reason, { skipScroll });
      }
    } else {
      pendingTutorialOpenReason = reason;
    }
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

function setupParentNavigationForwarding(sourceLabel = 'bubble') {
  if (!IS_EMBEDDED || !window.parent) {
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
      // Parent may block navigation requests; ignore failures silently
    }
  };

  document.addEventListener('keydown', forwardDirectionalKeys);
}

setupParentNavigationForwarding('bubble');

function ensureComparisonMeasurementDiv() {
  if (comparisonMeasurementDiv && document.body.contains(comparisonMeasurementDiv)) {
    return comparisonMeasurementDiv;
  }
  const measurementDiv = document.createElement('div');
  measurementDiv.id = 'comparisonMeasurementDiv';
  measurementDiv.className = 'comparison-statement comparison-statement--measurement';
  measurementDiv.style.position = 'absolute';
  measurementDiv.style.visibility = 'hidden';
  measurementDiv.style.pointerEvents = 'none';
  measurementDiv.style.left = '-9999px';
  measurementDiv.style.top = '-9999px';
  measurementDiv.style.width = 'auto';
  document.body.appendChild(measurementDiv);
  comparisonMeasurementDiv = measurementDiv;
  return comparisonMeasurementDiv;
}

function getComparisonMeasurementWidth() {
  const container = document.getElementById('comparisonContainer')
    || document.querySelector('.chart-wrapper');
  if (!container) {
    return null;
  }
  const rect = container.getBoundingClientRect();
  if (!rect || !rect.width) {
    return null;
  }
  return Math.round(rect.width);
}

function updateComparisonMeasurement(markup) {
  if (!markup) {
    persistComparisonChromeHeight(0);
    if (comparisonMeasurementDiv) {
      comparisonMeasurementDiv.innerHTML = '';
    }
    return 0;
  }
  const measurementDiv = ensureComparisonMeasurementDiv();
  const widthCandidate = getComparisonMeasurementWidth();
  if (Number.isFinite(widthCandidate) && widthCandidate > 0) {
    measurementDiv.style.width = `${widthCandidate}px`;
  } else {
    measurementDiv.style.width = '';
  }
  measurementDiv.innerHTML = markup;
  const measured = getElementHeight(measurementDiv);
  if (Number.isFinite(measured) && measured >= 0) {
    persistComparisonChromeHeight(measured);
  }
  comparisonDebugLog('comparison measurement update', {
    measuredHeight: lastMeasuredComparisonChromeHeight,
    width: widthCandidate
  });
  return lastMeasuredComparisonChromeHeight;
}

function clearComparisonMeasurement() {
  persistComparisonChromeHeight(0);
  if (comparisonMeasurementDiv) {
    comparisonMeasurementDiv.innerHTML = '';
  }
}

function measureChartChromeHeight() {
  const chartTitle = document.getElementById('chartTitle');
  const customLegend = document.getElementById('customLegend');
  const comparisonDiv = document.getElementById('comparisonDiv');
  const titleHeight = getElementHeight(chartTitle);
  const legendHeight = getElementHeight(customLegend);
  const baseChromeHeight = CHART_HEADER_BUFFER + titleHeight + legendHeight;
  let visibleComparisonHeight = 0;
  if (comparisonDiv && comparisonDiv.style.display !== 'none') {
    visibleComparisonHeight = getElementHeight(comparisonDiv);
    if (Number.isFinite(visibleComparisonHeight) && visibleComparisonHeight >= 0) {
      persistComparisonChromeHeight(visibleComparisonHeight);
    }
  }
  return {
    base: baseChromeHeight,
    comparison: visibleComparisonHeight,
    total: baseChromeHeight + visibleComparisonHeight
  };
}

function updateChartWrapperHeight(contextLabel = 'init') {
  const viewportHeight = Math.round(
    IS_EMBEDDED
      ? parentViewportHeight
      : (
        window.visualViewport?.height
        || window.innerHeight
        || document.documentElement?.clientHeight
        || 0
      )
  );

  if (!IS_EMBEDDED) {
    applyCssViewportHeight(`${viewportHeight}px`);
  }

  const footerReserve = IS_EMBEDDED
    ? parentFooterHeight + FOOTER_GAP
    : getStandaloneFooterHeight() + FOOTER_GAP;

  if (!viewportHeight) {
    // Silently bail when viewport metrics are unavailable; repeated logging was noisy
    return;
  }

  const chromeMetrics = measureChartChromeHeight();
  const baseChromeHeight = chromeMetrics?.base || 0;
  const visibleComparisonChrome = chromeMetrics?.comparison || 0;
  const anticipatedComparisonChrome = (!visibleComparisonChrome && pendingComparisonChromeHeight)
    ? Math.max(0, lastMeasuredComparisonChromeHeight)
    : visibleComparisonChrome;
  const totalChromeForLogging = baseChromeHeight + anticipatedComparisonChrome;
  const chromeBufferForEstimate = CHART_HEADER_BUFFER;
  const estimatedChartHeight = layoutHeightManager
    ? layoutHeightManager.estimateChartHeight({
        viewportHeight,
        footerReserve,
        chromeBuffer: chromeBufferForEstimate
      })
    : Math.max(
        MIN_CHART_CANVAS_HEIGHT,
        viewportHeight - footerReserve - chromeBufferForEstimate
      );

  window.__NAEI_LAST_CHART_HEIGHT = estimatedChartHeight;
  comparisonDebugLog('updateChartWrapperHeight', {
    context: contextLabel,
    viewportHeight,
    footerReserve,
    baseChromeHeight,
    anticipatedComparisonChrome,
    chromeBuffer: totalChromeForLogging,
    chromeBufferUsedForEstimate: chromeBufferForEstimate,
    estimatedChartHeight,
    pendingComparisonChromeHeight
  });
  return estimatedChartHeight;

  /*
  const chartWrapper = document.querySelector('.chart-wrapper');
  const chartDiv = document.getElementById('chart_div');
  const chartTitle = document.getElementById('chartTitle');
  const chartLegend = document.getElementById('customLegend');

  if (!chartWrapper || !chartDiv) {
    return;
  }

  const wrapperTop = Math.max(0, Math.round(chartWrapper.getBoundingClientRect().top));
  const wrapperStyles = window.getComputedStyle(chartWrapper);
  const wrapperPadding = (parseFloat(wrapperStyles.paddingTop) || 0) + (parseFloat(wrapperStyles.paddingBottom) || 0);
  const titleHeight = getElementHeight(chartTitle);
  const legendHeight = getElementHeight(chartLegend);
  const chromeReserve = wrapperPadding + titleHeight + legendHeight + CHART_HEADER_BUFFER;

  let wrapperHeight;
  let chartRegionHeight;

  if (IS_EMBEDDED) {
    const maxWrapperHeight = Math.max(0, viewportHeight - footerReserve);
    wrapperHeight = Math.max(0, maxWrapperHeight);
    chartRegionHeight = Math.max(MIN_CHART_CANVAS_HEIGHT, wrapperHeight - chromeReserve);
    if (chartRegionHeight + chromeReserve > wrapperHeight) {
      chartRegionHeight = Math.max(0, wrapperHeight - chromeReserve);
    }
  } else {
    const availableHeight = Math.max(0, viewportHeight - footerReserve - wrapperTop);
    wrapperHeight = Math.max(MIN_CHART_WRAPPER_HEIGHT, availableHeight);
    chartRegionHeight = Math.max(0, wrapperHeight - chromeReserve);
    if (chartRegionHeight < MIN_CHART_CANVAS_HEIGHT && wrapperHeight >= MIN_CHART_CANVAS_HEIGHT + chromeReserve) {
      chartRegionHeight = MIN_CHART_CANVAS_HEIGHT;
    }
    if (chartRegionHeight + chromeReserve > wrapperHeight) {
      chartRegionHeight = Math.max(0, wrapperHeight - chromeReserve);
    }
  }

  chartWrapper.style.height = `${wrapperHeight}px`;
  chartWrapper.style.maxHeight = `${wrapperHeight}px`;
  chartWrapper.style.minHeight = `${wrapperHeight}px`;

  chartDiv.style.height = `${chartRegionHeight}px`;
  chartDiv.style.minHeight = `${chartRegionHeight}px`;
  chartDiv.style.maxHeight = `${chartRegionHeight}px`;
  chartDiv.style.flex = '0 0 auto';
  window.__NAEI_LAST_CHART_HEIGHT = chartRegionHeight;

  */
}

window.updateChartWrapperHeight = updateChartWrapperHeight;

const SELECTOR_SNAPSHOT_PATHS = [
  '/SharedResources/default-chart-data.json',
  'SharedResources/default-chart-data.json',
  '../SharedResources/default-chart-data.json',
  '../../SharedResources/default-chart-data.json'
];
let selectorOptionsPromise = null;

function dedupeByKey(collection = [], resolver = () => null) {
  const seen = new Set();
  const results = [];
  collection.forEach(item => {
    const key = resolver(item);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    results.push(item);
  });
  return results;
}

function sortCategoryTitles(a = '', b = '') {
  const aName = a.toLowerCase();
  const bName = b.toLowerCase();
  if (aName === 'all') return -1;
  if (bName === 'all') return 1;
  return a.localeCompare(b);
}

function getCategoryDisplayTitle(record) {
  if (!record || typeof record !== 'object') {
    return '';
  }
  const title = record.category_title
    || record.categoryTitle
    || record.category_name
    || record.categoryName
    || record.group_name
    || record.groupName
    || record.title
    || record.name
    || record.label
    || '';
  return typeof title === 'string' ? title : '';
}

function getBubbleCategoryNamePool() {
  const normalizeName = (name) => {
    if (!name) {
      return '';
    }
    if (typeof name === 'string') {
      return name.trim();
    }
    if (typeof name === 'object') {
      return getCategoryDisplayTitle(name);
    }
    return String(name).trim();
  };

  const candidates = [];
  if (Array.isArray(window.allCategoriesList) && window.allCategoriesList.length) {
    candidates.push(...window.allCategoriesList);
  }
  if (Array.isArray(window.__bubbleSelectorOptions?.categoryNames) && window.__bubbleSelectorOptions.categoryNames.length) {
    candidates.push(...window.__bubbleSelectorOptions.categoryNames);
  }
  const supabaseCategories = window.supabaseModule?.allCategories || [];
  if (supabaseCategories.length) {
    candidates.push(...supabaseCategories.map(getCategoryDisplayTitle));
  }

  const normalized = candidates
    .map(normalizeName)
    .filter(Boolean);
  const unique = [...new Set(normalized)];

  if ((!window.allCategoriesList || !window.allCategoriesList.length) && unique.length) {
    window.allCategoriesList = unique.slice();
  }

  return unique;
}

async function fetchSelectorSnapshotFallback() {
  for (const candidate of SELECTOR_SNAPSHOT_PATHS) {
    try {
      const response = await fetch(candidate, { cache: 'no-store' });
      if (!response.ok) {
        continue;
      }
      const snapshot = await response.json();
      return snapshot?.data || snapshot || null;
    } catch (error) {
      console.warn('Selector snapshot fetch failed for', candidate, error);
    }
  }
  return null;
}

async function loadSelectorSnapshotData() {
  if (window.SharedDataLoader?.loadDefaultSnapshot) {
    try {
      const snapshot = await window.SharedDataLoader.loadDefaultSnapshot();
      if (snapshot?.data) {
        return snapshot.data;
      }
    } catch (error) {
      console.warn('SharedDataLoader snapshot unavailable for selectors:', error);
    }
  }

  if (window.SharedDataCache?.snapshotData) {
    return window.SharedDataCache.snapshotData;
  }

  return await fetchSelectorSnapshotFallback();
}

function normalizeSelectorOptions(snapshotData) {
  const rawPollutants = Array.isArray(snapshotData?.pollutants)
    ? snapshotData.pollutants
    : [];
  const rawGroups = Array.isArray(snapshotData?.categories)
    ? snapshotData.categories
    : [];

  const pollutants = dedupeByKey(
    rawPollutants
      .map(item => ({
        id: item?.id,
        pollutant: item?.pollutant || item?.name || item?.label || ''
      }))
      .filter(item => item.id != null && item.pollutant),
    item => `${item.id}-${item.pollutant.toLowerCase()}`
  ).sort((a, b) => a.pollutant.localeCompare(b.pollutant));

  const categories = dedupeByKey(
    rawGroups
      .map(item => ({
        id: item?.id,
        category_title: item?.category_title || item?.group_name || item?.title || '',
        has_activity_data: item?.has_activity_data !== false
      }))
      .filter(item => {
        if (item.id == null || !item.category_title || !item.has_activity_data) {
          return false;
        }
        const normalizedTitle = item.category_title.trim().toLowerCase();
        if (!normalizedTitle || normalizedTitle === 'all') {
          return false;
        }
        return true;
      }),
    item => item.category_title.toLowerCase()
  ).sort((a, b) => sortCategoryTitles(a.category_title, b.category_title));

  return {
    pollutants,
    categories,
    categoryNames: categories.map(category => category.category_title)
  };
}

async function ensureBubbleSelectorOptions() {
  if (window.__bubbleSelectorOptions?.pollutants?.length) {
    return window.__bubbleSelectorOptions;
  }

  if (!selectorOptionsPromise) {
    selectorOptionsPromise = (async () => {
      const snapshotData = await loadSelectorSnapshotData();
      if (!snapshotData) {
        console.warn('Bubble selector metadata unavailable; falling back to Supabase data');
        return {
          pollutants: [],
          categories: [],
          categoryNames: []
        };
      }
      const normalized = normalizeSelectorOptions(snapshotData);
      return normalized;
    })().catch(error => {
      selectorOptionsPromise = null;
      console.error('Failed to prepare bubble selector metadata:', error);
      throw error;
    });
  }

  const options = await selectorOptionsPromise;
  if (options && !window.__bubbleSelectorOptions) {
    window.__bubbleSelectorOptions = options;
  }
  return options;
}

function applySelectorOptionsToGlobals(selectorOptions) {
  if (!selectorOptions) {
    return;
  }

  window.__bubbleSelectorOptions = selectorOptions;
  const { categories, categoryNames } = selectorOptions;
  if (Array.isArray(categories) && categories.length) {
    window.allCategories = categories.slice();
    window.allCategoriesList = (Array.isArray(categoryNames) && categoryNames.length)
      ? categoryNames.slice()
      : categories.map(category => category.category_title).sort(sortCategoryTitles);
    bubbleDefaultDebug('applySelectorOptionsToGlobals', {
      source: 'snapshot-options',
      categoryCount: window.allCategoriesList.length,
      sample: window.allCategoriesList.slice(0, 6)
    });
  }
}

/**
 * Initialize the application
 */
async function init() {
  // Ensure loading class is set
  document.body.classList.add('loading');
  updateChartWrapperHeight('init');

  try {
    // Loading overlay removed - data pre-loaded via shared loader
    document.getElementById('mainContent').setAttribute('aria-hidden', 'true');
    document.body.classList.add('loading');

    // Wait for supabaseModule to be available
    let attempts = 0;
    const maxAttempts = 50;
    while (!window.supabaseModule && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!window.supabaseModule) {
      throw new Error('supabaseModule not available after waiting');
    }

    const selectorOptionsPromise = ensureBubbleSelectorOptions();

    // Load data using supabaseModule
    await window.supabaseModule.loadData();

    if (window.supabaseModule.latestDatasetSource === 'hero') {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Create window data stores EXACTLY like linechart v2.3
    window.allPollutants = window.supabaseModule.allPollutants;
    window.allCategoriesRaw = window.supabaseModule.allCategories;
    const selectorOptions = await selectorOptionsPromise
      .catch(error => {
        console.error('Falling back to Supabase selectors after snapshot failure:', error);
        return null;
      });
    applySelectorOptionsToGlobals(selectorOptions);

    if (!Array.isArray(window.allCategoriesList) || !window.allCategoriesList.length) {
      const activeCategoriesForSelectors = window.supabaseModule.activeActDataCategories
        || window.supabaseModule.activeCategories
        || window.supabaseModule.allCategories
        || [];
      window.allCategories = activeCategoriesForSelectors;

      // Create allCategoriesList EXACTLY like linechart setupSelectors function
      const categories = activeCategoriesForSelectors;
      const categoryNames = [...new Set(categories.map(getCategoryDisplayTitle))]
        .filter(Boolean)
        .sort((a, b) => {
          if (a.toLowerCase() === 'all') return -1;
          if (b.toLowerCase() === 'all') return 1;
          return a.localeCompare(b);
        });
      window.allCategoriesList = categoryNames;
      bubbleDefaultDebug('applySelectorOptionsToGlobals', {
        source: 'supabase-fallback',
        categoryCount: window.allCategoriesList.length,
        sample: window.allCategoriesList.slice(0, 6)
      });
    }

    // Setup UI
    setupYearSelector();
    setupPollutantSelector();
    setupCategorySelector();
    setupEventListeners();
    setupTutorialOverlay();
    updateChartWrapperHeight('post-setup');

    // Render initial view based on URL parameters or defaults
    await renderInitialView();

    // Finally, reveal the main content and draw the chart
    await revealMainContent();

  } catch (error) {
    console.error('Failed to initialize application:', error);
    showNotification('Failed to load data. Please refresh the page.', 'error');
  }
}

/**
 * Remove loading state
 */
function removeLoadingState() {
  // Loading overlay removed - just update body class
  document.body.classList.remove('loading');
}

/**
 * Fallback function to show content directly
 */
function showContentDirectly() {
  const mainContent = document.getElementById('mainContent');
  
  if (mainContent) {
    mainContent.style.display = 'block';
    mainContent.removeAttribute('aria-hidden');
    mainContent.classList.add('loaded');
    
    // Loading overlay removed - skip hiding step
    
    // Make chart visible
    const chartWrapper = document.querySelector('.chart-wrapper');
    if (chartWrapper) {
      chartWrapper.classList.add('visible');
    }

    const chartDiv = document.getElementById('chart_div');
    if (chartDiv) {
      chartDiv.classList.add('visible');
    }
    
    notifyParentChartReady();
  } else {
    console.error('Could not find mainContent element');
  }
}

function setupTutorialOverlay() {
  const overlay = document.getElementById('bubbleTutorialOverlay');
  const openBtn = document.getElementById('tutorialBtn');
  if (!overlay || !openBtn) {
    // Tutorial overlay markup missing; skipping tutorial setup
    return;
  }
  openBtn.setAttribute('aria-expanded', 'false');

  const chartWrapper = document.querySelector('.chart-wrapper');
  const overlayOriginalParent = overlay.parentNode;
  const overlayOriginalNextSibling = overlay.nextSibling;
  const tutorialModeMedia = window.matchMedia(`(max-width: ${INLINE_TUTORIAL_BREAKPOINT}px)`);
  let tutorialMode = tutorialModeMedia.matches ? 'inline' : 'overlay';

  function determineTutorialMode() {
    return tutorialModeMedia.matches ? 'inline' : 'overlay';
  }

  function isInlineMode() {
    return tutorialMode === 'inline';
  }

  function applyTutorialMode(mode) {
    if (!overlay) {
      return;
    }
    if (mode === 'inline') {
      if (chartWrapper && overlay.parentNode !== chartWrapper) {
        chartWrapper.appendChild(overlay);
      }
      overlay.classList.add('inline-mode');
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
      unlockDocumentScroll();
    } else {
      if (overlayOriginalParent) {
        overlayOriginalParent.insertBefore(overlay, overlayOriginalNextSibling);
      } else if (overlay.parentNode !== document.body) {
        document.body.appendChild(overlay);
      }
      overlay.classList.remove('inline-mode');
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
      unlockDocumentScroll();
    }
  }

  const dialog = overlay.querySelector('.bubble-tutorial-dialog');
  const stage = overlay.querySelector('.bubble-tutorial-stage');
  const closeBtn = overlay.querySelector('.bubble-tutorial-close');
  const prevBtn = overlay.querySelector('.bubble-tutorial-nav.prev');
  const nextBtn = overlay.querySelector('.bubble-tutorial-nav.next');
  const layerImages = Array.from(overlay.querySelectorAll('.tutorial-layer-image'));
  const layerBySuffix = new Map(layerImages.map(img => [img.dataset.suffix, img]));
  const fadeDurationMs = 300;
  const gapMs = 100;
  const swipeThresholdPx = 45;

  let currentSlide = 0;
  let currentVisibleLayers = new Set();
  let isTransitioning = false;
  let overlayActive = false;
  let lastFocusedElement = null;
  let touchStartX = null;
  const scrollLockState = {
    active: false,
    offset: 0,
    styles: null
  };

  applyTutorialMode(tutorialMode);

  function lockDocumentScroll() {
    if (isInlineMode() || scrollLockState.active) {
      return;
    }
    const body = document.body;
    if (!body) {
      return;
    }
    scrollLockState.offset = window.scrollY || window.pageYOffset || 0;
    scrollLockState.styles = {
      position: body.style.position || '',
      top: body.style.top || '',
      left: body.style.left || '',
      right: body.style.right || '',
      width: body.style.width || ''
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollLockState.offset}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.classList.add('tutorial-open');
    scrollLockState.active = true;
  }

  function unlockDocumentScroll() {
    if (!scrollLockState.active) {
      return;
    }
    const body = document.body;
    if (body) {
      const previous = scrollLockState.styles || {};
      body.style.position = previous.position || '';
      body.style.top = previous.top || '';
      body.style.left = previous.left || '';
      body.style.right = previous.right || '';
      body.style.width = previous.width || '';
      body.classList.remove('tutorial-open');
    }
    const offset = scrollLockState.offset || 0;
    scrollLockState.active = false;
    scrollLockState.offset = 0;
    scrollLockState.styles = null;
    window.scrollTo({ top: offset, behavior: 'auto' });
  }

  const lastSlideIndex = TUTORIAL_SLIDE_MATRIX.length - 1;

  function notifyParentTutorialState(state, source = 'user') {
    if (!IS_EMBEDDED || !window.parent) {
      return;
    }
    try {
      window.parent.postMessage({
        type: 'bubbleTutorialState',
        state,
        source
      }, '*');
    } catch (error) {
      // Parent may block tutorial state messages; nothing else to do
    }
  }

  function getFocusableElements() {
    return Array.from(dialog.querySelectorAll('button:not([disabled])'));
  }

  function updateNavButtons() {
    if (prevBtn) {
      const isDisabled = currentSlide === 0;
      prevBtn.disabled = isDisabled;
      prevBtn.setAttribute('aria-disabled', String(isDisabled));
      prevBtn.style.display = isDisabled ? 'none' : 'flex';
    }
    if (nextBtn) {
      const isDisabled = currentSlide === lastSlideIndex;
      nextBtn.disabled = isDisabled;
      nextBtn.setAttribute('aria-disabled', String(isDisabled));
      nextBtn.style.display = isDisabled ? 'none' : 'flex';
    }
  }

  function applyLayerVisibility(targetLayers) {
    currentVisibleLayers.forEach(suffix => {
      if (!targetLayers.has(suffix)) {
        const img = layerBySuffix.get(suffix);
        if (img) {
          img.classList.remove('visible');
        }
      }
    });

    targetLayers.forEach(suffix => {
      if (!currentVisibleLayers.has(suffix)) {
        const img = layerBySuffix.get(suffix);
        if (img) {
          img.classList.add('visible');
        }
      }
    });
  }

  function showSlide(index, immediate = false) {
    const targetIndex = Math.max(0, Math.min(index, lastSlideIndex));
    const targetLayers = new Set(TUTORIAL_SLIDE_MATRIX[targetIndex] || []);

    if (immediate) {
      applyLayerVisibility(targetLayers);
      currentVisibleLayers = targetLayers;
      currentSlide = targetIndex;
      updateNavButtons();
      return;
    }

    if (isTransitioning || (!overlayActive && currentVisibleLayers.size === 0 && targetIndex === currentSlide)) {
      return;
    }

    const toHide = [...currentVisibleLayers].filter(layer => !targetLayers.has(layer));
    const toShow = [...targetLayers].filter(layer => !currentVisibleLayers.has(layer));
    const hasExistingLayers = currentVisibleLayers.size > 0;

    const finalize = () => {
      currentVisibleLayers = targetLayers;
      currentSlide = targetIndex;
      updateNavButtons();
      isTransitioning = false;
    };

    if (!hasExistingLayers) {
      applyLayerVisibility(targetLayers);
      setTimeout(finalize, fadeDurationMs);
      return;
    }

    isTransitioning = true;
    toHide.forEach(suffix => {
      const img = layerBySuffix.get(suffix);
      if (img) {
        img.classList.remove('visible');
      }
    });

    setTimeout(() => {
      toShow.forEach(suffix => {
        const img = layerBySuffix.get(suffix);
        if (img) {
          img.classList.add('visible');
        }
      });
    }, fadeDurationMs + gapMs);

    setTimeout(finalize, fadeDurationMs + gapMs + fadeDurationMs);
  }

  function showNextSlide() {
    if (currentSlide < lastSlideIndex) {
      showSlide(currentSlide + 1);
    }
  }

  function showPrevSlide() {
    if (currentSlide > 0) {
      showSlide(currentSlide - 1);
    }
  }

  function handleOverlayKeydown(event) {
    if (!overlayActive) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hideOverlay('keyboard');
      return;
    }
    if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      showNextSlide();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showPrevSlide();
      return;
    }
    if (event.key === 'Tab') {
      if (isInlineMode()) {
        return;
      }
      const focusable = getFocusableElements();
      if (!focusable.length) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function handleTouchStart(event) {
    if (!overlayActive || !event?.changedTouches?.length) {
      return;
    }
    touchStartX = event.changedTouches[0].clientX;
  }

  function handleTouchEnd(event) {
    if (!overlayActive || touchStartX === null || !event?.changedTouches?.length) {
      touchStartX = null;
      return;
    }
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(deltaX) >= swipeThresholdPx) {
      if (deltaX < 0) {
        showNextSlide();
      } else {
        showPrevSlide();
      }
    }
    touchStartX = null;
  }

  function scrollTutorialIntoView() {
    const isEmbedded = IS_EMBEDDED && window.parent && window.parent !== window;

    const scrollSelf = () => new Promise(resolve => {
      try {
        const chartWrapper = document.querySelector('.chart-wrapper');
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (!chartWrapper) {
          window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
          resolve();
          return;
        }

        const rect = chartWrapper.getBoundingClientRect();
        const pageOffset = window.pageYOffset || document.documentElement.scrollTop || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const wrapperHeight = rect.height || chartWrapper.offsetHeight || 0;
        const offsetToCenter = Math.max(0, (viewportHeight - wrapperHeight) / 2);
        const targetTop = Math.max(0, rect.top + pageOffset - offsetToCenter);
        const behavior = prefersReducedMotion ? 'auto' : 'smooth';

        window.scrollTo({ top: targetTop, behavior });
        resolve();
      } catch (error) {
          // Failing to center overlay is non-critical; continue without logging
        resolve();
      }
    });

    if (!isEmbedded) {
      return scrollSelf();
    }

    const tryFrameElementScroll = () => new Promise(resolve => {
      try {
        const frameEl = window.frameElement;
        if (!frameEl || typeof frameEl.scrollIntoView !== 'function') {
          resolve(false);
          return;
        }
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        frameEl.scrollIntoView({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
        setTimeout(() => resolve(true), prefersReducedMotion ? 0 : 30);
      } catch (error) {
        // Parent frame may reject scroll requests; ignore failures
        resolve(false);
      }
    });

    const parentScrollFallback = () => {
      const requestId = `bubbleTutorial-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      return new Promise(resolve => {
        let resolved = false;

        const handleAck = (event) => {
          if (event?.data?.type === 'bubbleTutorialScrollComplete' && event.data.requestId === requestId) {
            window.removeEventListener('message', handleAck);
            resolved = true;
            resolve();
          }
        };

        window.addEventListener('message', handleAck);

        try {
          window.parent.postMessage({ type: 'scrollToBubbleTutorial', requestId }, '*');
        } catch (error) {
          // Parent scroll requests can fail in locked-down hosts
          window.removeEventListener('message', handleAck);
          resolve();
          return;
        }

        setTimeout(() => {
          if (!resolved) {
            window.removeEventListener('message', handleAck);
            resolve();
          }
        }, 140);
      });
    };

    return tryFrameElementScroll()
      .then(success => success ? null : parentScrollFallback())
      .then(scrollSelf);
  }

  async function showOverlay(source = 'user', options = {}) {
    if (overlayActive) {
      return;
    }
    tutorialMode = determineTutorialMode();
    applyTutorialMode(tutorialMode);
    const skipScroll = Boolean(options.skipScroll) || source === 'url-param';
    if (!skipScroll && IS_EMBEDDED && !isInlineMode()) {
      await scrollTutorialIntoView();
    }
    overlayActive = true;
    lastFocusedElement = document.activeElement;
    if (!isInlineMode()) {
      lockDocumentScroll();
    }
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    openBtn.setAttribute('aria-expanded', 'true');
    if (isInlineMode()) {
      requestAnimationFrame(() => {
        overlay.scrollIntoView({ behavior: skipScroll ? 'auto' : 'smooth', block: 'start' });
      });
    }
    currentVisibleLayers.forEach(suffix => {
      const img = layerBySuffix.get(suffix);
      if (img) {
        img.classList.remove('visible');
      }
    });
    currentVisibleLayers = new Set();
    showSlide(0, true);
    document.addEventListener('keydown', handleOverlayKeydown);
    notifyParentTutorialState('opened', source);
    requestAnimationFrame(() => {
      if (closeBtn) {
        closeBtn.focus();
      }
    });
  }

  function hideOverlay(source = 'user') {
    if (!overlayActive) {
      return;
    }
    overlayActive = false;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    openBtn.setAttribute('aria-expanded', 'false');
    unlockDocumentScroll();
    document.removeEventListener('keydown', handleOverlayKeydown);
    touchStartX = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    } else {
      openBtn.focus();
    }
    lastFocusedElement = null;
    notifyParentTutorialState('closed', source);
  }

  openBtn.addEventListener('click', () => showOverlay('user'));
  if (closeBtn) {
    closeBtn.addEventListener('click', () => hideOverlay('user'));
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', showPrevSlide);
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', showNextSlide);
  }

  function handleTutorialModeChange() {
    const desired = determineTutorialMode();
    if (desired === tutorialMode) {
      return;
    }
    if (overlayActive) {
      hideOverlay('mode-change');
    }
    tutorialMode = desired;
    applyTutorialMode(tutorialMode);
  }

  if (typeof tutorialModeMedia.addEventListener === 'function') {
    tutorialModeMedia.addEventListener('change', handleTutorialModeChange);
  } else if (typeof tutorialModeMedia.addListener === 'function') {
    tutorialModeMedia.addListener(handleTutorialModeChange);
  }

  overlay.addEventListener('click', (event) => {
    if (!isInlineMode() && event.target === overlay) {
      hideOverlay('user');
    }
  });

  const closeOnResize = () => {
    if (overlayActive) {
      hideOverlay('window-resize');
    }
  };

  window.addEventListener('resize', closeOnResize);
  window.addEventListener('orientationchange', closeOnResize);

  if (stage) {
    stage.addEventListener('touchstart', handleTouchStart, { passive: true });
    stage.addEventListener('touchend', handleTouchEnd, { passive: true });
    stage.addEventListener('touchcancel', () => {
      touchStartX = null;
    }, { passive: true });
  }

  showSlide(0, true);

  tutorialOverlayApi.open = showOverlay;
  tutorialOverlayApi.hide = hideOverlay;
  tutorialOverlayApi.isActive = () => overlayActive;

  if (pendingTutorialOpenReason) {
    const shouldSkipScroll = pendingTutorialOpenReason !== 'user';
    showOverlay(pendingTutorialOpenReason, { skipScroll: shouldSkipScroll });
    pendingTutorialOpenReason = null;
  }
}

function measureBubbleContentHeight() {
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
  const wrapperEl = layoutHeightManager?.getWrapperElement?.() || document.querySelector('.chart-wrapper');
  const overlay = document.getElementById('bubbleTutorialOverlay');
  const overlayVisible = Boolean(
    overlay && (
      (typeof tutorialOverlayApi.isActive === 'function' && tutorialOverlayApi.isActive())
      || overlay.classList.contains('visible')
      || overlay.getAttribute('aria-hidden') === 'false'
    )
  );

  const shellBottom = getElementBottom(chartShell);
  const mainContentBottom = getElementBottom(mainContent);
  const wrapperBottom = getElementBottom(wrapperEl);
  const overlayBottom = overlayVisible ? getElementBottom(overlay) : 0;

  const candidates = [
    { label: 'chartShell', value: shellBottom },
    { label: 'mainContent', value: mainContentBottom },
    { label: 'chartWrapper', value: wrapperBottom }
  ];

  if (overlayBottom) {
    candidates.push({ label: 'tutorialOverlay', value: overlayBottom });
  }

  const validCandidates = candidates.filter(candidate => Number.isFinite(candidate.value) && candidate.value > 0);
  let measuredHeight = 0;
  let preferredSource = 'none';

  if (validCandidates.length) {
    const bestCandidate = validCandidates.reduce((prev, next) => (next.value > prev.value ? next : prev));
    measuredHeight = bestCandidate.value;
    preferredSource = bestCandidate.label;
  }

  const fallbackEstimate = Math.max(
    MIN_CHART_CANVAS_HEIGHT + CHART_HEADER_BUFFER + FOOTER_GAP,
    layoutHeightManager?.getLastEstimatedHeight?.() || window.__NAEI_LAST_CHART_HEIGHT || MIN_CHART_CANVAS_HEIGHT
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
    overlayVisible,
    fallbackEstimate: Math.round(fallbackEstimate)
  };
}

function sendContentHeightToParent(force = false) {
  try {
    if (!IS_EMBEDDED) {
      return;
    }

    const measurement = measureBubbleContentHeight();
    const measuredHeight = Math.max(MIN_CHART_CANVAS_HEIGHT, measurement.height);

    if (!force && lastSentHeight && Math.abs(measuredHeight - lastSentHeight) < MIN_HEIGHT_DELTA) {
      return;
    }

    lastSentHeight = measuredHeight;

    window.parent.postMessage({
      type: 'contentHeight',
      chart: 'bubble',
      height: measuredHeight
    }, '*');

    requestAnimationFrame(() => updateChartWrapperHeight('post-height-send'));
  } catch (error) {
    // Suppress height-posting failures; parent will request updates if needed
  }
}
async function notifyParentChartReady() {
  if (chartReadyNotified) {
    sendContentHeightToParent();
    return;
  }

  try {
    if (typeof window.ChartRenderer?.waitForStability === 'function') {
      await window.ChartRenderer.waitForStability();
    }
  } catch (error) {
    console.warn('Bubble chart stability wait failed:', error);
  }

  chartReadyNotified = true;

  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'chartReady',
        chart: 'bubble'
      }, '*');
      // Send initial height immediately after signalling readiness
      setTimeout(sendContentHeightToParent, 100);
    }
  } catch (error) {
    // Parent may be unavailable; no logging to keep console quiet
  }
}

/**
 * Reveal main content (no loading overlay to manage)
 */
async function revealMainContent() {
  return new Promise(resolve => {
    const mainContent = document.getElementById('mainContent');
    const loadingOverlay = document.getElementById('loadingOverlay');


    if (!mainContent) {
      console.error('Missing mainContent element for reveal');
      resolve();
      return;
    }

    // Hide loading overlay
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }

    // Make content visible
    mainContent.style.display = 'block';
    mainContent.removeAttribute('aria-hidden');
    freezeWidthForOpera('#downloadBtn', {
      extraPadding: 0,
      attempts: 6,
      attemptDelay: 160
    });
    freezeWidthForOpera('#yearSelect', {
      fixedWidth: 100,
      attempts: 6,
      attemptDelay: 160
    });
    
    // Render the chart
    chartRenderingUnlocked = true;
    const pendingSkipFlag = pendingDrawRequest?.skipHeightUpdate || false;
    pendingDrawRequest = null;

    drawChart(pendingSkipFlag)
      .catch(error => {
        console.error('Initial bubble chart draw failed:', error);
      })
      .then(() => {
      updateChartWrapperHeight('revealMainContent');

      // Wait for chart to render, then complete the loading process
      setTimeout(() => {
        requestAnimationFrame(() => {
          mainContent.classList.add('loaded');
        });

        setTimeout(() => {
          updateChartWrapperHeight('post-load');
          notifyParentChartReady().finally(resolve);
          // Fallback: force a resize/draw after layout settles to avoid blank chart until devtools resize
          setTimeout(() => {
            try {
              window.dispatchEvent(new Event('resize'));
              drawChart(true);
            } catch (err) {
            }
          }, 120);
        }, 16);
      }, 16);
      });
  });
}

/**
 * Auto-load with default selections
 */
/**
 * Render initial view based on URL parameters or defaults (matching linechart v2.3)
 */
async function renderInitialView() {
  return new Promise(resolve => {
    const params = parseUrlParameters();
    const pollutantSelect = document.getElementById('pollutantSelect');
    bubbleDefaultDebug('renderInitialView invoked', {
      paramsPollutant: params.pollutantName,
      paramsCategories: params.categoryNames,
      initialCategoryCount: Array.isArray(window.allCategoriesList) ? window.allCategoriesList.length : 0
    });
    
    // Use a small timeout to allow the DOM to update with options
    setTimeout(() => {
      
      if (params.pollutantName) {
        const pollutant = window.supabaseModule.allPollutants.find(p => p.pollutant === params.pollutantName);
        if (pollutant) {
          selectedPollutantId = pollutant.id;
          pollutantSelect.value = String(pollutant.id);
        }
      } else {
        // Default to PM2.5 if no pollutant is in the URL
        const pm25 = window.supabaseModule.allPollutants.find(p => p.pollutant === 'PM2.5');
        if (pm25) {
          selectedPollutantId = pm25.id;
          pollutantSelect.value = String(pm25.id);
        }
      }

      // Clear existing category selectors and add new ones based on URL or defaults
      const categoryContainer = document.getElementById('categoryContainer');
      categoryContainer.innerHTML = '';

      if (params.categoryNames && params.categoryNames.length > 0) {
        // Store comparison flags from URL for use in refreshButtons
        initialComparisonFlags = params.comparisonFlags || [];
        bubbleDefaultDebug('renderInitialView applying URL categories', {
          categoryNames: params.categoryNames
        });
        params.categoryNames.forEach(name => addCategorySelector(name, false));
      } else {
        // Clear comparison flags for default categories (will be set to checked by default)
        initialComparisonFlags = [];
        const allCategories = window.allCategoriesList || [];
        const ecodesignCategory = allCategories.find(name => name === 'Ecodesign Stove - Ready To Burn');
        const gasBoilerCategory = allCategories.find(name => typeof name === 'string' && name.toLowerCase().includes('gas boiler'));
        bubbleDefaultDebug('renderInitialView default category search', {
          categoryCount: allCategories.length,
          sample: allCategories.slice(0, 8),
          ecodesignFound: Boolean(ecodesignCategory),
          gasFound: Boolean(gasBoilerCategory)
        });

        if (ecodesignCategory) {
          addCategorySelector(ecodesignCategory, false);
        }

        if (gasBoilerCategory) {
          addCategorySelector(gasBoilerCategory, false);
        }

        if (!ecodesignCategory && !gasBoilerCategory && allCategories.length > 0) {
          addCategorySelector(allCategories[0], false);
          if (allCategories.length > 1) {
            addCategorySelector(allCategories[1], false);
          }
        } else if (!ecodesignCategory && gasBoilerCategory && allCategories.length > 0) {
          const firstCategory = allCategories[0];
          if (firstCategory && firstCategory !== gasBoilerCategory) {
            addCategorySelector(firstCategory, false);
          }
        } else if (ecodesignCategory && !gasBoilerCategory && allCategories.length > 1) {
          const secondCategory = allCategories.find(name => name !== ecodesignCategory);
          if (secondCategory) {
            addCategorySelector(secondCategory, false);
          }
        }
      }

      // Set year from URL params or default to latest
      const yearSelect = document.getElementById('yearSelect');
      const availableYears = window.supabaseModule.getAvailableYears() || [];
      const mostRecentYear = availableYears.length > 0 ? Math.max(...availableYears) : null;

      if (Number.isInteger(params.year) && yearSelect.querySelector(`option[value="${params.year}"]`)) {
        yearSelect.value = String(params.year);
        selectedYear = params.year;
      } else {
        // Default to most recent available year
        if (mostRecentYear) {
          yearSelect.value = String(mostRecentYear);
          selectedYear = mostRecentYear;
        } else {
          selectedYear = null;
        }
      }
      
      
      // Refresh category dropdowns and buttons after adding default categories
      refreshCategoryDropdowns();
      refreshButtons();
      bubbleDefaultDebug('renderInitialView completed', {
        seededCategories: getSelectedCategories(),
        comparisonFlags: initialComparisonFlags
      });
      
      resolve();
    }, 50);
  });
}

/**
 * Parse URL parameters (simplified version for scatter chart)
 * Read from parent window if embedded in iframe
 */
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
  
  // Check if this is the active chart - only parse params if chart=1 (bubble chart)
  const chartParam = params.get('chart');
  if (chartParam && chartParam !== '1') {
    // Return empty params so defaults will be used
    return {
      pollutantName: null,
      categoryNames: [],
      comparisonFlags: [],
      year: null
    };
  }
  
  const pollutantIdParam = params.get('pollutant_id');
  const pollutantIdNumeric = pollutantIdParam ? Number(pollutantIdParam) : null;
  const categoryIdsRaw = params.get('category_ids')
    || params.get('categoryIds')
    || params.get('categoryId')
    || '';
  const categoryIdsParam = categoryIdsRaw ? categoryIdsRaw.split(',') : [];
  const yearParamRaw = params.get('year');
  const yearParam = yearParamRaw ? parseInt(yearParamRaw, 10) : null;

  const pollutants = window.supabaseModule.allPollutants || [];
  const categories = window.supabaseModule.allCategories || [];
  const activeCategoryIdSet = new Set(
    window.supabaseModule.activeActDataCategoryIds
    || window.supabaseModule.activeCategoryIds
    || []
  );
  const availableYears = window.supabaseModule.getAvailableYears() || [];
  const actDataPollutantId = Number(
    window.supabaseModule.actDataPollutantId
    || window.supabaseModule.activityDataId
    || NaN
  );

  let pollutantName = null;
  const activityDataRequested = Number.isFinite(actDataPollutantId)
    && Number.isFinite(pollutantIdNumeric)
    && actDataPollutantId === pollutantIdNumeric;

  if (pollutantIdParam && !activityDataRequested) {
    const pollutant = pollutants.find(p => String(p.id) === String(pollutantIdParam));
    if (pollutant) {
      const isActivityByName = typeof pollutant.pollutant === 'string'
        && pollutant.pollutant.trim().toLowerCase() === 'activity data';
      if (!isActivityByName) {
        pollutantName = pollutant.pollutant;
      }
    }
  }

  // Parse category IDs and comparison flags (e.g., "20c" means category 20 with comparison checked)
  let categoryNames = [];
  let comparisonFlags = []; // Track which categories should have comparison checkbox checked
  
  if (categoryIdsParam && categoryIdsParam.length > 0) {
    categoryIdsParam.forEach(idStr => {
      const hasComparisonFlag = idStr.endsWith('c');
      const id = parseInt(hasComparisonFlag ? idStr.slice(0, -1) : idStr);
      
      if (id) {
        const category = categories.find(g => g.id === id);
        if (category) {
          if (category.has_activity_data === false) {
            return;
          }
          if (activeCategoryIdSet.size && !activeCategoryIdSet.has(category.id)) {
            return;
          }
          categoryNames.push(getCategoryDisplayTitle(category));
          comparisonFlags.push(hasComparisonFlag);
        }
      }
    });
  }

  const allowedCategoryNames = Array.isArray(window.allCategoriesList)
    ? new Set(window.allCategoriesList)
    : null;
  if (allowedCategoryNames && categoryNames.length) {
    const filteredNames = categoryNames.filter(name => allowedCategoryNames.has(name));
    if (filteredNames.length !== categoryNames.length) {
      bubbleDefaultDebug('parseUrlParameters dropped unsupported categories', {
        before: categoryNames,
        after: filteredNames
      });
    }
    categoryNames = filteredNames;
    comparisonFlags = comparisonFlags.slice(0, categoryNames.length);
  }

  // Validate year against available years
  let year = null;
  if (availableYears.length > 0) {
    const mostRecentYear = Math.max(...availableYears);
    if (Number.isInteger(yearParam) && availableYears.includes(yearParam)) {
      // Year is valid
      year = yearParam;
    } else if (Number.isInteger(yearParam)) {
      // Year provided but invalid - use most recent available
      year = mostRecentYear;
    } else {
      // No year provided - use most recent
      year = mostRecentYear;
    }
  }

  return {
    pollutantName,
    categoryNames,
    comparisonFlags,
    year
  };
}

/**
 * Setup year selector
 */
function setupYearSelector() {
  const years = window.supabaseModule.getAvailableYears();
  // Sort years in ascending order (smallest first, 2023 at bottom)
  const sortedYears = [...years].sort((a, b) => a - b);
  const select = document.getElementById('yearSelect');
  
  select.innerHTML = '<option value="">Select year</option>';
  sortedYears.forEach(year => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    select.appendChild(option);
  });

  // Default to most recent year (which will be the last in the sorted array)
  if (sortedYears.length > 0) {
    selectedYear = sortedYears[sortedYears.length - 1];
    select.value = selectedYear;
  }
}

/**
 * Setup pollutant selector
 */
function setupPollutantSelector() {
  const actDataId = window.supabaseModule.actDataPollutantId || window.supabaseModule.activityDataId;
  const selectorPollutants = window.__bubbleSelectorOptions?.pollutants;
  const pollutantOptions = Array.isArray(selectorPollutants) && selectorPollutants.length
    ? selectorPollutants
    : window.supabaseModule.allPollutants || [];
  const pollutants = pollutantOptions
    .filter(p => p.id !== actDataId && p.pollutant)
    .sort((a, b) => a.pollutant.localeCompare(b.pollutant));
  
  const select = document.getElementById('pollutantSelect');
  select.innerHTML = '<option value="">Select pollutant</option>';
  
  pollutants.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.pollutant;
    select.appendChild(option);
  });
}

// Get selected categories from dropdown selectors (like linechart)
function getSelectedCategories(){ 
  const selects = document.querySelectorAll('#categoryContainer select');
  
  const values = [...selects].map((s, i) => {
    return s.value;
  }).filter(Boolean);
  
  return values;
}

// Expose selector helpers globally for any embed helpers that need them
window.getSelectedCategories = getSelectedCategories;

// Add category selector dropdown (adapted from linechart)
function addCategorySelector(defaultValue = "", usePlaceholder = true){
  const categoryName = (defaultValue && typeof defaultValue === 'object')
    ? getCategoryDisplayTitle(defaultValue)
    : defaultValue;
  bubbleDefaultDebug('addCategorySelector invoked', {
    requestedValue: categoryName,
    usePlaceholder,
    availableCategories: Array.isArray(window.allCategoriesList) ? window.allCategoriesList.length : 0
  });
  const container = document.getElementById('categoryContainer');
  const div = document.createElement('div');
  div.className = 'categoryRow';
  div.draggable = true; // Make row draggable

  // drag handle (like linechart)
  const dragHandle = document.createElement('span');
  dragHandle.className = 'dragHandle';
  dragHandle.textContent = '⠿';
  dragHandle.style.marginRight = '6px';
  
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
  
  // Keyboard handlers for reordering when handleBtn is focused
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
          // Move focus back to the handle for continued keyboard moves
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
      // Keyboard reordering failed; leave current order unchanged
    }
  });
  
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
  allCategories.forEach(categoryTitle => {
    if (!selected.includes(categoryTitle) || categoryTitle === categoryName) {
      sel.add(new Option(categoryTitle, categoryTitle));
    }
  });
  
  
  if (categoryName) {
    sel.value = categoryName;
    
    // Verify the option exists
    const optionExists = [...sel.options].some(opt => opt.value === categoryName);
    if (!optionExists) {
      const injectedOption = new Option(categoryName, categoryName);
      sel.add(injectedOption);
      sel.value = categoryName;
      bubbleDefaultDebug('addCategorySelector missing option', {
        requestedValue: categoryName,
        optionCount: sel.options.length,
        sample: [...sel.options].slice(0, 6).map(opt => opt.value)
      });
    } else {
      bubbleDefaultDebug('addCategorySelector applied option', {
        requestedValue: categoryName
      });
    }
  }
  sel.addEventListener('change', () => { 
    refreshCategoryDropdowns(); 
    refreshButtons();
    updateChart(); 
  });

  controlWrap.appendChild(sel);
  div.appendChild(controlWrap);

  container.appendChild(div);
  addDragAndDropHandlers(div); // Add drag-and-drop event listeners
  
  // Delay the refresh to avoid conflicts during initialization
  setTimeout(() => {
    refreshCategoryDropdowns();
    refreshButtons();
    // alignComparisonHeader();
    bubbleDefaultDebug('addCategorySelector post-refresh', {
      currentSelections: getSelectedCategories()
    });
  }, 10);
}


// Refresh category dropdown options (like linechart)
function refreshCategoryDropdowns() {
  const allCategoryNames = (window.allCategoriesList || [])
    .filter(Boolean)
    .sort((a, b) => sortCategoryTitles(a, b));
  const selected = getSelectedCategories();
  
  document.querySelectorAll('#categoryContainer select').forEach(select => {
    const currentValue = select.value;
    // Clear and rebuild options
    select.innerHTML = '';
    
    // Add placeholder
    const ph = new Option('Select category','');
    ph.disabled = true;
    if (!currentValue) ph.selected = true;
    select.add(ph);
    
    // Add available categories
    allCategoryNames.forEach(categoryTitle => {
      if (!selected.includes(categoryTitle) || categoryTitle === currentValue) {
        const option = new Option(categoryTitle, categoryTitle);
        if (categoryTitle === currentValue) option.selected = true;
        select.add(option);
      }
    });
  });
}

// Add button management like linechart
function refreshButtons() {
  const container = document.getElementById('categoryContainer');
  // Remove any existing Add/Remove buttons to rebuild cleanly
  container.querySelectorAll('.add-btn, .remove-btn').forEach(n => n.remove());

  const rows = container.querySelectorAll('.categoryRow');

  // Process all rows to add remove buttons and checkboxes
  rows.forEach(row => {
    // Store current checkbox state before removing (to preserve state when rebuilding)
    const existingCheckbox = row.querySelector('.comparison-checkbox');
    const wasChecked = existingCheckbox ? existingCheckbox.checked : false;
    
    // Remove all existing checkboxes/buttons/wraps to rebuild them cleanly
    row.querySelectorAll('.category-checkbox').forEach(checkbox => checkbox.remove());
    row.querySelectorAll('.comparison-checkbox-wrap').forEach(wrap => wrap.remove());
    row.querySelectorAll('.remove-btn').forEach(btn => btn.remove());

    // Add remove button only if there are 2 or more categories
    let removeBtn = null;
    if (rows.length >= 2) {
      removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.innerHTML = '<span class="remove-icon" aria-hidden="true"></span> Remove Category';
      // make ARIA label include the current category name if available
      const sel = row.querySelector('select');
      const categoryName = sel ? (sel.value || (sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].text) || '') : '';
      removeBtn.setAttribute('aria-label', categoryName ? `Remove category ${categoryName}` : 'Remove category');
      removeBtn.onclick = () => {
        row.remove();
        refreshButtons();
        refreshCategoryDropdowns();
        updateChart();
      };
      row.appendChild(removeBtn);
    }

    // Comparison statement checkboxes are now active (max 2)
    if (rows.length >= 2) {
      const comparisonWrap = document.createElement('label');
      comparisonWrap.className = 'comparison-checkbox-wrap';
      comparisonWrap.title = 'Toggle to include this category in the comparison statement';

      const comparisonCheckbox = document.createElement('input');
      comparisonCheckbox.type = 'checkbox';
      comparisonCheckbox.className = 'category-checkbox comparison-checkbox';

      // Determine checked state
      const rowIndex = Array.from(rows).indexOf(row);

      // Priority: 1) Preserve existing state, 2) Use URL flags on initial load, 3) Default to first two rows
      if (existingCheckbox) {
        comparisonCheckbox.checked = wasChecked;
      } else if (initialComparisonFlags.length > 0 && rowIndex < initialComparisonFlags.length) {
        comparisonCheckbox.checked = initialComparisonFlags[rowIndex];
      } else {
        comparisonCheckbox.checked = false;
      }

      comparisonCheckbox.addEventListener('change', (event) => refreshCheckboxes(event.target, {
        scheduleRedraw: true,
        reason: 'comparison-checkbox'
      }));

      const checkboxLabel = document.createElement('span');
      checkboxLabel.className = 'comparison-checkbox-label';
      checkboxLabel.textContent = 'Compare';

      comparisonWrap.appendChild(comparisonCheckbox);
      comparisonWrap.appendChild(checkboxLabel);
      row.appendChild(comparisonWrap);
    }
  });
  
  // Clear initialComparisonFlags after first use
  if (initialComparisonFlags.length > 0) {
    initialComparisonFlags = [];
  }
  
  // Align the comparison header with the checkboxes
  // alignComparisonHeader();
  
  // Apply checkbox limit logic (disable unchecked boxes if 2 are already checked)
  refreshCheckboxes();

  // Add "Add Category" button just below the last category box
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
    addBtn.disabled = true;
    addBtn.textContent = 'Maximum 10 categories';
  } else {
    addBtn.disabled = false;
    addBtn.innerHTML = '<span class="add-icon" aria-hidden="true"></span> Add Category';
  }
  
}

// Ensure checkboxes are only checked for two categories at once
function refreshCheckboxes(triggeredCheckbox = null, options = {}) {
  const { scheduleRedraw = false, reason = 'comparison-toggle' } = options || {};
  const checkboxes = Array.from(document.querySelectorAll('.comparison-checkbox'));
  const checkboxOrder = new Map();
  checkboxes.forEach((checkbox, index) => checkboxOrder.set(checkbox, index));

  const getCheckedBoxes = () => checkboxes.filter(checkbox => checkbox.checked);
  let checkedBoxes = getCheckedBoxes();

  while (checkedBoxes.length > 2) {
    let candidates = checkedBoxes;
    if (triggeredCheckbox && triggeredCheckbox.checked) {
      const others = checkedBoxes.filter(checkbox => checkbox !== triggeredCheckbox);
      if (others.length) {
        candidates = others;
      }
    }

    candidates.sort((a, b) => checkboxOrder.get(a) - checkboxOrder.get(b));
    const toUncheck = candidates[0];
    if (!toUncheck) {
      break;
    }
    toUncheck.checked = false;
    checkedBoxes = getCheckedBoxes();
  }

  // Always keep remaining checkboxes enabled so users can change selections freely
  checkboxes.forEach(checkbox => {
    checkbox.disabled = false;
    checkbox.style.opacity = '1';
    checkbox.style.cursor = 'pointer';
  });
  
  if (scheduleRedraw) {
    const checkedMeta = checkedBoxes.map(checkbox => {
      const row = checkbox.closest('.categoryRow');
      const select = row?.querySelector('select');
      return {
        index: checkboxOrder.get(checkbox),
        category: select?.value || null
      };
    });
    comparisonDebugLog('comparison checkbox change', {
      reason,
      checkedMeta,
      totalRows: checkboxes.length
    });
    scheduleComparisonRedraw(reason);
    try {
      updateURL();
    } catch (error) {
      console.warn('Comparison toggle URL update failed:', error);
    }
  }
}

// Return the category names (display titles) that are currently selected for comparison
function getComparisonSelections() {
  const rows = document.querySelectorAll('#categoryContainer .categoryRow');
  return Array.from(rows)
    .map(row => {
      const checkbox = row.querySelector('.comparison-checkbox');
      const select = row.querySelector('select');
      if (checkbox && checkbox.checked && select && select.value) {
        return select.value;
      }
      return null;
    })
    .filter(Boolean);
}

async function syncComparisonStatement({
  selectedCategoryIds = null,
  allCategories = null,
  comparisonSelections = null,
  dataPoints = null
} = {}) {
  if (!selectedYear || !selectedPollutantId) {
    hideComparisonStatement();
    return;
  }

  const categoryList = Array.isArray(allCategories) && allCategories.length
    ? allCategories
    : (window.supabaseModule.allCategories || []);

  const resolvedCategoryIds = Array.isArray(selectedCategoryIds) && selectedCategoryIds.length
    ? selectedCategoryIds
    : (getSelectedCategories()
        .map(name => {
          const category = categoryList.find(g => getCategoryDisplayTitle(g) === name);
          return category ? category.id : null;
        })
        .filter(id => id !== null));

  if (!resolvedCategoryIds.length) {
    hideComparisonStatement();
    return;
  }

  const resolvedSelections = Array.isArray(comparisonSelections)
    ? comparisonSelections
    : getComparisonSelections();

  if (resolvedSelections.length < 2) {
    hideComparisonStatement();
    return;
  }

  const scatterData = Array.isArray(dataPoints)
    ? dataPoints
    : (window.supabaseModule.getScatterData(selectedYear, selectedPollutantId, resolvedCategoryIds) || []);

  const usedSelections = resolvedSelections.slice(0, 2);
  const comparisonData = [];

  usedSelections.forEach(name => {
    const categoryMatch = categoryList.find(g => getCategoryDisplayTitle(g) === name);
    if (!categoryMatch) {
      return;
    }

    const dataPoint = scatterData.find(dp => String(dp.categoryId) === String(categoryMatch.id));
    if (dataPoint) {
      const displayName = getCategoryDisplayTitle(categoryMatch);
      const color = window.Colors?.getColorForCategory
        ? window.Colors.getColorForCategory(displayName)
        : null;
      comparisonData.push({
        ...dataPoint,
        displayName,
        color
      });
    }
  });

  if (comparisonData.length < 2) {
    hideComparisonStatement();
    return;
  }

  const pollutantName = window.supabaseModule.getPollutantName(selectedPollutantId);
  const pollutantUnit = window.supabaseModule.getPollutantUnit(selectedPollutantId) || 'kt';
  const activityUnitId = window.supabaseModule.actDataPollutantId || window.supabaseModule.activityDataId;
  const activityUnit = (activityUnitId && window.supabaseModule.getPollutantUnit(activityUnitId)) || 'TJ';

  const enrichedComparisonData = comparisonData.map(dataPoint => ({
    ...dataPoint,
    emissionFactor: calculateEmissionFactor(dataPoint)
  }));

  const { leader: pollutionLeader, follower: pollutionFollower } = selectLeaderFollower(
    enrichedComparisonData,
    (dataPoint) => normalizeNumber(dataPoint?.pollutantValue)
  );

  const { leader: energyLeader, follower: energyFollower } = selectLeaderFollower(
    enrichedComparisonData,
    (dataPoint) => normalizeNumber(dataPoint?.actDataValue)
  );

  const { leader: efLeaderRaw, follower: efFollowerRaw } = selectLeaderFollower(
    enrichedComparisonData,
    (dataPoint) => Number(dataPoint?.emissionFactor)
  );

  let leftLeader = energyFollower;
  let leftFollower = energyLeader;

  if (!leftLeader || !leftFollower) {
    leftLeader = efLeaderRaw || pollutionLeader;
    leftFollower = efFollowerRaw || pollutionFollower;
  }

  const pollutionRatioSourceLeader = leftLeader && leftFollower ? leftLeader : pollutionLeader;
  const pollutionRatioSourceFollower = leftLeader && leftFollower ? leftFollower : pollutionFollower;

  let pollutionRatio = NaN;
  let pollutionRelation = null;

  if (pollutionRatioSourceLeader && pollutionRatioSourceFollower) {
    const leaderPollution = normalizeNumber(pollutionRatioSourceLeader.pollutantValue);
    const followerPollution = normalizeNumber(pollutionRatioSourceFollower.pollutantValue);

    if (Number.isFinite(leaderPollution) && Number.isFinite(followerPollution)) {
      if (leaderPollution < followerPollution) {
        pollutionRatio = safeRatio(followerPollution, leaderPollution);
        pollutionRelation = 'lower';
      } else {
        pollutionRatio = safeRatio(leaderPollution, followerPollution);
        pollutionRelation = 'higher';
      }
    }
  }

  const energyRatio = (energyLeader && energyFollower)
    ? safeRatio(energyLeader.actDataValue, energyFollower.actDataValue)
    : NaN;

  const warningPolluter = energyFollower;
  const warningBaseline = energyLeader;
  const warningFallback = leftFollower || pollutionFollower;

  let replacementDetails = null;
  let replacementPollution = null;
  let replacementInclusion = null;

  if (warningPolluter && warningBaseline) {
    replacementInclusion = await buildReplacementInclusionNote(warningPolluter, warningBaseline);
    const baselineOnlyEnergy = normalizeNumber(warningBaseline?.actDataValue);
    const polluterEmissionFactor = Number.isFinite(warningPolluter?.emissionFactor)
      ? warningPolluter.emissionFactor
      : calculateEmissionFactor(warningPolluter);

    if (replacementInclusion && Number.isFinite(baselineOnlyEnergy) && baselineOnlyEnergy > 0 && Number.isFinite(polluterEmissionFactor)) {
      replacementPollution = polluterEmissionFactor * baselineOnlyEnergy;
      replacementDetails = {
        polluter: warningPolluter,
        baseline: warningBaseline,
        emissionFactor: polluterEmissionFactor,
        totalActivity: baselineOnlyEnergy,
        calcSource: 'baseline-only'
      };
    }

    if (!replacementPollution) {
      const estimate = estimateReplacementPollution(warningPolluter, warningBaseline);
      if (estimate) {
        replacementDetails = {
          polluter: warningPolluter,
          baseline: warningBaseline,
          emissionFactor: estimate.emissionFactor,
          totalActivity: estimate.totalActivity,
          calcSource: 'ef'
        };
        replacementPollution = estimate.value;
      } else {
        const fallbackTotalEnergy = sumActivityValues(
          warningPolluter?.actDataValue,
          warningBaseline?.actDataValue
        );

        if (Number.isFinite(polluterEmissionFactor) && fallbackTotalEnergy > 0) {
          replacementPollution = polluterEmissionFactor * fallbackTotalEnergy;
          replacementDetails = {
            polluter: warningPolluter,
            baseline: warningBaseline,
            emissionFactor: polluterEmissionFactor,
            totalActivity: fallbackTotalEnergy,
            calcSource: 'fallback-energy'
          };
        } else if (warningFallback) {
          const ratioFallback = safeRatio(warningPolluter?.pollutantValue, warningFallback?.pollutantValue);
          const fallbackValue = Number.isFinite(ratioFallback)
            ? ratioFallback * warningFallback.pollutantValue
            : null;
          if (Number.isFinite(fallbackValue)) {
            replacementPollution = fallbackValue;
            replacementDetails = {
              polluter: warningPolluter,
              baseline: warningBaseline,
              emissionFactor: polluterEmissionFactor || null,
              totalActivity: fallbackTotalEnergy || null,
              calcSource: 'ratio-fallback'
            };
          }
        }
      }
    }
  }

  if (leftLeader && leftFollower && energyLeader && energyFollower) {
    const statement = {
      pollutantName,
      pollutantUnit,
      activityUnit,
      pollutionLeaderName: leftLeader.displayName,
      pollutionFollowerName: leftFollower.displayName,
      energyLeaderName: energyLeader.displayName,
      energyFollowerName: energyFollower.displayName,
      pollutionRatio,
      pollutionRelation,
      energyRatio,
      replacementPollution,
      pollutionColor: leftLeader.color,
      energyColor: energyLeader.color,
      comparisonData: {
        leftPrimary: leftLeader,
        leftSecondary: leftFollower,
        energyPrimary: energyLeader,
        energySecondary: energyFollower
      },
      warningDetails: {
        polluter: warningPolluter,
        baseline: warningBaseline,
        totalActivity: replacementDetails?.totalActivity || sumActivityValues(
          warningPolluter?.actDataValue,
          warningBaseline?.actDataValue
        ) || null,
        emissionFactor: replacementDetails?.emissionFactor
          ?? (Number.isFinite(warningPolluter?.emissionFactor)
            ? warningPolluter.emissionFactor
            : calculateEmissionFactor(warningPolluter)),
        calcSource: replacementDetails?.calcSource || null,
        inclusion: replacementInclusion || null
      }
    };

    updateComparisonStatement(statement);
  } else {
    hideComparisonStatement();
  }
}

function safeRatio(numerator, denominator) {
  const num = Number(numerator);
  const den = Number(denominator);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return Infinity;
  }
  return num / den;
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

function normalizeNumber(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) {
      return NaN;
    }
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return parseFloat(cleaned);
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return NaN;
}

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDynamicNumber(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const abs = Math.abs(value);
  let maxFractionDigits = 3;
  if (abs > 0 && abs < 0.001) {
    maxFractionDigits = 9;
  } else if (abs < 1) {
    maxFractionDigits = 6;
  }

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits
  });
}

function getEmissionFactorConversionFactor(pollutantUnit) {
  const helperFactor = window.EmissionUnits?.getConversionFactor(pollutantUnit);
  if (Number.isFinite(helperFactor)) {
    return helperFactor;
  }
  const unit = typeof pollutantUnit === 'string' ? pollutantUnit.toLowerCase() : '';
  switch (unit) {
    case 't':
    case 'tonnes':
      return 1000; // t × 10^3 → g/GJ
    case 'grams international toxic equivalent':
      return 1000; // g × 10^3 → g/GJ (1 TJ = 1000 GJ)
    case 'kilotonne':
    case 'kilotonne/kt co2 equivalent':
    case 'kt co2 equivalent':
      return 1000000; // kt × 10^6 → g/GJ
    case 'kg':
      return 1; // kg/TJ = g/GJ
    default:
      console.warn('Unknown pollutant unit for EF conversion:', pollutantUnit);
      return 1000000;
  }
}

function convertEmissionFactorToGramsPerGJ(emissionFactor, pollutantUnit) {
  if (!Number.isFinite(emissionFactor)) {
    return null;
  }
  const factor = getEmissionFactorConversionFactor(pollutantUnit);
  return emissionFactor * factor;
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

function estimateReplacementPollution(replacementSource, baselineSource) {
  if (!replacementSource || !baselineSource) {
    return null;
  }

  const replacementPollution = normalizeNumber(replacementSource.pollutantValue);
  const replacementActivity = normalizeNumber(replacementSource.actDataValue);
  const baselineActivity = normalizeNumber(baselineSource.actDataValue);

  if (!Number.isFinite(replacementPollution) || !Number.isFinite(replacementActivity) || replacementActivity === 0) {
    return null;
  }

  const emissionFactor = calculateEmissionFactor({ pollutantValue: replacementPollution, actDataValue: replacementActivity });
  const totalActivity = sumActivityValues(replacementActivity, baselineActivity);

  if (!Number.isFinite(emissionFactor) || !Number.isFinite(totalActivity) || totalActivity <= 0) {
    return null;
  }

  const replacement = emissionFactor * totalActivity;
  if (!Number.isFinite(replacement)) {
    return null;
  }

  return {
    value: replacement,
    emissionFactor,
    totalActivity
  };
}

async function requestCategoryInclusionAssessment(candidateCategoryId, containerCategoryId) {
  if (!window.supabaseModule) {
    return null;
  }
  const childId = Number(candidateCategoryId);
  const parentId = Number(containerCategoryId);
  if (!Number.isFinite(childId) || !Number.isFinite(parentId)) {
    return null;
  }

  const assessor = typeof window.supabaseModule.assessCategoryInclusion === 'function'
    ? window.supabaseModule.assessCategoryInclusion
    : null;

  if (!assessor) {
    return null;
  }

  try {
    return await assessor(childId, parentId);
  } catch (error) {
    console.warn('Category inclusion assessment failed:', error);
    return null;
  }
}

async function buildReplacementInclusionNote(polluterDataPoint, baselineDataPoint) {
  if (!polluterDataPoint || !baselineDataPoint) {
    return null;
  }
  const assessment = await requestCategoryInclusionAssessment(
    polluterDataPoint.categoryId,
    baselineDataPoint.categoryId
  );
  if (assessment?.included) {
    const polluterName = polluterDataPoint.displayName || polluterDataPoint.categoryName;
    const baselineName = baselineDataPoint.displayName || baselineDataPoint.categoryName;
    if (polluterName && baselineName) {
      return {
        text: `${polluterName} is already included in ${baselineName}`,
        reason: assessment.reason || 'evaluated'
      };
    }
  }
  return null;
}

function selectLeaderFollower(dataPoints = [], metricAccessor = () => NaN) {
  if (!Array.isArray(dataPoints) || dataPoints.length < 2) {
    return { leader: null, follower: null };
  }

  const ranked = [...dataPoints].sort((a, b) => {
    const aValue = Number(metricAccessor(a));
    const bValue = Number(metricAccessor(b));
    const aValid = Number.isFinite(aValue);
    const bValid = Number.isFinite(bValue);

    if (!aValid && !bValid) {
      return 0;
    }
    if (!aValid) {
      return 1;
    }
    if (!bValid) {
      return -1;
    }
    return bValue - aValue;
  });

  const leader = ranked[0];
  const follower = ranked[1];

  const leaderValue = Number(metricAccessor(leader));
  const followerValue = Number(metricAccessor(follower));

  return {
    leader: Number.isFinite(leaderValue) ? leader : null,
    follower: Number.isFinite(followerValue) ? follower : null
  };
}

// Update checkbox behavior when adding a new category
function addCategoryRow() {
  const container = document.getElementById('categoryContainer');
  const newCategoryRow = document.createElement('div');
  newCategoryRow.className = 'categoryRow';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'category-checkbox';
  checkbox.checked = false; // Default unchecked for new categories

  newCategoryRow.appendChild(checkbox);
  container.appendChild(newCategoryRow);

  refreshCheckboxes();
}

/**
 * Setup category selector with dropdown approach like linechart
 */
function setupCategorySelector() {
  const container = document.getElementById('categoryContainer');
  container.innerHTML = '';
  
  // Don't add initial category here - let renderInitialView handle defaults
  // addCategorySelector();
}

/**
 * Update chart when selections change
 */
function updateChart(options = {}) {
  const { skipHeightUpdate = false } = options || {};
  // This will be called automatically when categories change

  // Reset the color system to ensure consistent color assignments
  window.Colors.resetColorSystem();

  // Get selected categories and assign colors
  const selectedCategoryNames = getSelectedCategories();
  const colors = selectedCategoryNames.map(categoryName => window.Colors.getColorForCategory(categoryName));

  // Redraw the chart to reflect the new selections
  drawChart(skipHeightUpdate);
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Year change
  document.getElementById('yearSelect').addEventListener('change', (e) => {
    selectedYear = e.target.value ? parseInt(e.target.value) : null;
    updateChart();
  });

  // Pollutant change
  document.getElementById('pollutantSelect').addEventListener('change', (e) => {
    selectedPollutantId = e.target.value ? parseInt(e.target.value) : null;
    updateChart();
  });

  // Share button
  document.getElementById('shareBtn').addEventListener('click', () => {
    window.ExportShare.showShareDialog();
  });

  // Download PNG button
  document.getElementById('downloadBtn').addEventListener('click', () => {
    window.ExportShare.downloadChartPNG();
  });

  // Download CSV button
  document.getElementById('downloadCSVBtn').addEventListener('click', () => {
    window.ExportShare.exportData('csv');
  });

  // Download Excel button
  document.getElementById('downloadXLSXBtn').addEventListener('click', () => {
    window.ExportShare.exportData('xlsx');
  });

  // Resize handler – only redraw when width/height change beyond threshold to avoid loops
  lastKnownViewportWidth = window.innerWidth || lastKnownViewportWidth;
  window.addEventListener('resize', debounce(() => {
    updateChartWrapperHeight('window-resize');
    const currentWidth = window.innerWidth || 0;
    const currentHeight = window.innerHeight || 0;
    const widthDelta = Math.abs(currentWidth - lastKnownViewportWidth);
    const heightDelta = Math.abs(currentHeight - lastKnownViewportHeight);
    if (widthDelta < RESIZE_THRESHOLD && heightDelta < RESIZE_THRESHOLD) {
      if (!pendingHeightPokeTimer) {
        pendingHeightPokeTimer = setTimeout(() => {
          pendingHeightPokeTimer = null;
          sendContentHeightToParent(true);
        }, 200);
      }
      return;
    }

    lastKnownViewportWidth = currentWidth;
    lastKnownViewportHeight = currentHeight;
    drawChart(true); // Pass skipHeightUpdate flag to prevent immediate update
    
    // After chart redraws and layout settles, check if height actually changed
    setTimeout(() => {
      const currentHeight = Math.max(
        document.body?.scrollHeight || 0,
        document.body?.offsetHeight || 0
      );
      if (lastSentHeight && Math.abs(currentHeight - lastSentHeight) >= MIN_HEIGHT_DELTA) {
        sendContentHeightToParent(true);
      }
    }, 200);
  }, 250));

  if (layoutHeightManager) {
    layoutHeightManager.observeWrapper((event = {}) => {
      const suppressed = shouldIgnoreWrapperObserverTick();
      comparisonDebugLog('wrapper observer event', {
        height: event.height,
        previous: event.previous,
        delta: event.delta,
        suppressed,
        pendingComparisonChromeHeight,
        comparisonStatementVisible
      });
      if (suppressed) {
        return;
      }
        comparisonDebugLog('wrapper observer tick triggered redraw', {
          pendingComparisonChromeHeight,
          comparisonStatementVisible
        });
      drawChart(true);
      sendContentHeightToParent(true);
    });
  }
}

function buildBubbleChartViewMeta({
  year,
  pollutantId,
  categoryIds = [],
  categoryNames = []
} = {}) {
  const pollutantName = pollutantId
    ? window.supabaseModule?.getPollutantName?.(pollutantId) || null
    : null;
  const normalizedQuery = (window.location.search || '').replace(/^[?]+/, '');
  const shareUrlBuilder = window.NAEIUrlState?.buildShareUrl;
  const shareUrl = typeof shareUrlBuilder === 'function'
    ? shareUrlBuilder(normalizedQuery)
    : `${window.location.origin}${window.location.pathname}${normalizedQuery ? `?${normalizedQuery}` : ''}`;

  return {
    pageSlug: '/bubblechart',
    year: year || null,
    pollutant: pollutantName,
    pollutant_id: pollutantId || null,
    categories: categoryNames,
    category_ids: categoryIds,
    category_count: categoryIds.length,
    query: normalizedQuery ? `?${normalizedQuery}` : null,
    share_url: shareUrl
  };
}

function publishBubbleChartViewMeta(meta) {
  if (!meta) {
    return;
  }
  window.__BUBBLE_CHART_VIEW_META__ = meta;
  try {
    window.dispatchEvent(new CustomEvent('bubbleChartViewMeta', { detail: meta }));
  } catch (error) {
    // Silently ignore dispatch failures (e.g., older browsers)
  }
}

/**
 * Draw the scatter chart
 * @param {boolean} skipHeightUpdate - If true, don't send height update to parent (for resize events)
 */
async function drawChart(skipHeightUpdate = false) {
  comparisonDebugLog('drawChart start', {
    skipHeightUpdate,
    pendingComparisonChromeHeight,
    comparisonStatementVisible
  });
  if (!chartRenderingUnlocked) {
    pendingDrawRequest = { skipHeightUpdate };
    return;
  }
  window.ChartRenderer.clearMessage();

  // Ensure category colors follow UI order every draw
  if (typeof window.Colors?.resetColorSystem === 'function') {
    window.Colors.resetColorSystem();
    const orderedNames = getSelectedCategories();
    orderedNames.forEach(name => window.Colors.getColorForCategory?.(name));
  }

  if (!selectedYear) {
    window.ChartRenderer.showMessage('Please select a year', 'warning');
    return;
  }

  if (!selectedPollutantId) {
    window.ChartRenderer.showMessage('Please select a pollutant', 'warning');
    return;
  }

  // Get selected categories from dropdowns
  const selectedCategoryNames = getSelectedCategories();
  
  if (selectedCategoryNames.length === 0) {
    window.ChartRenderer.showMessage('Please select at least one category', 'warning');
    return;
  }

  // Convert category names to IDs
  const allCategories = window.supabaseModule.allCategories || [];
  
  const selectedCategoryIds = selectedCategoryNames.map(name => {
    const category = allCategories.find(g => getCategoryDisplayTitle(g) === name);
    return category ? category.id : null;
  }).filter(id => id !== null);


  if (selectedCategoryIds.length === 0) {
    window.ChartRenderer.showMessage('Selected categories not found', 'warning');
    return;
  }

  await syncComparisonStatement({
    selectedCategoryIds,
    allCategories
  });

  const estimateContext = skipHeightUpdate ? 'drawChart-resume' : 'drawChart';
  const latestEstimate = updateChartWrapperHeight(estimateContext);
  if (Number.isFinite(latestEstimate)) {
    window.__BUBBLE_PRE_LEGEND_ESTIMATE = latestEstimate;
  }
  setPendingComparisonChromeHeight(false);
  comparisonDebugLog('drawChart height estimate complete', {
    estimateContext,
    latestEstimate,
    skipHeightUpdate
  });

  try {
    await window.ChartRenderer.drawBubbleChart(selectedYear, selectedPollutantId, selectedCategoryIds);
    comparisonDebugLog('drawChart render complete', {
      selectedYear,
      selectedPollutantId,
      categoryCount: selectedCategoryIds.length
    });
  } catch (error) {
    console.error('Bubble chart render failed:', error);
    window.ChartRenderer.showMessage('Unable to render the chart right now. Please try again.', 'error');
  }
  
  // Update URL
  updateURL();

  publishBubbleChartViewMeta(buildBubbleChartViewMeta({
    year: selectedYear,
    pollutantId: selectedPollutantId,
    categoryIds: selectedCategoryIds,
    categoryNames: selectedCategoryNames
  }));
  
  // Track chart draw event only when selections change to avoid inflated counts
  const nextSelectionKey = JSON.stringify({
    year: selectedYear,
    pollutantId: selectedPollutantId,
    categories: selectedCategoryIds
  });

  if (nextSelectionKey !== lastTrackedBubbleSelectionKey) {
    lastTrackedBubbleSelectionKey = nextSelectionKey;
    window.supabaseModule.trackAnalytics('bubblechart_drawn', {
      year: selectedYear,
      pollutant: window.supabaseModule.getPollutantName(selectedPollutantId),
      category_count: selectedCategoryIds.length,
      category_ids: selectedCategoryIds,
      categories: selectedCategoryNames
    });
  }

  // Only send height update if not triggered by resize (prevents growing gap)
  if (!skipHeightUpdate) {
    setTimeout(sendContentHeightToParent, 150);
  }
}

function scheduleComparisonRedraw(reason = 'comparison-toggle') {
  comparisonDebugLog('scheduleComparisonRedraw invoked', {
    reason,
    pendingComparisonChromeHeight,
    comparisonStatementVisible,
    hasPending: Boolean(pendingComparisonRedraw)
  });
  const raf = (window.requestAnimationFrame && window.requestAnimationFrame.bind(window))
    || (callback => setTimeout(callback, 16));
  const caf = (window.cancelAnimationFrame && window.cancelAnimationFrame.bind(window))
    || clearTimeout;
    const hadPending = Boolean(pendingComparisonRedraw);
  if (pendingComparisonRedraw) {
    caf(pendingComparisonRedraw);
  }
    comparisonDebugLog('queue comparison redraw', {
      reason,
      hadPending,
      pendingComparisonChromeHeight,
      comparisonStatementVisible
    });
  pendingComparisonRedraw = raf(() => {
    pendingComparisonRedraw = null;
      comparisonDebugLog('run comparison redraw', {
        reason,
        action: 'comparison-only',
        pendingComparisonChromeHeight,
        comparisonStatementVisible
      });
    Promise.resolve()
      .then(() => syncComparisonStatement())
      .catch(error => {
        console.error('Comparison redraw failed:', error, reason);
      });
  });
}

function scheduleComparisonChromeRefresh(reason = 'comparison-toggle') {
  const raf = (window.requestAnimationFrame && window.requestAnimationFrame.bind(window))
    || (callback => setTimeout(callback, 16));
  const caf = (window.cancelAnimationFrame && window.cancelAnimationFrame.bind(window))
    || clearTimeout;
    const hadPending = Boolean(pendingComparisonChromeRefresh);
  if (pendingComparisonChromeRefresh) {
    caf(pendingComparisonChromeRefresh);
  }
    comparisonDebugLog('queue comparison chrome refresh', {
      reason,
      hadPending,
      pendingComparisonChromeHeight
    });
  pendingComparisonChromeRefresh = raf(() => {
    pendingComparisonChromeRefresh = null;
      comparisonDebugLog('run comparison chrome refresh', {
        reason,
        pendingComparisonChromeHeight
      });
    const latestEstimate = updateChartWrapperHeight(reason);
    if (Number.isFinite(latestEstimate)) {
      window.__BUBBLE_PRE_LEGEND_ESTIMATE = latestEstimate;
    }
    let layoutRefreshResult = null;
    const refreshLayout = window.ChartRenderer?.refreshLayoutBounds;
    if (typeof refreshLayout === 'function') {
      try {
        layoutRefreshResult = refreshLayout({ reason });
      } catch (error) {
        console.warn('Chart wrapper refresh failed:', error);
      }
    }
      setPendingComparisonChromeHeight(false);
      comparisonDebugLog('comparison chrome refresh complete', {
        reason,
        latestEstimate,
        layoutRefreshResult
      });
    if (typeof sendContentHeightToParent === 'function') {
      setTimeout(() => sendContentHeightToParent(true), 80);
    }
  });
}

function setComparisonStatementVisibility(nextVisible, reason) {
  if (comparisonStatementVisible === nextVisible) {
    return;
  }
  comparisonStatementVisible = nextVisible;
  if (!nextVisible) {
    clearComparisonExportStore();
  } else if (window.__bubbleComparisonExport?.cards) {
    window.__bubbleComparisonExport.visible = true;
  }
  setPendingComparisonChromeHeight(true);
  suppressWrapperHeightObserver();
    comparisonDebugLog('comparison visibility change', {
      reason,
      nextVisible,
      pendingComparisonChromeHeight
    });
  scheduleComparisonChromeRefresh(reason);
}

function ensureComparisonDivExists() {
  let comparisonContainer = document.getElementById('comparisonContainer');
  if (!comparisonContainer) {
    comparisonContainer = document.createElement('div');
    comparisonContainer.id = 'comparisonContainer';
    comparisonContainer.style.textAlign = 'center';
    comparisonContainer.style.marginTop = '2px';
    
    const customLegend = document.getElementById('customLegend');
    if (customLegend) {
      customLegend.parentNode.insertBefore(comparisonContainer, customLegend.nextSibling);
    } else {
      console.error('customLegend element not found. Cannot append comparisonContainer.');
    }
  }

  let comparisonDiv = document.getElementById('comparisonDiv');
  if (!comparisonDiv) {
    comparisonDiv = document.createElement('div');
    comparisonDiv.id = 'comparisonDiv';
    comparisonDiv.className = 'comparison-statement';
    comparisonContainer.appendChild(comparisonDiv);
  }
  
  return comparisonDiv;
}

// Get custom display name for comparison statements
function getCategoryDisplayName(categoryName) {
  const displayNames = {
    'Ecodesign Stove - Ready To Burn': 'Ecodesign stoves burning Ready to Burn wood',
    'Gas Boilers': 'gas boilers'
  };
  if (displayNames[categoryName]) {
    return displayNames[categoryName];
  }
  return typeof categoryName === 'string' ? categoryName : '';
}

function updateComparisonStatement(statement) {
  const comparisonDiv = ensureComparisonDivExists();
  if (comparisonDiv) {
    const wasVisible = comparisonStatementVisible;
    comparisonDiv.style.display = 'block';

    const {
      pollutantName,
      pollutantUnit,
      activityUnit,
      pollutionLeaderName,
      pollutionFollowerName,
      energyLeaderName,
      energyFollowerName,
      pollutionRatio,
      pollutionRelation,
      energyRatio,
      replacementPollution,
      pollutionColor,
      energyColor,
      comparisonData = {},
      warningDetails = {}
    } = statement || {};

    const pollutantUnitMeta = window.EmissionUnits?.getUnitMeta(pollutantUnit);
    const activityUnitMeta = window.EmissionUnits?.getUnitMeta(activityUnit);
    const shouldOutlineCardText = (color) => Boolean(window.Colors?.shouldOutlineLightCard?.(color));
    const pollutionCardColor = pollutionColor || '#f5a000';
    const energyCardColor = energyColor || '#0a77c4';
    const pollutionCardClasses = `comparison-card${shouldOutlineCardText(pollutionCardColor) ? ' comparison-card--outline' : ''}`;
    const energyCardClasses = `comparison-card${shouldOutlineCardText(energyCardColor) ? ' comparison-card--outline' : ''}`;

    if (!pollutantName || !pollutionLeaderName || !pollutionFollowerName || !energyLeaderName || !energyFollowerName) {
      hideComparisonStatement();
      return;
    }

    const ratioIndicatesLower = pollutionRelation === 'lower'
      || (!pollutionRelation && Number.isFinite(pollutionRatio) && pollutionRatio < 1);

    const formatRatio = (value) => {
      if (!Number.isFinite(value)) return '∞';
      if (value >= 100) return value.toFixed(0);
      if (value >= 10) return value.toFixed(1);
      return value.toFixed(2);
    };

    const formatValueWithUnit = (value) => {
      if (!Number.isFinite(value)) {
        return { display: '—', valueText: '—', unitText: '' };
      }
      const formattedValue = value.toLocaleString(undefined, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0
      });
      const unitLabel = window.EmissionUnits?.formatValueLabel(pollutantUnitMeta || pollutantUnit, value) || '';
      const display = unitLabel ? `${formattedValue} ${unitLabel}` : formattedValue;
      return {
        display,
        valueText: formattedValue,
        unitText: unitLabel
      };
    };

    const formatDetailedPollution = (value, { context = 'value' } = {}) => {
      const formatted = formatDynamicNumber(value);
      if (formatted === null) return '—';
      const unitLabel = window.EmissionUnits?.formatValueLabel(
        pollutantUnitMeta || pollutantUnit,
        value,
        { context }
      ) || pollutantUnit || '';
      return unitLabel ? `${formatted} ${unitLabel}` : formatted;
    };

    const formatDetailedEnergy = (value, { useCalcUnit = false } = {}) => {
      const formatted = formatDynamicNumber(value);
      if (formatted === null) return '—';
      const unitLabel = window.EmissionUnits?.formatValueLabel(
        activityUnitMeta || activityUnit,
        value,
        { context: useCalcUnit ? 'calc' : 'value' }
      ) || activityUnit || 'TJ';
      return unitLabel ? `${formatted} ${unitLabel}` : formatted;
    };

    const formatEmissionFactorDetailed = (value) => {
      const converted = convertEmissionFactorToGramsPerGJ(value, pollutantUnit);
      if (!Number.isFinite(converted)) return '—';
      const formatted = formatDynamicNumber(converted);
      return formatted ? `${formatted} g/GJ` : '—';
    };

    const formatPercentChange = (value) => {
      if (!Number.isFinite(value)) {
        return null;
      }
      const absValue = Math.abs(value);
      let fractionDigits = 2;
      if (absValue >= 100) {
        fractionDigits = 0;
      } else if (absValue >= 10) {
        fractionDigits = 1;
      }
      return `${absValue.toLocaleString(undefined, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
      })}%`;
    };

    const getCategoryMetrics = (dataPoint) => {
      if (!dataPoint) {
        return null;
      }
      const emissionFactor = Number.isFinite(dataPoint.emissionFactor)
        ? dataPoint.emissionFactor
        : calculateEmissionFactor(dataPoint);
      return {
        name: dataPoint.displayName || dataPoint.categoryName || '',
        pollution: normalizeNumber(dataPoint.pollutantValue),
        energy: normalizeNumber(dataPoint.actDataValue),
        emissionFactor
      };
    };

    const buildCategoryTooltipEntry = (metrics) => {
      if (!metrics) {
        return '';
      }
      return `
        <div class="comparison-tooltip__entry">
          <div class="comparison-tooltip__name">${escapeHtml(metrics.name)}</div>
          <dl>
            <div>
              <dt>Pollution</dt>
              <dd>${formatDetailedPollution(metrics.pollution)}</dd>
            </div>
            <div>
              <dt>Energy</dt>
              <dd>${formatDetailedEnergy(metrics.energy)}</dd>
            </div>
            <div>
              <dt>Emission factor</dt>
              <dd>${formatEmissionFactorDetailed(metrics.emissionFactor)}</dd>
            </div>
          </dl>
        </div>
      `;
    };

    const buildCalcRow = (label, detailLines) => {
      if (!Array.isArray(detailLines) || !detailLines.length) {
        return '';
      }
      const detailHtml = detailLines
        .map((line, index) => `<span class="comparison-tooltip__calc-detail-line${index === 0 ? ' comparison-tooltip__calc-detail-line--primary' : ''}">${escapeHtml(line)}</span>`)
        .join('');
      return `
        <div class="comparison-tooltip__calc-row">
          <span>${escapeHtml(label)}</span>
          <span class="comparison-tooltip__calc-detail">${detailHtml}</span>
        </div>
      `;
    };

    const buildCalcNote = (message) => {
      if (!message) {
        return '';
      }
      return `<div class="comparison-tooltip__note"><strong>Note: ${escapeHtml(message)}</strong></div>`;
    };

    const leftPrimaryMetrics = getCategoryMetrics(comparisonData.leftPrimary);
    const leftSecondaryMetrics = getCategoryMetrics(comparisonData.leftSecondary);
    const energyPrimaryMetrics = getCategoryMetrics(comparisonData.energyPrimary);
    const energySecondaryMetrics = getCategoryMetrics(comparisonData.energySecondary);

    const pollutionNumeratorValue = pollutionRelation === 'lower'
      ? leftSecondaryMetrics?.pollution
      : leftPrimaryMetrics?.pollution;
    const pollutionDenominatorValue = pollutionRelation === 'lower'
      ? leftPrimaryMetrics?.pollution
      : leftSecondaryMetrics?.pollution;

    const pollutionFormulaLines = [];
    if (Number.isFinite(pollutionRatio)
      && Number.isFinite(pollutionNumeratorValue)
      && Number.isFinite(pollutionDenominatorValue)) {
      const numeratorLabel = formatDetailedPollution(pollutionNumeratorValue, { context: 'calc' });
      const denominatorLabel = formatDetailedPollution(pollutionDenominatorValue, { context: 'calc' });
      pollutionFormulaLines.push(`${numeratorLabel} ÷ ${denominatorLabel} = ${formatRatio(pollutionRatio)}x`);
      const pollutionDirection = ratioIndicatesLower ? '(lower pollution)' : '(higher pollution)';
      pollutionFormulaLines.push(pollutionDirection);
    }

    const energyFormulaLines = [];
    if (Number.isFinite(energyRatio)
      && Number.isFinite(energyPrimaryMetrics?.energy)
      && Number.isFinite(energySecondaryMetrics?.energy)) {
      energyFormulaLines.push(`${formatDetailedEnergy(energyPrimaryMetrics.energy, { useCalcUnit: true })} ÷ ${formatDetailedEnergy(energySecondaryMetrics.energy, { useCalcUnit: true })} = ${formatRatio(energyRatio)}x`);
      const energyDirection = Number.isFinite(energyRatio) && energyRatio < 1 ? '(lower energy)' : '(higher energy)';
      energyFormulaLines.push(energyDirection);
    }

    const buildComparisonTooltip = () => {
      if (!leftPrimaryMetrics || !leftSecondaryMetrics) {
        return '';
      }
      const calcMarkup = [
        buildCalcRow('Pollution ratio', pollutionFormulaLines),
        buildCalcRow('Energy ratio', energyFormulaLines)
      ].filter(Boolean).join('');
      return `
        <div class="comparison-tooltip" role="tooltip" aria-hidden="true">
          <div class="comparison-tooltip__heading">Detailed values</div>
          <div class="comparison-tooltip__grid">
            ${buildCategoryTooltipEntry(leftPrimaryMetrics)}
            ${buildCategoryTooltipEntry(leftSecondaryMetrics)}
          </div>
          ${calcMarkup ? `<div class="comparison-tooltip__calc">${calcMarkup}</div>` : ''}
        </div>
      `;
    };

    const warningPolluterMetrics = getCategoryMetrics(warningDetails.polluter);
    const warningBaselineMetrics = getCategoryMetrics(warningDetails.baseline);
    const warningTotalEnergy = normalizeNumber(warningDetails.totalActivity);
    const warningEmissionFactor = Number.isFinite(warningDetails.emissionFactor)
      ? warningDetails.emissionFactor
      : warningPolluterMetrics?.emissionFactor;
    const usesBaselineOnlyCalc = warningDetails?.calcSource === 'baseline-only';

    const energyDetailLines = (() => {
      if (!Number.isFinite(warningTotalEnergy)) {
        return ['Calculation unavailable for this selection'];
      }
      const formattedTotalEnergy = formatDetailedEnergy(warningTotalEnergy, { useCalcUnit: true }) || '—';
      if (usesBaselineOnlyCalc && Number.isFinite(warningBaselineMetrics?.energy)) {
        const baselineOnly = formatDetailedEnergy(warningBaselineMetrics.energy, { useCalcUnit: true }) || '—';
        return [`${baselineOnly} (baseline energy)`];
      }
      const formatEnergyOperand = (metrics) => {
        if (!metrics || !Number.isFinite(metrics.energy)) {
          return null;
        }
        return formatDetailedEnergy(metrics.energy, { useCalcUnit: true }) || '—';
      };
      const polluterOperand = formatEnergyOperand(warningPolluterMetrics);
      const baselineOperand = formatEnergyOperand(warningBaselineMetrics);
      if (polluterOperand && baselineOperand) {
        return [`${polluterOperand} + ${baselineOperand} = ${formattedTotalEnergy}`];
      }
      return [formattedTotalEnergy];
    })();

    const warningFormulaSummary = (Number.isFinite(warningTotalEnergy)
      && Number.isFinite(warningEmissionFactor)
      && Number.isFinite(replacementPollution))
      ? `${formatDetailedEnergy(warningTotalEnergy, { useCalcUnit: true })} x ${formatEmissionFactorDetailed(warningEmissionFactor)} = ${formatDetailedPollution(replacementPollution, { context: 'calc' })}`
      : null;

    const inclusionNoteText = typeof warningDetails?.inclusion?.text === 'string'
      ? warningDetails.inclusion.text
      : null;
    const pollutionEstimateLines = warningFormulaSummary
      ? [warningFormulaSummary]
      : ['Calculation unavailable for this selection'];

    const buildWarningTooltip = () => {
      if (!warningPolluterMetrics || !warningBaselineMetrics) {
        return '';
      }
      const warningCalcMarkup = [
          inclusionNoteText ? buildCalcNote(inclusionNoteText) : buildCalcRow('Energy', energyDetailLines),
          buildCalcRow('Pollution estimate', pollutionEstimateLines)
        ].filter(Boolean).join('');

      return `
        <div class="comparison-tooltip comparison-tooltip--warning" role="tooltip" aria-hidden="true">
          <div class="comparison-tooltip__heading">Replacement calculation</div>
          <div class="comparison-tooltip__grid">
            ${buildCategoryTooltipEntry(warningPolluterMetrics)}
            ${buildCategoryTooltipEntry(warningBaselineMetrics)}
          </div>
          ${warningCalcMarkup ? `<div class="comparison-tooltip__calc">${warningCalcMarkup}</div>` : ''}
        </div>
      `;
    };

    const sharedTooltipMarkup = buildComparisonTooltip();
    const warningTooltipMarkup = buildWarningTooltip();

    const warningValueParts = formatValueWithUnit(replacementPollution);
    const warningValueHtml = warningValueParts.display === '—'
      ? '—'
      : `<span class="comparison-warning-value">${escapeHtml(warningValueParts.valueText)}${warningValueParts.unitText ? ` <span class="comparison-warning-unit">${escapeHtml(warningValueParts.unitText)}</span>` : ''}</span>`;

    const baselinePollutionSource = warningDetails?.baseline || comparisonData?.leftSecondary || null;
    const followerPollutionValue = normalizeNumber(baselinePollutionSource?.pollutantValue);
    const polluterPollutionValue = normalizeNumber(warningDetails?.polluter?.pollutantValue);
    const polluterIncludedInBaseline = Boolean(warningDetails?.inclusion);
    const percentBaselinePollution = (() => {
      // If the polluter is separate from the baseline category, use the combined
      // historical pollution so the replacement delta reflects the whole system.
      if (!Number.isFinite(followerPollutionValue)) {
        return Number.isFinite(polluterPollutionValue) ? polluterPollutionValue : null;
      }
      if (polluterIncludedInBaseline || !Number.isFinite(polluterPollutionValue)) {
        return followerPollutionValue;
      }
      return followerPollutionValue + polluterPollutionValue;
    })();
    const percentChangeValue = (Number.isFinite(percentBaselinePollution)
      && Math.abs(percentBaselinePollution) > 0
      && Number.isFinite(replacementPollution))
      ? ((replacementPollution - percentBaselinePollution) / Math.abs(percentBaselinePollution)) * 100
      : null;
    const warningChangeMeta = (() => {
      if (!Number.isFinite(percentChangeValue) || percentChangeValue === 0) {
        return null;
      }
      const isIncrease = percentChangeValue > 0;
      const directionLabel = isIncrease ? 'INCREASE' : 'decrease';
      const formattedPercent = formatPercentChange(percentChangeValue);
      if (!formattedPercent) {
        return null;
      }
      const article = isIncrease ? 'an' : 'a';
      const plainText = `This is ${article} ${directionLabel} of ${formattedPercent}`;
      const percentHtml = `<span class="comparison-warning-percent">${escapeHtml(formattedPercent)}</span>`;
      const directionHtml = `<span class="comparison-warning-direction ${isIncrease ? 'comparison-warning-direction--increase' : 'comparison-warning-direction--decrease'}">${escapeHtml(directionLabel)}</span>`;
      const html = `This is ${escapeHtml(article)} ${directionHtml} of ${percentHtml}`;
      return {
        text: plainText,
        value: percentChangeValue,
        direction: directionLabel,
        html
      };
    })();
    const warningChangeText = warningChangeMeta?.text || null;
    const warningChangeDisplayHtml = warningChangeMeta?.html || null;

    const pollutionLeaderLabel = `<span class="comparison-warning-entity">${escapeHtml(pollutionLeaderName)}</span>`;
    const energyLeaderLabel = `<span class="comparison-warning-entity">${escapeHtml(energyLeaderName)}</span>`;

    const pollutionArrowClass = ratioIndicatesLower ? 'comparison-arrow down green' : 'comparison-arrow up red';
    const pollutionRatioLine = `${formatRatio(pollutionRatio)} times`;
    const pollutionRatioFollowerLine = pollutionFollowerName
      ? (ratioIndicatesLower ? `lower than ${pollutionFollowerName}` : `higher than ${pollutionFollowerName}`)
      : (ratioIndicatesLower ? 'lower pollution' : 'higher pollution');

    const energyFollowerLine = energyFollowerName || '';
    const energyTrend = Number.isFinite(energyRatio) && energyRatio < 1 ? 'lower' : 'higher';
    const energyRatioLine = `${formatRatio(energyRatio)} times`;

    const buildMetricCardData = (metrics) => {
      if (!metrics) {
        return null;
      }
      return {
        name: metrics.name || '—',
        pollution: formatDetailedPollution(metrics.pollution),
        energy: formatDetailedEnergy(metrics.energy),
        emissionFactor: formatEmissionFactorDetailed(metrics.emissionFactor)
      };
    };

    const exportMetricCards = [
      buildMetricCardData(leftPrimaryMetrics),
      buildMetricCardData(leftSecondaryMetrics)
    ].filter(Boolean);


    // Only include the Energy calculation if there is no inclusion note
    const calculationBlocks = [
      { title: 'Pollution ratio', lines: pollutionFormulaLines },
      { title: 'Energy ratio', lines: energyFormulaLines }
    ];
    if (!inclusionNoteText && energyDetailLines.length) {
      calculationBlocks.push({ title: 'Energy', lines: energyDetailLines, showEnergy: true });
    }
    // If inclusion note is present, do NOT add the energy calculation
    calculationBlocks.push({ title: 'Pollution estimate', lines: pollutionEstimateLines });
    const filteredCalculationBlocks = calculationBlocks.filter(block => Array.isArray(block.lines) && block.lines.length);

    const comparisonWarningText = (pollutionLeaderName && energyLeaderName)
      ? `If ${pollutionLeaderName} replaced ${energyLeaderName}, ${pollutantName} pollution would be ${warningValueParts.display}`
      : null;

    const warningChangeHtml = warningChangeDisplayHtml
      ? `<br><span class="comparison-warning-change">${warningChangeDisplayHtml}</span>`
      : '';

    setComparisonExportStore(buildComparisonExportPayload({
      pollutionCard: {
        title: pollutionLeaderName,
        subtitle: `${pollutantName} pollution`,
        ratioLine: pollutionRatioLine,
        followerLine: pollutionRatioFollowerLine,
        color: pollutionCardColor,
        trend: ratioIndicatesLower ? 'lower' : 'higher'
      },
      energyCard: {
        title: energyLeaderName,
        subtitle: 'Energy',
        ratioLine: energyRatioLine,
        followerLine: energyFollowerLine,
        color: energyCardColor,
        trend: energyTrend
      },
      warningText: comparisonWarningText,
      warningValueDisplay: warningValueParts.display,
      warningValueParts,
      warningContext: {
        polluterName: pollutionLeaderName,
        baselineName: energyLeaderName,
        pollutantName,
        changePercent: warningChangeMeta?.value || null
      },
      warningChangeText,
      metricCards: exportMetricCards,
      calculationBlocks: filteredCalculationBlocks,
      inclusionNoteText,
      inclusionNoteLabel: inclusionNoteText ? 'Note: ' : null,
      inclusionNoteDetails: inclusionNoteText ? energyDetailLines : null,
      shouldReplaceEnergyCalc: Boolean(inclusionNoteText)
    }));

    const warningPrimaryHtml = `If ${pollutionLeaderLabel} replaced ${energyLeaderLabel}, ${pollutantName} pollution would be ${warningValueHtml}`;
    const warningDisplayHtml = `${warningPrimaryHtml}${warningChangeHtml}`;

    const comparisonDivMarkup = `
      <div class="comparison-layout">
        <div class="comparison-row">
          <div class="${pollutionArrowClass}" aria-hidden="true"></div>
          <div class="${pollutionCardClasses}" tabindex="0" aria-label="${escapeHtml(`Show detailed pollution metrics for ${pollutionLeaderName}`)}" style="background:${pollutionCardColor};">
            <div class="comparison-card-line comparison-card-line-large">${pollutionLeaderName}</div>
            <div class="comparison-card-line comparison-card-line-small">${pollutantName} pollution</div>
            <div class="comparison-card-line comparison-card-line-large">${pollutionRatioLine}</div>
            <div class="comparison-card-line comparison-card-line-small">${pollutionRatioFollowerLine}</div>
            ${sharedTooltipMarkup}
          </div>
          <div class="${energyCardClasses}" tabindex="0" aria-label="${escapeHtml(`Show detailed energy metrics for ${energyLeaderName}`)}" style="background:${energyCardColor};">
            <div class="comparison-card-line comparison-card-line-large">${energyLeaderName}</div>
            <div class="comparison-card-line comparison-card-line-small">Energy</div>
            <div class="comparison-card-line comparison-card-line-large">${energyRatioLine}</div>
            <div class="comparison-card-line comparison-card-line-small">${energyFollowerLine}</div>
            ${sharedTooltipMarkup}
          </div>
          <div class="comparison-arrow up green" aria-hidden="true"></div>
        </div>

        <div class="comparison-warning-wrap">
          <div class="comparison-warning-icon" aria-hidden="true"></div>
          <div class="comparison-warning-row" tabindex="0" aria-label="${escapeHtml('Show calculation behind the replacement warning')}">
            <div class="comparison-warning-text">${warningDisplayHtml}</div>
            ${warningTooltipMarkup}
          </div>
          <div class="comparison-warning-icon" aria-hidden="true"></div>
        </div>
      </div>
    `;
    const measuredChromeHeight = updateComparisonMeasurement(comparisonDivMarkup);
    comparisonDiv.innerHTML = comparisonDivMarkup;
    comparisonDiv.className = 'comparison-statement';
    const visibleComparisonHeight = getElementHeight(comparisonDiv);
    if (Number.isFinite(visibleComparisonHeight) && visibleComparisonHeight >= 0) {
      persistComparisonChromeHeight(visibleComparisonHeight);
    } else if (Number.isFinite(measuredChromeHeight)) {
      persistComparisonChromeHeight(measuredChromeHeight);
    }

      if (wasVisible) {
        setPendingComparisonChromeHeight(true);
      suppressWrapperHeightObserver();
      scheduleComparisonChromeRefresh('comparison-update');
    }

    setComparisonStatementVisibility(true, wasVisible ? 'comparison-update' : 'comparison-show');
      comparisonDebugLog('comparison statement rendered', {
        wasVisible,
        pollutionLeader: comparisonData?.leftPrimary?.displayName || pollutionLeaderName,
        energyLeader: comparisonData?.energyPrimary?.displayName || energyLeaderName,
        pendingComparisonChromeHeight,
        measuredChromeHeight
      });
  }
}

function buildComparisonExportPayload({
  pollutionCard,
  energyCard,
  warningText,
  warningValueDisplay,
  warningValueParts = null,
  warningContext = null,
  warningChangeText = null,
  metricCards,
  calculationBlocks,
  inclusionNoteText,
  inclusionNoteLabel,
  inclusionNoteDetails,
  shouldReplaceEnergyCalc = false
}) {
  if (!pollutionCard || !energyCard) {
    return null;
  }

  const applyCardDefaults = (card, fallbackColor) => ({
    title: card.title || '—',
    subtitle: card.subtitle || '',
    ratioLine: card.ratioLine || '—',
    followerLine: card.followerLine || '',
    color: card.color || fallbackColor,
    trend: card.trend === 'lower' ? 'lower' : 'higher'
  });

  return {
    cards: {
      left: applyCardDefaults(pollutionCard, '#f26522'),
      right: applyCardDefaults(energyCard, '#0a77c4')
    },
    warning: warningText ? {
      text: warningText,
      valueDisplay: warningValueDisplay || warningValueParts?.display || warningText,
      valueText: warningValueParts?.valueText || null,
      valueUnit: warningValueParts?.unitText || '',
      polluterName: warningContext?.polluterName || null,
      baselineName: warningContext?.baselineName || null,
      pollutantName: warningContext?.pollutantName || null,
      changeText: warningChangeText || null,
      changePercent: warningContext?.changePercent ?? null
    } : null,
    metrics: Array.isArray(metricCards) ? metricCards : [],
    calcBlocks: Array.isArray(calculationBlocks) ? calculationBlocks : [],
    inclusionNote: inclusionNoteText || null,
    inclusionNoteLabel: inclusionNoteLabel || null,
    inclusionNoteDetails: Array.isArray(inclusionNoteDetails) ? inclusionNoteDetails.filter(Boolean) : null,
    shouldReplaceEnergyCalc
  };
}

/**
 * Hide the comparison statement
 */
function hideComparisonStatement() {
  const comparisonDiv = document.getElementById('comparisonDiv');
  if (comparisonDiv) {
    comparisonDiv.style.display = 'none';
    clearComparisonMeasurement();
    setComparisonStatementVisibility(false, 'comparison-hide');
      comparisonDebugLog('comparison statement hidden');
    clearComparisonExportStore();
  } else {
  }
}

/**
 * Show a notification message
 * @param {string} message - The message to display
 * @param {string} type - The type of notification (e.g., 'error', 'success')
 */
function showNotification(message, type) {
  const container = document.querySelector('.notification-container') || document.createElement('div');
  if (!container.className) {
    container.className = 'notification-container';
    document.body.appendChild(container);
  }

  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  container.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      notification.remove();
      if (!container.hasChildNodes()) {
        container.remove();
      }
    }, 300);
  }, 5000);
}

/**
 * Update URL with current parameters
 */
function updateURL() {
  const selectedCategoryNames = getSelectedCategories();
  if (!selectedYear || !selectedPollutantId || selectedCategoryNames.length === 0) {
    return;
  }

  // Convert category names to IDs for URL
  const allCategories = window.supabaseModule.allCategories || [];
  const categoryRows = Array.from(document.querySelectorAll('.categoryRow'));

  const categoryIdsWithFlags = categoryRows.reduce((acc, row) => {
    const select = row.querySelector('select');
    const value = select?.value;
    if (!value) {
      return acc;
    }

    const category = allCategories.find(g => getCategoryDisplayTitle(g) === value);
    if (!category) {
      return acc;
    }

    const checkbox = row.querySelector('.comparison-checkbox');
    const isChecked = checkbox?.checked || false;
    acc.push(isChecked ? `${category.id}c` : `${category.id}`);
    return acc;
  }, []);

  if (!categoryIdsWithFlags.length) {
    return;
  }

  // Build params array - use raw strings to avoid encoding commas
  const params = [
    `pollutant_id=${selectedPollutantId}`,
    `category_ids=${categoryIdsWithFlags.join(',')}`,  // Comma NOT encoded
    `year=${selectedYear}`
  ];
  
  // Update iframe's own URL (for standalone use)
  const query = params.join('&');
  const newURL = window.location.pathname + '?' + query;
  window.history.replaceState({}, '', newURL);
  
  // Send message to parent to update its URL (for embedded use)
  // But ONLY if this is the active chart (chart=1 in parent URL)
  if (window.parent && window.parent !== window) {
    try {
      const parentParams = new URLSearchParams(window.parent.location.search);
      const chartParam = parentParams.get('chart');
      
      // Only send if chart=1 (bubble) or no chart param (default to bubble)
      if (!chartParam || chartParam === '1') {
        window.parent.postMessage({
          type: 'updateURL',
          params: params  // Send as array of raw strings
        }, '*');
      } else {
      }
    } catch (e) {
      // Cross-origin restriction - send anyway (standalone mode)
      window.parent.postMessage({
        type: 'updateURL',
        params: params
      }, '*');
    }
  }
}

/**
 * Load chart from URL parameters
 */
function loadFromURLParameters() {
  const params = new URLSearchParams(window.location.search);
  
  const year = params.get('year');
  const pollutantId = params.get('pollutant_id');
  const categoryIdsParam = params.get('category_ids')
    || params.get('categoryIds')
    || params.get('categoryId');

  if (year && pollutantId && categoryIdsParam) {
    selectedYear = parseInt(year);
    selectedPollutantId = parseInt(pollutantId);
    selectedCategoryIds = categoryIdsParam.split(',').map(id => parseInt(id));

    // Update UI
    document.getElementById('yearSelect').value = selectedYear;
    document.getElementById('pollutantSelect').value = selectedPollutantId;

    // Rebuild category selectors to match URL-provided IDs
    const categories = window.supabaseModule.allCategories || [];
    const selectedCategoryNames = selectedCategoryIds
      .map(id => categories.find(category => category.id === id))
      .filter(Boolean)
      .map(getCategoryDisplayTitle);

    const categoryContainer = document.getElementById('categoryContainer');
    if (categoryContainer && selectedCategoryNames.length) {
      categoryContainer.innerHTML = '';
      selectedCategoryNames.forEach(name => addCategorySelector(name, false));
      refreshCategoryDropdowns();
      refreshButtons();
    }
    
    refreshCheckboxes();

    // Draw chart automatically
    setTimeout(() => {
      drawChart();
    }, 500);
  }
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
  div.addEventListener('drop', () => { 
    refreshCategoryDropdowns(); 
    refreshButtons();
    updateChart(); 
  });
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

// Listen for parent window messages (iframe coordination)
window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') {
    return;
  }

  if (event.data.type === 'overlayHidden') {
    lastSentHeight = 0; // allow re-measurement after parent finishes layout work
    setTimeout(() => sendContentHeightToParent(true), 100);
  }

  if (event.data.type === 'requestHeight') {
    lastSentHeight = 0; // ensure we re-send the latest measurement on explicit request
    sendContentHeightToParent(true);
  }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Align comparison header with checkboxes
function alignComparisonHeader() {
  const header = document.getElementById('comparisonHeader');
  const checkboxes = document.querySelectorAll('.comparison-checkbox');
  
  // Hide header if there are fewer than 2 categories
  const rows = document.querySelectorAll('.categoryRow');
  
  if (!header) {
    return;
  }
  
  if (rows.length < 2) {
    header.style.display = 'none';
    return;
  }
  
  // Only show and position header if we have checkboxes to align with
  if (checkboxes.length > 0) {
    header.style.display = 'block';
    
    const firstCheckbox = checkboxes[0];
    const containerRect = header.parentElement.getBoundingClientRect();
    
    // Calculate center position of all checkboxes
    let totalLeft = 0;
    checkboxes.forEach(checkbox => {
      const rect = checkbox.getBoundingClientRect();
      totalLeft += rect.left + (rect.width / 2); // Center of each checkbox
    });
    const averageCenterX = totalLeft / checkboxes.length;
    
    // Center the header horizontally with the average checkbox position
    const headerWidth = 80; // Approximate width of "Comparison Statement"
    const leftOffset = (averageCenterX - containerRect.left) - (headerWidth / 2);
    
    // Position header above first checkbox (moved up more)
    const firstCheckboxRect = firstCheckbox.getBoundingClientRect();
    const topOffset = firstCheckboxRect.top - containerRect.top - 45; // Increased from 35px to 45px
    
    header.style.left = leftOffset + 'px';
    header.style.top = topOffset + 'px';
  } else {
    header.style.display = 'none';
  }
}
