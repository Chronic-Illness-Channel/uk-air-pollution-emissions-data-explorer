/**
 * Main Chart and UI Module
 * Handles chart rendering, UI interactions, category management, and initialization
 * v2.4 - Now uses shared color module
 */

// Global chart instance and state
let chart; // global chart instance
let seriesVisibility = [];
window.seriesVisibility = seriesVisibility; // Expose for export.js
let urlUpdateTimer = null; // Debounce timer for URL updates
let googleChartsReady = false;
let chartRenderCallback = null; // Callback for when chart finishes rendering
let initialLoadComplete = false; // Track if initial chart load is done (prevent resize redraw)

// Load Google Charts and set up callback
google.charts.load('current', {packages:['corechart']});
google.charts.setOnLoadCallback(() => {
  googleChartsReady = true;
  console.log('Google Charts loaded successfully for line chart');
});

// Build/version banner for diagnostics
(function(){
  try {
    const build = 'v2.4-embed-gate-2025-11-04T20:26Z';
    window.__LINECHART_BUILD__ = build;
    document.documentElement.setAttribute('data-linechart-build', build);
    console.log(`🧩 Linechart build loaded: ${build}`);
  } catch (e) { /* no-op */ }
})();

// Export configuration constants
const EXPORT_MIN_SCALE = 16;
const EXPORT_MAX_DIM = 16000;
const EXPORT_MAX_PIXELS = 100_000_000;

// Listen for messages from parent
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'overlayHidden') {
    console.log('✅ Received overlayHidden message from parent - enabling resize handler');
    initialLoadComplete = true;
  } else if (event.data && event.data.type === 'resizeComplete') {
    console.log(`✅ Parent confirmed resize to ${event.data.height}px - waiting for reflow...`);
    
    // Wait for browser to reflow the iframe before measuring dimensions
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Force reflow by accessing dimensions
        const currentHeight = document.documentElement.offsetHeight;
        const currentWidth = document.documentElement.offsetWidth;
        console.log(`📐 After reflow - iframe dimensions: ${currentWidth}x${currentHeight}`);
        
        // Now render the chart
        if (window.pendingRender) {
          window.pendingRender();
          window.pendingRender = null;
        }
      });
    });
  }
});

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
    console.warn(`Export scale ${desiredScale} reduced to ${allowed} to avoid huge canvas (${Math.round(origW*allowed)}x${Math.round(origH*allowed)})`);
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

