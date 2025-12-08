/**
 * Lightweight site-wide analytics helper.
 * Tracks only page views and high-value interactions.
 */
(function () {
  'use strict';

  const TABLE_NAME = 'site_events';
  const ERROR_TABLE_NAME = 'site_errors';
  const ERROR_SEVERITIES = new Set(['warning', 'error', 'critical']);
  const SESSION_KEY = 'cic_site_session_id';
  const RESERVED_FIELDS = new Set(['label', 'event_label', 'pageSlug', 'page_slug', 'skipActivityTouch']);
  const MAX_QUEUE_LENGTH = 25;
  const FLUSH_DELAY_MS = 2000;
  const HEARTBEAT_INTERVAL_MS = 30000;
  const HEARTBEAT_IDLE_TIMEOUT_MS = 60000;
  const PAGE_HEARTBEAT_LABELS = new Map([
    ['/bubblechart', 'bubblechart_page_seen'],
    ['/linechart', 'linechart_page_seen'],
    ['/category-info', 'category_info_page_seen'],
    ['/resources-embed', 'resources_embed_page_seen'],
    ['/user-guide', 'user_guide_page_seen']
  ]);
  const HEARTBEAT_LABELS = new Set(PAGE_HEARTBEAT_LABELS.values());
  const PASSIVE_ACTIVITY_EVENTS = ['pointermove', 'wheel', 'scroll', 'keydown', 'touchstart'];
  const PASSIVE_ACTIVITY_THROTTLE_MS = 2500;
  const SYSTEM_EVENT_LABELS = new Set([
    'page_drawn',
    'sbase_data_queried',
    'sbase_data_loaded',
    'sbase_data_error',
    'bubblechart_drawn',
    'linechart_drawn'
  ]);

  const searchParams = buildSearchParams();
  const debugEnabled = ['debug', 'debugLogs', 'analyticsDebug', 'logs']
    .some(flag => searchParams.has(flag));
  const analyticsDisabled = searchParams.get('analytics') === 'off';
  const logDebug = debugEnabled ? console.log.bind(console, '[Analytics]') : () => {};

  const eventQueue = [];
  let flushTimer = null;
  let pendingFlush = null;
  let cachedRestBaseUrl = null;
  let cachedKey = null;
  const endpointCache = new Map();
  let autoPageDrawnSent = false;
  let heartbeatTimer = null;
  let heartbeatEligible = false;
  let heartbeatRunning = false;
  let heartbeatCount = 0;
  let passiveListenersRegistered = false;
  let lastPassiveActivityAt = 0;

  const state = {
    sessionId: loadSessionId(),
    pageSlug: resolvePageSlug(),
    defaults: {},
    pageOpenedAt: Date.now(),
    lastInteractionAt: null
  };

  function runSoon(callback) {
    if (typeof callback !== 'function') {
      return;
    }
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(callback);
    } else {
      Promise.resolve().then(callback);
    }
  }

  /** Configure defaults before first event. */
  function configure(options = {}) {
    if (!options || typeof options !== 'object') {
      return;
    }
    if (typeof options.pageSlug === 'string' && options.pageSlug.trim()) {
      state.pageSlug = sanitizeSlug(options.pageSlug);
    }
    if (options.defaults && typeof options.defaults === 'object') {
      state.defaults = {
        ...state.defaults,
        ...options.defaults
      };
    }
  }

  configure(window.__SITE_ANALYTICS_PRESET__);

  function buildSearchParams() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (error) {
      return new URLSearchParams('');
    }
  }

  function loadSessionId() {
    try {
      const existing = window.sessionStorage.getItem(SESSION_KEY);
      if (existing) {
        return existing;
      }
      const nextId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(SESSION_KEY, nextId);
      return nextId;
    } catch (error) {
      return `sess_${Date.now().toString(36)}`;
    }
  }

  function sanitizeSlug(slug) {
    if (!slug || typeof slug !== 'string') {
      return resolvePageSlug();
    }
    const trimmed = slug.trim();
    if (!trimmed) {
      return resolvePageSlug();
    }
    if (trimmed.startsWith('http')) {
      try {
        return new URL(trimmed).pathname || '/';
      } catch (error) {
        return resolvePageSlug();
      }
    }
    if (!trimmed.startsWith('/')) {
      return `/${trimmed}`;
    }
    return trimmed.replace(/\/+/g, '/');
  }

  function resolvePageSlug() {
    const bodySlug = (document.body && document.body.dataset && document.body.dataset.pageSlug) || '';
    if (bodySlug) {
      return sanitizeSlug(bodySlug);
    }
    try {
      return window.location.pathname || '/';
    } catch (error) {
      return '/';
    }
  }

  function resolveHeartbeatLabel(slug) {
    const normalized = slug ? sanitizeSlug(slug) : sanitizeSlug(state.pageSlug);
    if (!normalized) {
      return null;
    }
    return PAGE_HEARTBEAT_LABELS.get(normalized) || null;
  }

  function isHeartbeatLabel(label) {
    return typeof label === 'string' && HEARTBEAT_LABELS.has(label);
  }

  function getUserCountry() {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const locale = navigator.language || 'en';
      const timezoneCountryMap = {
        'Europe/London': 'GB',
        'America/New_York': 'US',
        'America/Chicago': 'US',
        'America/Denver': 'US',
        'America/Los_Angeles': 'US',
        'Europe/Paris': 'FR',
        'Europe/Berlin': 'DE',
        'Europe/Rome': 'IT',
        'Europe/Madrid': 'ES',
        'Asia/Tokyo': 'JP',
        'Asia/Shanghai': 'CN',
        'Asia/Kolkata': 'IN',
        'Australia/Sydney': 'AU',
        'Australia/Melbourne': 'AU',
        'America/Toronto': 'CA',
        'America/Vancouver': 'CA'
      };
      return timezoneCountryMap[timezone] || (locale.split('-')[1] || 'Unknown');
    } catch (error) {
      return 'Unknown';
    }
  }

  function buildViewportInfo() {
    try {
      const screenInfo = `${window.screen.width}x${window.screen.height}`;
      const viewportInfo = `${window.innerWidth}x${window.innerHeight}`;
      return { screen: screenInfo, viewport: viewportInfo };
    } catch (error) {
      return { screen: null, viewport: null };
    }
  }

  function sanitizeEventData(meta) {
    if (!meta || typeof meta !== 'object') {
      return null;
    }
    const clean = {};
    Object.keys(meta).forEach(key => {
      if (RESERVED_FIELDS.has(key)) {
        return;
      }
      const value = meta[key];
      if (value === undefined || typeof value === 'function') {
        return;
      }
      clean[key] = value;
    });
    if (!Object.keys(clean).length) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(clean, (_, value) => {
        if (typeof value === 'function') {
          return undefined;
        }
        if (typeof value === 'bigint') {
          return Number(value);
        }
        return value;
      }));
    } catch (error) {
      return null;
    }
  }

  function buildRecord(eventType, meta = {}) {
    if (!eventType || analyticsDisabled) {
      return null;
    }
    const now = new Date().toISOString();
    const pageSlug = sanitizeSlug(meta.pageSlug || state.pageSlug);
    const data = sanitizeEventData({ ...state.defaults, ...meta, client_timestamp: now });
    const label = meta.label || meta.event_label || null;
    return {
      session_id: state.sessionId,
      event_timestamp: now,
      page_slug: pageSlug,
      event_type: eventType,
      event_label: label,
      country: getUserCountry(),
      page_url: window.location ? window.location.href : null,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent,
      event_data: data
    };
  }

  function queueEvent(record) {
    if (!record) {
      return false;
    }
    if (eventQueue.length >= MAX_QUEUE_LENGTH) {
      eventQueue.shift();
    }
    eventQueue.push(record);
    logDebug('Queued analytics event:', record.event_type, record.event_label, record.page_slug);
    notifyEventObserver(record);
    scheduleFlush();
    return true;
  }

  function notifyEventObserver(record) {
    try {
      if (!record || typeof window === 'undefined') {
        return;
      }
      const observer = window.__SITE_ANALYTICS_EVENT_OBSERVER__;
      if (typeof observer !== 'function') {
        return;
      }
      observer({
        event_type: record.event_type,
        event_label: record.event_label,
        page_slug: record.page_slug,
        event_data: record.event_data,
        session_id: record.session_id,
        event_timestamp: record.event_timestamp
      });
    } catch (error) {
      // Ignore observer errors so analytics never break pages
    }
  }

  function scheduleFlush() {
    if (flushTimer || eventQueue.length === 0) {
      return;
    }
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flushQueue();
    }, FLUSH_DELAY_MS);
  }

  function resolveSupabaseBaseConfig() {
    if (cachedRestBaseUrl && cachedKey) {
      return { base: cachedRestBaseUrl, key: cachedKey };
    }
    const runtimeConfig = window.SupabaseConfig || {};
    const envConfig = window.__NAEI_SUPABASE_CONFIG || window.__NAEI_SUPABASE_CONFIG__ || {};
    const url = runtimeConfig.SUPABASE_URL || runtimeConfig.url || envConfig.url || envConfig.SUPABASE_URL || null;
    const key = runtimeConfig.SUPABASE_KEY || runtimeConfig.key || envConfig.key || envConfig.SUPABASE_KEY || null;
    if (!url || !key) {
      return null;
    }
    cachedRestBaseUrl = `${url.replace(/\/$/, '')}/rest/v1`;
    cachedKey = key;
    endpointCache.clear();
    return { base: cachedRestBaseUrl, key: cachedKey };
  }

  function resolveSupabaseCredentials(tableName = TABLE_NAME) {
    const baseConfig = resolveSupabaseBaseConfig();
    if (!baseConfig) {
      return null;
    }
    const normalizedTable = tableName || TABLE_NAME;
    if (endpointCache.has(normalizedTable)) {
      return endpointCache.get(normalizedTable);
    }
    const credentials = {
      endpoint: `${baseConfig.base}/${normalizedTable}`,
      key: baseConfig.key
    };
    endpointCache.set(normalizedTable, credentials);
    return credentials;
  }

  function isLikelyJwt(token) {
    return typeof token === 'string' && token.split('.').length === 3;
  }

  function flushQueue(options = {}) {
    if (!eventQueue.length || analyticsDisabled) {
      return Promise.resolve(false);
    }
    if (pendingFlush) {
      return pendingFlush;
    }
    const credentials = resolveSupabaseCredentials();
    if (!credentials) {
      // Try again once credentials load.
      scheduleFlush();
      return Promise.resolve(false);
    }
    const payload = eventQueue.splice(0, eventQueue.length);
    const headers = {
      'Content-Type': 'application/json',
      apikey: credentials.key,
      Prefer: 'return=minimal'
    };
    if (isLikelyJwt(credentials.key)) {
      headers.Authorization = `Bearer ${credentials.key}`;
    }
    const requestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      keepalive: Boolean(options.keepalive)
    };

    pendingFlush = fetch(credentials.endpoint, requestInit)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Analytics request failed: ${response.status}`);
        }
        logDebug('Flushed analytics batch:', payload.length);
      })
      .catch(error => {
        console.warn('Analytics flush failed:', error);
        // Requeue on failure (dropping oldest if needed)
        payload.forEach(record => queueEvent(record));
      })
      .finally(() => {
        pendingFlush = null;
      });

    return pendingFlush;
  }

  function trackPageDrawn(meta = {}) {
    if (window.__SITE_ANALYTICS_DISABLE_AUTO_PAGEVIEW__) {
      return Promise.resolve(false);
    }
    state.pageOpenedAt = Date.now();
    state.lastInteractionAt = null;
    heartbeatEligible = true;
    heartbeatCount = 0;
    pauseHeartbeatLoop();
    const viewport = buildViewportInfo();
    return trackSystem('page_drawn', {
      ...meta,
      pageSlug: meta.pageSlug,
      screen_size: viewport.screen,
      viewport_size: viewport.viewport
    });
  }

  function trackInteraction(label, meta = {}) {
    const { skipActivityTouch, ...metaPayload } = meta || {};
    const record = buildRecord('interaction', {
      ...metaPayload,
      label: label || 'interaction'
    });
    const queued = queueEvent(record);
    if (!skipActivityTouch && !isHeartbeatLabel(label)) {
      markUserActivity();
    }
    return Promise.resolve(queued);
  }

  function trackChartInteraction(eventLabel, meta = {}, options = {}) {
    const trackerMeta = { ...(meta || {}) };
    const chartType = options.chartType || trackerMeta.chart_type || null;
    const pageSlugOption = options.pageSlug || options.slug || null;
    const existingSlug = trackerMeta.pageSlug || trackerMeta.page_slug || null;
    const finalSlug = pageSlugOption || existingSlug || state.pageSlug;

    if (chartType && !trackerMeta.chart_type) {
      trackerMeta.chart_type = chartType;
    }
    if (finalSlug && !trackerMeta.pageSlug) {
      trackerMeta.pageSlug = sanitizeSlug(finalSlug);
    }
    if (finalSlug && !trackerMeta.page_slug) {
      trackerMeta.page_slug = sanitizeSlug(finalSlug);
    }

    const directTracker = window.SiteAnalytics?.trackInteraction
      || window.Analytics?.trackInteraction
      || (window.Analytics?.trackAnalytics
        ? (label, payload) => window.Analytics.trackAnalytics(null, label, payload)
        : null);

    if (typeof directTracker === 'function') {
      try {
        return Promise.resolve(directTracker(eventLabel, trackerMeta));
      } catch (error) {
        console.warn('Interaction tracker failed:', error);
      }
    }

    return Promise.resolve(false);
  }

  function trackSystem(label, meta = {}) {
    const record = buildRecord('system', {
      ...(meta || {}),
      label: label || 'system'
    });
    return Promise.resolve(queueEvent(record));
  }

  async function legacyTrackAnalytics(_client, eventName, details = {}) {
    const normalizedName = typeof eventName === 'string'
      ? eventName.trim()
      : (eventName || '');

    if (normalizedName === 'page_drawn') {
      return trackPageDrawn(details);
    }

    let overrideType = null;
    if (details && typeof details === 'object' && details.__eventType) {
      overrideType = details.__eventType;
      delete details.__eventType;
    }

    if (overrideType === 'system' || SYSTEM_EVENT_LABELS.has(normalizedName)) {
      return trackSystem(normalizedName, details);
    }

    return trackInteraction(normalizedName, details);
  }

  function autoTrackPageDrawn() {
    if (analyticsDisabled || window.__SITE_ANALYTICS_DISABLE_AUTO_PAGEVIEW__) {
      return;
    }
    if (autoPageDrawnSent) {
      return;
    }
    const fire = () => {
      if (autoPageDrawnSent) {
        return;
      }
      autoPageDrawnSent = true;
      trackPageDrawn();
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      runSoon(fire);
    } else {
      document.addEventListener('DOMContentLoaded', fire, { once: true });
    }
  }

  function handlePassiveActivityEvent() {
    if (analyticsDisabled || document.visibilityState === 'hidden') {
      return;
    }
    const now = Date.now();
    if (now - lastPassiveActivityAt < PASSIVE_ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastPassiveActivityAt = now;
    markUserActivity();
  }

  function registerPassiveActivityListeners() {
    if (passiveListenersRegistered || typeof document === 'undefined') {
      return;
    }
    PASSIVE_ACTIVITY_EVENTS.forEach(eventName => {
      document.addEventListener(eventName, handlePassiveActivityEvent, { passive: true });
    });
    passiveListenersRegistered = true;
  }

  function markUserActivity() {
    state.lastInteractionAt = Date.now();
    if (!heartbeatEligible || analyticsDisabled || document.visibilityState === 'hidden') {
      return;
    }
    startHeartbeatLoop({ resetTimer: !heartbeatRunning });
  }

  function hasRecentActivity() {
    if (!state.lastInteractionAt) {
      return false;
    }
    return (Date.now() - state.lastInteractionAt) <= HEARTBEAT_IDLE_TIMEOUT_MS;
  }

  function shouldSendHeartbeat() {
    const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    return heartbeatEligible
      && !analyticsDisabled
      && document.visibilityState !== 'hidden'
      && hasFocus
      && hasRecentActivity();
  }

  function captureHeartbeatSnapshot() {
    return {
      pageSlug: state.pageSlug,
      heartbeatEligible,
      heartbeatRunning,
      heartbeatCount,
      lastInteractionAt: state.lastInteractionAt,
      resolvedLabel: resolveHeartbeatLabel(),
      visibilityState: document.visibilityState,
      analyticsDisabled,
      autoPageDrawnSent,
      hasRecentActivity: hasRecentActivity()
    };
  }

  function clearHeartbeatTimer() {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function recordHeartbeat() {
    if (!shouldSendHeartbeat()) {
      return;
    }
    const heartbeatLabel = resolveHeartbeatLabel();
    if (!heartbeatLabel) {
      pauseHeartbeatLoop();
      return;
    }
    heartbeatCount += 1;
    const dwellSeconds = Math.max(0, Math.round((Date.now() - (state.pageOpenedAt || Date.now())) / 1000));
    trackInteraction(heartbeatLabel, {
      dwell_seconds: dwellSeconds,
      heartbeat_interval_seconds: HEARTBEAT_INTERVAL_MS / 1000,
      heartbeat_count: heartbeatCount,
      skipActivityTouch: true
    });
  }

  function queueHeartbeatTick() {
    clearHeartbeatTimer();
    if (!shouldSendHeartbeat()) {
      pauseHeartbeatLoop();
      return;
    }
    heartbeatTimer = window.setTimeout(() => {
      heartbeatTimer = null;
      if (!shouldSendHeartbeat()) {
        pauseHeartbeatLoop();
        return;
      }
      recordHeartbeat();
      queueHeartbeatTick();
    }, HEARTBEAT_INTERVAL_MS);
  }

  function startHeartbeatLoop(options = {}) {
    if (!shouldSendHeartbeat()) {
      return;
    }
    if (options.resetCount) {
      heartbeatCount = 0;
    }
    if (options.resetTimer) {
      clearHeartbeatTimer();
    }
    if (heartbeatRunning && !options.resetTimer) {
      return;
    }
    heartbeatRunning = true;
    queueHeartbeatTick();
  }

  function pauseHeartbeatLoop() {
    heartbeatRunning = false;
    clearHeartbeatTimer();
  }

  function exposeApi() {
    const api = {
      configure,
      trackPageDrawn,
      trackInteraction,
      trackSystem,
      getHeartbeatSnapshot: captureHeartbeatSnapshot,
      flush: flushQueue,
      getSessionId: () => state.sessionId,
      getUserCountry,
      isEnabled: () => !analyticsDisabled
    };

    window.SiteAnalytics = api;
    window.Analytics = {
      trackAnalytics: legacyTrackAnalytics,
      getUserCountry,
      getSessionId: () => state.sessionId,
      trackPageDrawn,
      trackInteraction,
      trackSystem
    };
    window.ChartInteractionTracker = {
      track: trackChartInteraction
    };
    window.trackChartInteraction = trackChartInteraction;
    window.SiteErrors = {
      log: logSiteError
    };
    window.SiteAnalyticsDebug = {
      getHeartbeatSnapshot: captureHeartbeatSnapshot
    };
  }

  function registerLifecycleHooks() {
    window.addEventListener('online', () => {
      flushQueue();
    });
    window.addEventListener('beforeunload', () => {
      pauseHeartbeatLoop();
      flushQueue({ keepalive: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        pauseHeartbeatLoop();
        flushQueue({ keepalive: true });
      } else if (shouldSendHeartbeat()) {
        startHeartbeatLoop({ resetTimer: true });
      }
    });
  }

  function normalizeSeverity(value) {
    if (typeof value !== 'string') {
      return 'error';
    }
    const normalized = value.trim().toLowerCase();
    return ERROR_SEVERITIES.has(normalized) ? normalized : 'error';
  }

  function serializeDetails(value) {
    if (value == null) {
      return null;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }
    if (typeof value === 'string') {
      return { message: value };
    }
    if (typeof value !== 'object') {
      return { value };
    }
    try {
      return JSON.parse(JSON.stringify(value, (_, nestedValue) => {
        if (typeof nestedValue === 'function') {
          return undefined;
        }
        if (typeof nestedValue === 'bigint') {
          return Number(nestedValue);
        }
        return nestedValue;
      }));
    } catch (error) {
      return {
        note: 'Failed to serialize error details',
        fallback: String(value)
      };
    }
  }

  function buildErrorRecord(meta = {}) {
    if (!meta) {
      return null;
    }
    const message = meta.message
      || meta.error?.message
      || (typeof meta === 'string' ? meta : null);
    if (!message) {
      return null;
    }
    const now = new Date().toISOString();
    const errorTimestamp = meta.error_timestamp || meta.client_timestamp || now;
    const slug = sanitizeSlug(meta.page_slug || meta.pageSlug || state.pageSlug);
    return {
      error_timestamp: errorTimestamp,
      session_id: meta.session_id || state.sessionId || null,
      page_slug: slug,
      page_url: meta.page_url || (window.location ? window.location.href : null),
      source: meta.source || 'unknown',
      severity: normalizeSeverity(meta.severity),
      error_code: meta.error_code || meta.error?.code || null,
      message,
      details: serializeDetails(meta.details || meta.error || meta.extra || null)
    };
  }

  async function logSiteError(meta = {}) {
    const record = buildErrorRecord(meta);
    if (!record) {
      return false;
    }
    const credentials = resolveSupabaseCredentials(ERROR_TABLE_NAME);
    if (!credentials) {
      return false;
    }
    const headers = {
      'Content-Type': 'application/json',
      apikey: credentials.key,
      Prefer: 'return=minimal'
    };
    if (isLikelyJwt(credentials.key)) {
      headers.Authorization = `Bearer ${credentials.key}`;
    }

    try {
      const response = await fetch(credentials.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify([record]),
        keepalive: Boolean(meta.keepalive)
      });
      if (!response.ok) {
        throw new Error(`Site error log failed: ${response.status}`);
      }
      logDebug('Logged site error:', record.source, record.severity);
      return true;
    } catch (error) {
      console.warn('Site error logging failed:', error);
      return false;
    }
  }

  exposeApi();
  registerLifecycleHooks();
  registerPassiveActivityListeners();
  autoTrackPageDrawn();
})();