function setupSelectors(pollutants, categories){
  // ✅ Use pollutant list from Supabase loadData
  const sel = document.getElementById('pollutantSelect');
  sel.innerHTML = '<option value="">Select pollutant</option>';
  if (pollutants && pollutants.length) {
    const pollutantNames = [...new Set(pollutants.map(p => p.pollutant))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    pollutantNames.forEach(p => sel.add(new Option(p, p)));
  }

  // Ensure we have the categories list available from the global window var
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


  // ✅ Use precomputed globalYears instead of header slice
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

function getSelectedCategories(){ return [...document.querySelectorAll('#categoryContainer select')].map(s => s.value).filter(Boolean); }
function addCategorySelector(defaultValue = "", usePlaceholder = true){
  const categoryName = (defaultValue && typeof defaultValue === 'object')
    ? getCategoryDisplayTitle(defaultValue)
    : defaultValue;
  const container = document.getElementById('categoryContainer');
  const div = document.createElement('div');
  div.className = 'categoryRow';
  div.draggable = true;

  // drag handle
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
  allCategories.forEach(g => {
    if (!selected.includes(g) || g === categoryName) sel.add(new Option(g,g));
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
    all.forEach(g => {
      if (!selected.includes(g) || g === current) {
        const option = new Option(g,g);
        if (g === current) option.selected = true;
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
  removeBtn.innerHTML = '<span class="remove-icon">−</span> Remove Category';
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
        // Append remove button as a sibling to the control wrapper so it
        // sits inline on wide screens but drops underneath on small screens
        row.appendChild(removeBtn);
      }
    });
  }

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
    addBtn.textContent = 'Max Categories = 10';
    addBtn.disabled = true;
  } else {
    addBtn.innerHTML = '<span class="add-icon" aria-hidden="true"></span> Add Category';
    addBtn.disabled = false;
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

/**
 * Remove bare 4-digit year tick elements from an SVG root unless they're
 * explicitly marked with `data-custom-year`. Returns an object listing
 * removed labels for diagnostics.
 */
function pruneYearsFromSVG(svgRoot, opts = {}) {
  const debug = opts.debug || false;
  const removed = [];
  try {
    if (!svgRoot || !svgRoot.querySelectorAll) return { removed };
    const nodes = svgRoot.querySelectorAll('text, tspan');
    nodes.forEach(node => {
      try {
        const txt = (node.textContent || '').trim();
        if (/^\d{4}$/.test(txt)) {
          let cur = node;
          let hasCustom = false;
          while (cur && cur.getAttribute) {
            if (cur.getAttribute('data-custom-year')) { hasCustom = true; break; }
            cur = cur.parentNode;
          }
          if (!hasCustom) {
            let toRemove = node;
            while (toRemove && toRemove.nodeName && toRemove.nodeName.toLowerCase() !== 'text') toRemove = toRemove.parentNode;
            if (toRemove && toRemove.parentNode) {
              toRemove.parentNode.removeChild(toRemove);
              removed.push(txt);
            }
          }
        }
      } catch (e) {
        if (debug) console.warn('pruneYearsFromSVG inner error', e);
      }
    });
  } catch (e) {
    if (debug) console.warn('pruneYearsFromSVG failed', e);
  }
  return { removed };
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
    console.warn('Could not add custom year labels:', e);
  }
}


/* ---------------- Chart rendering & legend ---------------- */

/**
 * Updates the browser's URL with the current chart settings.
 * This function is debounced to prevent flooding the browser history.
 */
function updateUrlFromChartState() {
  // Ensure the data needed for ID lookups is available.
  const pollutants = window.allPollutantsData || [];
  const categories = window.allCategoryInfo || [];
  if (!pollutants.length || !categories.length) {
    console.log("URL update skipped: lookup data not yet available.");
    return;
  }

  clearTimeout(urlUpdateTimer);
  urlUpdateTimer = setTimeout(() => {
    try {
      const pollutantName = document.getElementById('pollutantSelect').value;
      const startYear = document.getElementById('startYear').value;
      const endYear = document.getElementById('endYear').value;
      const categoryNames = getSelectedCategories();

      if (!pollutantName || !startYear || !endYear || categoryNames.length === 0) {
        return; // Not enough info to create a valid URL
      }

      // Find pollutant ID
      const pollutant = pollutants.find(p => p.pollutant === pollutantName);
      const pollutantId = pollutant ? pollutant.id : null;

      // Find category IDs
      const categoryIds = categoryNames.map(name => {
        const category = categories.find(g => getCategoryDisplayTitle(g) === name);
        return category ? category.id : null;
      }).filter(id => id !== null);

      if (!pollutantId || categoryIds.length !== categoryNames.length) {
        console.warn("Could not map all names to IDs for URL update.");
        return;
      }

      if (parseInt(startYear) >= parseInt(endYear)) {
        console.warn(`URL update skipped: Invalid year range (start=${startYear}, end=${endYear}).`);
        return;
      }

      const queryParts = [
        `pollutant_id=${encodeURIComponent(pollutantId)}`,
        `category_ids=${categoryIds.join(',')}`,
        `start_year=${encodeURIComponent(startYear)}`,
        `end_year=${encodeURIComponent(endYear)}`
      ];
      
      // If we're in an iframe, send URL update to parent
      if (window.parent && window.parent !== window) {
        const newUrl = `?chart=1&${queryParts.join('&')}`;
        window.parent.postMessage({
          type: 'updateUrl',
          url: newUrl
        }, '*');
      } else {
        // Standalone mode - update our own URL
        const newUrl = `${window.location.pathname}?${queryParts.join('&')}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);
      }

    } catch (error) {
      console.error("Failed to update URL from chart state:", error);
    }
  }, 400); // 400ms debounce delay
}


function updateChart(){
  // Create stack trace to see where this is being called from
  const stack = new Error().stack;
  const caller = stack?.split('\n')[2]?.trim() || 'unknown caller';
  console.log('🎨 updateChart() called from:', caller);
  console.log('📚 Full stack trace:', stack);
  
  // Wait for Google Charts to be ready
  if (!googleChartsReady) {
    console.log('Google Charts not ready yet for line chart, waiting...');
    google.charts.setOnLoadCallback(() => {
      googleChartsReady = true;
      updateChart();
    });
    return;
  }

  const pollutant = document.getElementById('pollutantSelect').value;
  const startYear = +document.getElementById('startYear').value;
  const endYear = +document.getElementById('endYear').value;
  const selectedCategories = getSelectedCategories();

  // If essential selections aren’t ready yet, retry briefly (handles race with URL parsing/DOM updates)
  if (!pollutant || !startYear || !endYear || !selectedCategories.length) {
    window.__updateRetryCount = (window.__updateRetryCount || 0) + 1;
    const missing = [];
    if (!pollutant) missing.push('pollutant');
    if (!startYear) missing.push('startYear');
    if (!endYear) missing.push('endYear');
    if (!selectedCategories.length) missing.push('categories');
    console.log(`⏳ updateChart deferred (${window.__updateRetryCount}) – waiting for: ${missing.join(', ')}`);
    if (window.__updateRetryCount <= 20) {
      setTimeout(updateChart, 75);
      return;
    } else {
      console.warn('updateChart gave up waiting for selections; not drawing.');
      window.__updateRetryCount = 0;
      return;
    }
  }
  // Reset retry counter once ready
  window.__updateRetryCount = 0;

  // Update the URL with the new state (debounced)
  updateUrlFromChartState();

  // Track chart view analytics
  window.supabaseModule.trackAnalytics('chart_view', {
    pollutant: pollutant,
    start_year: startYear,
    end_year: endYear,
    categories: selectedCategories,
    categories_count: selectedCategories.length,
    year_range: endYear - startYear + 1
  });

  window.Colors.resetColorSystem();
  const categoryData = window.categoryData || {};
  // Use the global year keys to determine which years to display
  const yearsAll = window.globalYears || [];
  const yearKeys = window.globalYearKeys || [];
  const startIdx = yearsAll.indexOf(String(startYear));
  const endIdx = yearsAll.indexOf(String(endYear));
  const years = yearsAll.slice(startIdx, endIdx + 1);
  const keysForYears = yearKeys.slice(startIdx, endIdx + 1);
  const colors = selectedCategories.map(g => window.Colors.getColorForCategory(g));

  // Build rows of data (year + series values). Use null for missing.
  const chartRows = years.map((y, rowIdx) => {
    const row = [y];
    const key = keysForYears[rowIdx]; // e.g. 'f2015'
    selectedCategories.forEach(g => {
      const dataRow = categoryData[pollutant]?.[g];
      const raw = dataRow ? dataRow[key] : null;
      const val = (raw === null || raw === undefined) ? null : parseFloat(raw);
      row.push(Number.isNaN(val) ? null : val);
    });
    return row;
  });

  // guard against empty data
  if (chartRows.length === 0) return;

  // --- Determine which categories actually have data ---
  const categoryHasData = selectedCategories.map((g, i) => {
    return chartRows.some(row => typeof row[i + 1] === 'number');
  });

  // Get unit before creating DataTable (needed for tooltips)
  const unit = pollutantUnits[pollutant] || "";

  // Create DataTable explicitly to guarantee column types
  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Year');           // year as string
  selectedCategories.forEach(g => {
    dataTable.addColumn('number', g);              // data column
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
        const categoryName = selectedCategories[i - 1];
        let formattedValue;
        
        // Use more decimals for very small values
        if (Math.abs(value) < 0.001 && value !== 0) {
          formattedValue = value.toFixed(9).replace(/\.?0+$/, ''); // Up to 9 decimals for very small values
        } else if (Math.abs(value) < 1 && value !== 0) {
          formattedValue = value.toFixed(6).replace(/\.?0+$/, ''); // Up to 6 decimals, remove trailing zeros
        } else {
          formattedValue = value.toFixed(3).replace(/\.?0+$/, ''); // 3 decimals for normal values
        }
        
        const tooltip = `${categoryName}\nYear: ${row[0]}\nValue: ${formattedValue}${unit ? ' ' + unit : ''}`;
        newRow.push(tooltip);
      }
    }
    dataTable.addRow(newRow);
  });

  const seriesOptions = {};
  selectedCategories.forEach((g, i) => {
    // Use the global seriesVisibility state to determine visibility
    // Ensure the array is initialized if this is the first run or category count changed
    if (seriesVisibility.length !== selectedCategories.length) {
      seriesVisibility = Array(selectedCategories.length).fill(true);
      window.seriesVisibility = seriesVisibility; // Update window reference
    }
    seriesOptions[i] = seriesVisibility[i]
      ? { color: colors[i], lineWidth: 3, pointSize: 4 }
      : { color: colors[i], lineWidth: 0, pointSize: 0 };
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

  // Set a fixed height for the chart container to prevent layout shifts
  const chartContainer = document.getElementById('chart_div');
  if (chartContainer) {
    chartContainer.style.minHeight = '500px';
  }

  const options = {
    title: '',
    width: '100%',
    height: '70%',
    legend: 'none',
    // Configure animations - enable them but with a very short duration
    animation: {
      duration: 100,
      easing: 'out',
      startup: true
    },
    // Configure chart area and axes
    chartArea: { 
      width: '85%', 
      height: '80%',
      top: 40,
      bottom: 60,
      left: 100,
      right: 40
    },
    hAxis: {
      title: 'Year',
      textStyle: { 
        color: '#666' // Visible Google Charts labels (debug: ensure years visible)
      },
      titleTextStyle: { 
        fontSize: 13, 
        bold: true 
      },
      gridlines: { 
        color: '#e0e0e0'
      },
      baselineColor: '#666',
      // Let Google Charts handle the view window
      viewWindow: {
        min: 1970,
        max: 2023
      }
    },
    vAxis: {
      title: `Emissions${unit ? ' (' + unit + ')' : ''}`,
      viewWindow: { 
        min: 0 
      },
      textStyle: { 
        fontSize: 12 
      },
      titleTextStyle: {
        fontSize: window.innerWidth < 768 && window.innerHeight < window.innerWidth ? 12 : 14,
        bold: true,
        wrap: false
      },
      textPosition: 'out', // Ensure title is positioned outside to avoid overlap
    },
    series: seriesOptions,
    curveType: 'function',
    lineWidth: 3,
    pointSize: 4,
    chartArea: {
      top: 20,
      left: leftMargin,
      right: 10,
      bottom: window.innerWidth < 768 && window.innerHeight < window.innerWidth ? 80 : 60, // Add extra bottom padding for landscape mode
      height: '70%'
    }
  };
  

  // draw chart and show pollutant as visible page title
  chart = new google.visualization.LineChart(chartContainer);

  // Add a 'ready' event listener that will fire after every draw,
  // ensuring custom labels are always present.
  google.visualization.events.addListener(chart, 'ready', function() {
    addCustomYearLabel(chart, chartContainer);
  });

  // Wrap custom X-axis labels with a safe fallback to Google labels
  google.visualization.events.addListener(chart, 'ready', () => {
    let customOk = false;
    try {
      if (typeof addCustomXAxisLabels === 'function') {
        addCustomXAxisLabels();
        customOk = true;
      }
    } catch (e) {
      console.warn('Custom X-axis labels failed:', e);
      customOk = false;
    }
    // If custom labels failed, redraw once with default Google labels visible
    if (!customOk && !window.__labelFallback) {
      window.__labelFallback = true;
      try {
        options.hAxis.textStyle = options.hAxis.textStyle || {};
        options.hAxis.textStyle.color = '#666';
        chart.draw(dataTable, options);
      } finally {
        setTimeout(() => { window.__labelFallback = false; }, 0);
      }
    }
  });
  
  // Add listener for chart render completion (for loading management)
  google.visualization.events.addListener(chart, 'ready', () => {
    if (chartRenderCallback) {
      console.log('Line chart finished rendering');
      chartRenderCallback();
      chartRenderCallback = null; // Clear callback after use
    }
  });

  // Compute safe width/height to avoid negative SVG dimensions
  const safeWidth = Math.max(chartContainer.offsetWidth || 0, 300);
  const safeHeight = Math.max(chartContainer.offsetHeight || 0, 200);
  
  console.log(`📊 Chart container size: ${chartContainer.offsetWidth}x${chartContainer.offsetHeight} (using ${safeWidth}x${safeHeight})`);
  console.log(`📐 Iframe size: ${window.innerWidth}x${window.innerHeight}`);
  options.width = safeWidth;
  options.height = safeHeight;

  // On mobile, show only first and last year for clarity
  const isMobile = window.innerWidth < 600;
  if (isMobile) {
    options.hAxis.slantedText = true;
    options.hAxis.slantedTextAngle = 90;
  }
    // Ensure a small right chart padding so the chart fills most of the container
  if (options.chartArea) {
    // Reduce the minimum right padding; previously set to 80px which left a large gap.
    options.chartArea.right = Math.max(options.chartArea.right || 10, 20);
    if (isMobile) {
      options.chartArea.width = '70%';
    }
  }

  // Delay slightly to let layout stabilize (prevents negative sizes)
  setTimeout(() => {
    chart.draw(dataTable, options);
    // Only add visible class when parent is already visible to prevent flash
    if (document.getElementById('mainContent').classList.contains('loaded')) {
      chartContainer.classList.add('visible');
    }
    
    // After chart is drawn, send content height to parent
    if (window.parent && window.parent !== window) {
      setTimeout(() => {
        // Use body.scrollHeight which measures actual content
        const bodyHeight = document.body.scrollHeight;
        const buffer = 30; // Minimal buffer for axis labels
        const newHeight = Math.ceil(bodyHeight) + buffer;
        const currentHeight = window.innerHeight;
        console.log('📏 Height calculation: body.scrollHeight=', bodyHeight, 'final=', newHeight);
        if (Math.abs(newHeight - currentHeight) > 20) {
          console.log('📐 Height update:', currentHeight, 'to', newHeight);
          window.parent.postMessage({
            type: 'iframeHeight',
            chart: 'line',
            height: newHeight
          }, '*');
        }
      }, 250);
    }
  }, 100);

  // update visible title on page
  const titleEl = document.getElementById('chartTitle');
  titleEl.textContent = `${pollutant}${unit ? " (" + unit + ")" : ""}`;

  // build custom legend (interactive)
  const legendDiv = document.getElementById('customLegend');
  legendDiv.innerHTML = '';

  // Ensure visibility array is correctly sized before building the legend
  if (seriesVisibility.length !== selectedCategories.length) {
    seriesVisibility = Array(selectedCategories.length).fill(true);
    window.seriesVisibility = seriesVisibility; // Update window reference
  }

  selectedCategories.forEach((g, i) => {
    const item = document.createElement('span');
    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '12px';
    dot.style.height = '12px';
    dot.style.borderRadius = '50%';
    dot.style.backgroundColor = colors[i];
    item.appendChild(dot);

    const labelText = document.createTextNode(g + (categoryHasData[i] ? '' : ' (No data available)'));
    item.appendChild(labelText);

    // Fade if no data, or if the series is toggled off
    item.style.opacity = (!categoryHasData[i] || !seriesVisibility[i]) ? '0.4' : '1';
    if (!categoryHasData[i]) {
      item.title = 'No data available';
    }

    // Toggle visibility only if data exists
    if (categoryHasData[i]) {
      item.addEventListener('click', () => {
        // Toggle the visibility state for the clicked series
        seriesVisibility[i] = !seriesVisibility[i];
        window.seriesVisibility = seriesVisibility; // Update window reference
        // Trigger a full chart update to redraw everything correctly
        updateChart();
      });
    }

    legendDiv.appendChild(item);
  });

  // ensure controls reflect available choices
  refreshCategoryDropdowns();
  refreshButtons();
}

// Backward compatibility: some older code paths may still call drawChart()
// Ensure it simply delegates to the modern updateChart() with readiness guards
function drawChart() {
  try {
    return updateChart();
  } catch (e) {
    console.error('drawChart fallback failed:', e);
  }
}

// Add custom Year label after chart is drawn
function addCustomYearLabel(chart, chartContainer) {
  try {
    const existing = document.getElementById('custom-year-label');
    if (existing) existing.remove();
    
    const chartLayout = chart.getChartLayoutInterface();
    const chartArea = chartLayout.getChartAreaBoundingBox();
    
    const label = document.createElement('div');
    label.id = 'custom-year-label';
    label.textContent = 'Year';
    label.style.position = 'absolute';
    label.style.left = chartArea.left + chartArea.width / 2 - 20 + 'px';
    // Move label below the axis tick labels
    label.style.top = (chartArea.top + chartArea.height + 30) + 'px';
    label.style.fontFamily = 'Arial, sans-serif';
    label.style.fontSize = '13px';
    label.style.color = '#333';
    label.style.fontWeight = 'bold';
    label.style.pointerEvents = 'none';
    
    chartContainer.appendChild(label);
  } catch (error) {
    console.error('Error in addCustomYearLabel:', error);
  }
}

// Track last resize dimensions to avoid redundant redraws
let lastResizeWidth = window.innerWidth;
let lastResizeHeight = window.innerHeight;

window.addEventListener('resize', () => {
  // Don't trigger chart redraws during initial load
  if (!initialLoadComplete) {
    console.log('Resize event ignored during initial load');
    return;
  }
  
  clearTimeout(window._resizeTimer);
  window._resizeTimer = setTimeout(() => {
    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;
    
    const widthChanged = Math.abs(currentWidth - lastResizeWidth) > 10;
    const heightChanged = Math.abs(currentHeight - lastResizeHeight) > 10;
    
    // Only redraw on width changes
    if (widthChanged) {
      console.log('Width changed from', lastResizeWidth, 'to', currentWidth, '- redrawing');
      lastResizeWidth = currentWidth;
      lastResizeHeight = currentHeight;
      updateChart();
      return;
    }
    
    // Height changes: accept without redraw (parent is resizing iframe to fit content)
    if (heightChanged) {
      console.log('Height changed from', lastResizeHeight, 'to', currentHeight, '- accepting');
      lastResizeHeight = currentHeight;
      return;
    }
  }, 300); // Increased debounce to 300ms for smoother resizing
});

async function renderInitialView() {
  return new Promise(resolve => {
    const params = parseUrlParameters();
    const pollutantSelect = document.getElementById('pollutantSelect');
    
    // Use a small timeout to allow the DOM to update with the options from setupSelectors
    setTimeout(() => {
      if (params.pollutantName) {
        pollutantSelect.value = params.pollutantName;
      } else {
        // Default to PM2.5 if no pollutant is in the URL
        if ([...pollutantSelect.options].some(o => o.value === 'PM2.5')) {
          pollutantSelect.value = 'PM2.5';
        }
      }

      // Clear existing category selectors and add new ones based on URL
      const categoryContainer = document.getElementById('categoryContainer');
      categoryContainer.innerHTML = ''; // Clear any default selectors

      if (params.categoryNames && params.categoryNames.length > 0) {
        params.categoryNames.forEach(name => addCategorySelector(name, false));
      } else {
        // Add default categories if none are in the URL
        addCategorySelector('All', false);
      }

      const startYearSelect = document.getElementById('startYear');
      const endYearSelect = document.getElementById('endYear');
      
      // Set year values from URL params (already validated in parseUrlParameters)
      if (params.startYear && startYearSelect.querySelector(`option[value="${params.startYear}"]`)) {
        startYearSelect.value = params.startYear;
      }
      if (params.endYear && endYearSelect.querySelector(`option[value="${params.endYear}"]`)) {
        endYearSelect.value = params.endYear;
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
    
    // Estimate expected height before rendering chart
    // This allows parent to resize iframe BEFORE we render, preventing size mismatch
    const estimatedHeight = 1400; // Conservative estimate for chart with controls
    
    if (window.parent && window.parent !== window) {
      console.log(`📏 Sending estimated iframe height: ${estimatedHeight}px (before rendering)`);
      window.parent.postMessage({
        type: 'iframeHeight',
        chart: 'line',
        height: estimatedHeight
      }, '*');
      
      // Set up a pending render function that will be called when resize is confirmed
      window.pendingRender = () => {
        console.log('🎨 Starting chart render after resize confirmed');
        
        // Log all available dimension information
        console.log('📐 === DIMENSION DEBUG ===');
        console.log('📐 window.innerWidth:', window.innerWidth);
        console.log('📐 window.innerHeight:', window.innerHeight);
        console.log('📐 document.documentElement.clientWidth:', document.documentElement.clientWidth);
        console.log('📐 document.documentElement.clientHeight:', document.documentElement.clientHeight);
        console.log('📐 document.body.clientWidth:', document.body.clientWidth);
        console.log('📐 document.body.clientHeight:', document.body.clientHeight);
        
        const chartContainer = document.getElementById('chart_div');
        if (chartContainer) {
          console.log('📐 chartContainer.offsetWidth:', chartContainer.offsetWidth);
          console.log('📐 chartContainer.offsetHeight:', chartContainer.offsetHeight);
          console.log('📐 chartContainer.clientWidth:', chartContainer.clientWidth);
          console.log('📐 chartContainer.clientHeight:', chartContainer.clientHeight);
          const computedStyle = window.getComputedStyle(chartContainer);
          console.log('📐 chartContainer computed width:', computedStyle.width);
          console.log('📐 chartContainer computed height:', computedStyle.height);
          console.log('📐 chartContainer computed display:', computedStyle.display);
          console.log('📐 chartContainer computed visibility:', computedStyle.visibility);
        }
        console.log('📐 === END DIMENSION DEBUG ===');
        
        // Now render the chart at the correct size
        (function gateFirstRender(){
          let tries = 0;
          const maxTries = 30; // ~3s
          function tick(){
            if (selectionsReady()) {
              // Pre-render diagnostics
              try {
                const params = parseUrlParameters();
                const dbg = {
                  stage: 'preRender',
                  params,
                  pollutantSelect: document.getElementById('pollutantSelect')?.value || null,
                  startYear: document.getElementById('startYear')?.value || null,
                  endYear: document.getElementById('endYear')?.value || null,
                  categorySelectCount: document.querySelectorAll('#categoryContainer select').length,
                  selectedCategories: (function(){ try { return getSelectedCategories(); } catch(e){ return []; } })(),
                  globalYearsCount: (window.globalYears || []).length
                };
                const debugCategoryData = window.categoryData || null;
                if (debugCategoryData && dbg.pollutantSelect) {
                  dbg.categoryDataPresence = (dbg.selectedCategories || []).map(g => ({ category: g, hasRow: !!(debugCategoryData[dbg.pollutantSelect] && debugCategoryData[dbg.pollutantSelect][g]) }));
                }
                console.log('🧪 Pre-render diagnostics:', dbg);
                if (window.parent && window.parent !== window) {
                  window.parent.postMessage({ type: 'lineDebug', payload: dbg }, '*');
                }
              } catch (e) {
                console.warn('Pre-render diagnostics failed:', e);
              }
              console.log('✅ Selections ready – rendering chart');
              updateChart();
              afterDraw();
            } else if (++tries < maxTries) {
              setTimeout(tick, 100);
            } else {
              console.warn('⚠️ Selections not ready after waiting — drawing anyway');
              updateChart();
              afterDraw();
            }
          }
          function afterDraw(){
            // Wait for chart to actually render in the DOM
            setTimeout(() => {
              console.log('Line chart rendering complete');
              // Make chart visible
              const chartDiv = document.getElementById('chart_div');
              if (chartDiv) {
                chartDiv.classList.add('visible');
              }
              // Wait longer to ensure Google Chart is fully painted and stable
              setTimeout(() => {
                console.log('Line chart fully loaded and visible');
                // Chart is rendered - send chartReady immediately
                // No need to send another height update, iframe size is already correct
                console.log('📤 Sending chartReady message to parent...');
                window.parent.postMessage({
                  type: 'chartReady',
                  chart: 'line'
                }, '*');
                // DON'T enable resize handler yet - wait for parent to confirm overlay is hidden
                console.log('⏳ Waiting for overlay to be hidden before enabling resize handler...');
                resolve();
              }, 200);
            }, 350);
          }
          tick();
        })();
        
        // Wait for chart to actually render in the DOM
        setTimeout(() => {
          console.log('Line chart rendering complete');
          
          // Make chart visible
          const chartDiv = document.getElementById('chart_div');
          if (chartDiv) {
            chartDiv.classList.add('visible');
          }
          
          // Wait longer to ensure Google Chart is fully painted and stable
          setTimeout(() => {
            console.log('Line chart fully loaded and visible');
            
            // Chart is rendered - send chartReady immediately
            // No need to send another height update, iframe size is already correct
            console.log('📤 Sending chartReady message to parent...');
            window.parent.postMessage({
              type: 'chartReady',
              chart: 'line'
            }, '*');
            
            // DON'T enable resize handler yet - wait for parent to confirm overlay is hidden
            console.log('⏳ Waiting for overlay to be hidden before enabling resize handler...');
            resolve();
          }, 200); // Longer delay to ensure Google Chart is fully stable
        }, 350); // Wait for chart render
      };
    } else {
      // Not in iframe, render immediately
      updateChart();
      resolve();
    }
  });
}



/* ---------------- URL Parameters and Initialization ---------------- */
function parseUrlParameters() {
  const params = new URLSearchParams(window.location.search);
  const pollutantId = params.get('pollutant_id');
  const categoryIds = params.get('category_ids')?.split(',').map(Number).filter(Boolean);
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
      const category = categories.find(g => String(g.id) === String(id));
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
        console.warn(`Invalid year range in URL: start=${startYearParam}, end=${endYearParam}. Using defaults.`);
        startYear = availableYears[0];
        endYear = availableYears[availableYears.length - 1];
      }
    } else if (isStartYearValid) {
      // Only start year valid
      startYear = startYearParam;
      // Find a valid end year after the start
      const startIdx = availableYears.indexOf(startYearParam);
      endYear = availableYears[availableYears.length - 1];
      console.warn(`Invalid end year in URL: ${endYearParam}. Using ${endYear}.`);
    } else if (isEndYearValid) {
      // Only end year valid
      endYear = endYearParam;
      // Find a valid start year before the end
      startYear = availableYears[0];
      console.warn(`Invalid start year in URL: ${startYearParam}. Using ${startYear}.`);
    } else if (startYearParam || endYearParam) {
      // Years provided but both invalid
      console.warn(`Invalid years in URL: start=${startYearParam}, end=${endYearParam}. Using defaults.`);
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
}

/**
 * Main initialization function.
 * This is the entry point for the application.
 */
async function init() {
  try {
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
    
    console.log('supabaseModule found, proceeding with initialization...');
    
    // First, load all necessary data from Supabase
    const { pollutants, categories, yearKeys, pollutantUnits, categoryData } = await window.supabaseModule.loadData();

    // Store data on the window object for global access
    window.allPollutants = pollutants;
    window.allCategories = categories;
    window.allCategoryInfo = categories;
    window.globalYearKeys = yearKeys;
    window.globalYears = yearKeys.map(key => key.substring(1));
    window.pollutantUnits = pollutantUnits;
    window.categoryData = categoryData || {};
    
    // Then, set up the UI selectors with the loaded data
    setupSelectors(pollutants, categories);

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
    // Loading overlay removed - error handling via console and main index.html
    alert(`Error loading line chart: ${error.message}. Please check the console and refresh the page.`);
  }
}

// Add the chart ready message when the chart is fully loaded
function notifyChartReady() {
  try {
    // Add a small delay to ensure the chart is fully rendered
    setTimeout(() => {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ 
          type: 'chartReady', 
          chart: 'line',
          timestamp: new Date().toISOString()
        }, '*');
      }
      
      // Re-enable animations for future updates
      if (chart) {
        chart.setOptions({
          animation: {
            duration: 1000,
            easing: 'out',
            startup: false
          }
        });
      }
    }, 300); // 300ms delay to ensure rendering is complete
  } catch (error) {
    console.error('Error in notifyChartReady:', error);
  }
}

// Call this after chart is fully loaded
if (window.google && window.google.visualization && chart) {
  google.visualization.events.addListener(chart, 'ready', function() {
    // Add custom year label
    const chartContainer = document.getElementById('chart_div');
    if (chartContainer) {
      addCustomYearLabel(chart, chartContainer);
    }
    
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