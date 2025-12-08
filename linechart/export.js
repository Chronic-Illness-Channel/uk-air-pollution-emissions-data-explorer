/**
 * Export and Share Module  
 * Handles data export (CSV, Excel), chart image generation, and share functionality
 * Extracted from v2.2 index.html for modular architecture
 */

function sanitizeFilenameSegment(value) {
  return (value ?? '')
    .toString()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/gi, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'NA';
}

function formatCsvCell(value) {
  if (window.NAEICsvUtils?.formatCsvCell) {
    return window.NAEICsvUtils.formatCsvCell(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  if (stringValue === '') {
    return '';
  }
  const escaped = stringValue.replace(/"/g, '""');
  return /[",\n]/.test(stringValue) ? `"${escaped}"` : escaped;
}

function getSelectedCategoryNames() {
  if (typeof getSelectedCategories === 'function') {
    return getSelectedCategories();
  }
  if (typeof getSelectedGroups === 'function') {
    return getSelectedGroups();
  }
  return [];
}

function getAllCategoryRecords() {
  return window.allCategoryInfo || window.allGroupsData || [];
}

function buildLineFilenameBase({ startYear, endYear, pollutantName, firstCategoryName }) {
  const pollutantShort = typeof window.supabaseModule?.getPollutantShortName === 'function'
    ? window.supabaseModule.getPollutantShortName(pollutantName)
    : null;

  const categoryShort = typeof window.supabaseModule?.getCategoryShortTitle === 'function'
    ? window.supabaseModule.getCategoryShortTitle(firstCategoryName)
    : (typeof window.supabaseModule?.getGroupShortTitle === 'function'
      ? window.supabaseModule.getGroupShortTitle(firstCategoryName)
      : null);

  const yearLabel = Number.isFinite(startYear) && Number.isFinite(endYear)
    ? (startYear === endYear ? `${startYear}` : `${startYear}-${endYear}`)
    : 'Years';

  const yearSegment = sanitizeFilenameSegment(yearLabel);
  const pollutantSegment = sanitizeFilenameSegment(pollutantShort || pollutantName || 'Pollutant');
  const categorySegment = sanitizeFilenameSegment(categoryShort || firstCategoryName || 'Category');

  return `${yearSegment}_Line-Chart_${pollutantSegment}_${categorySegment}`;
}

function exportData(format = 'csv') {
  const pollutant = document.getElementById('pollutantSelect').value;
  const startYear = +document.getElementById('startYear').value;
  const endYear = +document.getElementById('endYear').value;
  const selectedCategories = getSelectedCategoryNames();
  
  console.log('Export debug:', { pollutant, startYear, endYear, selectedCategories, globalHeadersLength: window.globalHeaders?.length });
  
  if (!pollutant || !selectedCategories.length || !(window.globalHeaders?.length)) {
    console.warn('Export validation failed:', { 
      hasPollutant: !!pollutant, 
      hasCategories: selectedCategories.length > 0, 
      hasHeaders: window.globalHeaders?.length > 0 
    });
    alert('Please select a pollutant and at least one category first.');
    return;
  }

  const primaryCategory = selectedCategories[0];
  const filenameBase = buildLineFilenameBase({
    startYear,
    endYear,
    pollutantName: pollutant,
    firstCategoryName: primaryCategory
  });

  // Track export analytics when available
  const exportAnalyticsPayload = {
    format: format,
    pollutant: pollutant,
    start_year: startYear,
    end_year: endYear,
    categories: selectedCategories,
    category_count: selectedCategories.length,
    categories_count: selectedCategories.length,
    year_range: endYear - startYear + 1,
    filename: filenameBase
  };

  if (window.supabaseModule?.trackAnalytics) {
    window.supabaseModule
      .trackAnalytics('data_export', exportAnalyticsPayload)
      .catch(err => console.warn('Export analytics tracking failed:', err));
  }

  // Use the global year keys / labels determined earlier
  const yearsAll = window.globalYears || [];
  const yearKeys = window.globalYearKeys || [];
  const startIdx = yearsAll.indexOf(String(startYear));
  const endIdx = yearsAll.indexOf(String(endYear));
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    alert('Invalid year range.');
    return;
  }
  const years = yearsAll.slice(startIdx, endIdx + 1);
  const keysForYears = yearKeys.slice(startIdx, endIdx + 1);
  const unit = window.pollutantUnits[pollutant] || '';

  // --- Build rows ---
  const rows = [];
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);

  // First row: pollutant and unit
  rows.push([`Pollutant: ${pollutant}`, `Unit: ${unit}`]);
  rows.push([]); // spacer row
  // Header row
  rows.push(['Category', ...years]);


  const categoryData = window.categoryData || {};

  // Data rows - read values by key for robustness
  selectedCategories.forEach(category => {
    const values = keysForYears.map((k) => {
      // look up the data row for this pollutant and category
      const dataRow = categoryData[pollutant] ? categoryData[pollutant][category] : null;
      const raw = dataRow ? dataRow[k] : null;
      return raw ?? '';
    });
    rows.push([category, ...values]);
  });


  rows.push([]); // spacer
  rows.push([`Downloaded on: ${timestamp}`]);

  // --- Generate and download file ---
  if (format === 'csv') {
    const csvContent = rows
      .map(row => row.map(cell => formatCsvCell(cell)).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filenameBase}.csv`;
    link.click();
  } else if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const dataRowStartIndex = 3; // rows 0-2 are metadata + header
    const dataRowEndIndex = dataRowStartIndex + selectedCategories.length;
    const dataRows = rows.slice(dataRowStartIndex, dataRowEndIndex);

    const categoryCells = dataRows
      .map(row => Array.isArray(row) ? row[0] : null)
      .filter(cell => typeof cell === 'string' && cell.trim().length > 0);

    const longestCategoryLength = categoryCells.reduce(
      (max, cell) => Math.max(max, cell.length),
      'Category'.length
    );

    const longestYearValueLength = dataRows.reduce((max, row) => {
      if (!Array.isArray(row)) {
        return max;
      }
      years.forEach((_, idx) => {
        const cell = row[idx + 1];
        if (cell == null) {
          return;
        }
        const length = String(cell).length;
        if (length > max) {
          max = length;
        }
      });
      return max;
    }, 0);

    const longestYearHeaderLength = years.reduce(
      (max, yearLabel) => Math.max(max, String(yearLabel).length),
      0
    );

    const longestYearLength = Math.max(longestYearValueLength, longestYearHeaderLength, 1);

    const baseCategoryWidth = (longestCategoryLength || 0) + 2;
    const baseYearWidth = longestYearLength + 2;
    const categoryCharWidth = Math.max(14, baseCategoryWidth);
    const yearCharWidth = Math.min(20, Math.max(10, baseYearWidth));

    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const columnDefs = Array.from({ length: columnCount }, (_, idx) => {
      const charWidth = idx === 0 ? categoryCharWidth : yearCharWidth;
      const pixelWidth = idx === 0
        ? Math.max(90, Math.round(charWidth * 6.2))
        : Math.max(60, Math.round(charWidth * 5.2));
      return {
        wch: charWidth,
        wpx: pixelWidth,
        customWidth: 1
      };
    });

    ws['!cols'] = columnDefs;

    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `${filenameBase}.xlsx`);
  }
}

function resolveShareUrl(queryInput) {
  if (window.NAEIUrlState?.buildShareUrl) {
    return window.NAEIUrlState.buildShareUrl(queryInput);
  }
  return legacyShareUrlFallback(queryInput);
}

function readableShareUrl(url) {
  if (!url) {
    return '';
  }
  try {
    return decodeURI(url);
  } catch (error) {
    return url;
  }
}

function formatShareUrlForDisplay(url) {
  const readable = readableShareUrl(url);
  if (!readable) {
    return '';
  }
  if (window.EmailShareHelper?.stripProtocol) {
    return window.EmailShareHelper.stripProtocol(readable);
  }
  return readable.replace(/^(https?:\/\/)/i, '');
}

function legacyShareUrlFallback(queryInput) {
  const currentUrl = new URL(window.location.href);
  const pathSegments = currentUrl.pathname.split('/').filter(Boolean);
  if (pathSegments.length) {
    const last = pathSegments[pathSegments.length - 1];
    if (last && last.includes('.')) {
      pathSegments.pop();
    }
  }
  if (pathSegments.length) {
    pathSegments.pop();
  }
  const basePath = pathSegments.length ? `/${pathSegments.join('/')}/` : '/';
  const normalizedQuery = window.NAEIUrlState?.buildQueryString
    ? window.NAEIUrlState.buildQueryString(queryInput)
    : serializeShareQuery(queryInput);
  return normalizedQuery
    ? `${currentUrl.origin}${basePath}?${normalizedQuery}`
    : `${currentUrl.origin}${basePath}`;
}

function serializeShareQuery(queryInput) {
  if (!queryInput) {
    return '';
  }
  if (typeof queryInput === 'string') {
    return queryInput.replace(/^[?&]+/, '');
  }
  if (queryInput instanceof URLSearchParams) {
    return queryInput.toString();
  }
  if (Array.isArray(queryInput)) {
    return queryInput.filter(Boolean).join('&');
  }
  const params = new URLSearchParams();
  Object.entries(queryInput).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    params.set(key, value);
  });
  return params.toString();
}

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

// Generate shareable URL with current configuration
function generateShareUrl() {
  const pollutantSelect = document.getElementById('pollutantSelect');
  const selectedCategories = getSelectedCategoryNames();
  
  if (!pollutantSelect.value || selectedCategories.length === 0) {
    alert('Please select a pollutant and at least one category before sharing.');
    return null;
  }
  
  const pollutants = window.allPollutantsData || [];
  const categories = getAllCategoryRecords();
  
  if (!pollutants.length || !categories.length) {
    alert('Data not yet loaded. Please try again.');
    return null;
  }
  
  // Find pollutant ID
  const pollutantData = pollutants.find(pd => pd.pollutant === pollutantSelect.value);
  
  if (!pollutantData) {
    alert('Unable to find pollutant ID for sharing.');
    return null;
  }
  
  // Find category IDs
  const categoryIds = [];
  selectedCategories.forEach(categoryName => {
    const categoryRecord = categories.find(record => getCategoryDisplayTitle(record) === categoryName);
    if (categoryRecord) {
      categoryIds.push(categoryRecord.id);
    }
  });
  
  if (categoryIds.length === 0) {
    alert('Unable to find category IDs for sharing.');
    return null;
  }
  
  // Get year selections
  const startYearSelect = document.getElementById('startYear');
  const endYearSelect = document.getElementById('endYear');
  const startYear = startYearSelect ? startYearSelect.value : null;
  const endYear = endYearSelect ? endYearSelect.value : null;
  
  const params = new URLSearchParams();
  params.set('chart', '2');
  params.set('pollutant_id', pollutantData.id);
  const categoryIdList = categoryIds.join(',');
  params.set('category_ids', categoryIdList);
  if (startYear) {
    params.set('start_year', startYear);
  }
  if (endYear) {
    params.set('end_year', endYear);
  }

  return resolveShareUrl(params);
}

// Setup share button functionality
function setupShareButton() {
  const shareBtn = document.getElementById('shareBtn');
  if (!shareBtn) return;
  
  shareBtn.addEventListener('click', () => {
    const shareUrl = generateShareUrl();
    if (!shareUrl) return;
    
    // Track share usage
    const categoryCount = getSelectedCategoryNames().length;
    const shareAnalyticsPayload = {
      pollutant: document.getElementById('pollutantSelect').value,
      category_count: categoryCount,
      start_year: document.getElementById('startYear')?.value || '',
      end_year: document.getElementById('endYear')?.value || '',
      year_span: (document.getElementById('endYear')?.value && document.getElementById('startYear')?.value) 
        ? (parseInt(document.getElementById('endYear').value) - parseInt(document.getElementById('startYear').value) + 1) 
        : null
    };
    if (window.supabaseModule?.trackAnalytics) {
      window.supabaseModule.trackAnalytics('share_button_click', shareAnalyticsPayload);
    }
    
    // Show share options
    showShareDialog(shareUrl);
  });
}

// Show share dialog with copy and email options
function showShareDialog(shareUrl) {
  const pollutantName = document.getElementById('pollutantSelect').value;
  const selectedCategories = getSelectedCategoryNames();
  const startYear = document.getElementById('startYear')?.value || '';
  const endYear = document.getElementById('endYear')?.value || '';
  const displayShareUrl = formatShareUrlForDisplay(shareUrl) || shareUrl;
  
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    padding: 24px;
    border-radius: 12px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    position: relative;
  `;
  
  const yearRange = (startYear && endYear) ? ` (${startYear}-${endYear})` : '';
  const title = `${pollutantName} - ${selectedCategories.join(', ')}${yearRange}`;
  const description = `View ${pollutantName} emissions data for ${selectedCategories.length === 1 ? selectedCategories[0] : `${selectedCategories.length} categories`}${yearRange ? ` from ${startYear} to ${endYear}` : ''} using the NAEI Multi-Category Pollutant Viewer.`;
  
  content.innerHTML = `
    <button id="closeShareBtn" style="position: absolute; top: 16px; right: 16px; padding: 8px 16px; background: #666; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
      ❌ Close
    </button>
    
    <h3 style="margin: 0 0 16px 0; color: #333; display: flex; align-items: center; gap: 8px;">
      <span class="share-icon" style="width: 20px; height: 20px;"></span>
      <span>Share Chart</span>
    </h3>
    <p style="margin: 0 0 16px 0; color: #666;">Share this specific chart configuration:</p>
    <p style="margin: 0 0 16px 0; font-weight: 600; color: #000;">${title}</p>
    
    <div style="margin: 16px 0;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600;">Shareable URL:</label>
      <div style="display: flex; gap: 8px; align-items: center;">
  <input type="text" id="shareUrlInput" name="shareUrlInput" value="${displayShareUrl}" readonly 
     style="flex: 1; padding: 10px 16px; border: 1px solid #ccc; border-radius: 6px; font-size: 18px; background: #f9f9f9; height: 48px; box-sizing: border-box;">
        <button id="copyUrlBtn" style="padding: 10px 16px; background: #9C27B0; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; min-width: 130px; font-size: 18px; height: 48px; display: flex; align-items: center; gap: 8px;">
          <img src="../SharedResources/images/clipboard_icon_mjh-alpha-200x279.svg" alt="Copy URL" style="height: 28px; width: auto; vertical-align: middle; margin-right: 8px;"> Copy URL
        </button>
      </div>
    </div>
    
    <div style="margin: 16px 0;">
      <button id="copyPngBtn" style="padding: 10px 16px; background: #FF9800; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; min-width: 370px; display: flex; align-items: center; gap: 8px; font-size: 18px;">
        <img src="../SharedResources/images/clipboard_painting_icon_mjh-line-200x231.svg" alt="Copy Chart Image" style="height: 32px; width: auto; vertical-align: middle; margin-right: 8px;"> Copy Chart Image as PNG to clipboard
      </button>
    </div>
    
    <div style="margin: 16px 0;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <button id="emailShareBtn" style="padding: 12px 20px; background: #2196F3; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; white-space: nowrap; font-size: 18px; display: flex; align-items: center; gap: 8px;">
          <img src="../SharedResources/images/email-icon-white.svg" alt="Send Email" style="height: 25px; width: auto; vertical-align: middle; margin-right: 8px;"> Send Email
        </button>
        <p style="margin: 0; color: #000; font-weight: 600;">Chart will be copied to clipboard<br>for pasting into email</p>
      </div>
    </div>
  `;
  
  dialog.appendChild(content);
  document.body.appendChild(dialog);
  
  const shareUrlInput = content.querySelector('#shareUrlInput');
  const copyUrlBtn = content.querySelector('#copyUrlBtn');
  const copyUrlDefaultHtml = copyUrlBtn.innerHTML;
  const copyUrlDefaultBg = copyUrlBtn.style.background;
  const copyPngBtn = content.querySelector('#copyPngBtn');
  const copyPngDefaultHtml = copyPngBtn.innerHTML;
  const copyPngDefaultBg = copyPngBtn.style.background;

  function showCopiedState(button, label = 'Copied') {
    const width = button.offsetWidth;
    const height = button.offsetHeight;
    button.style.width = `${width}px`;
    button.style.height = `${height}px`;
    button.innerHTML = `
      <span style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
        <span aria-hidden="true" style="font-size: 1.1em;">✅</span>
        <span>${label}</span>
      </span>
    `;
    button.style.background = '#4CAF50';
  }

  function resetButtonState(button, html, backgroundColor) {
    button.innerHTML = html;
    button.style.background = backgroundColor;
    button.style.width = '';
    button.style.height = '';
  }
  
  // Copy URL functionality
  copyUrlBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(displayShareUrl);
      showCopiedState(copyUrlBtn);

      if (window.supabaseModule?.trackAnalytics) {
        window.supabaseModule.trackAnalytics('share_url_copied', {
          pollutant: pollutantName,
          category_count: selectedCategories.length,
          start_year: startYear,
          end_year: endYear,
          has_year_range: !!(startYear && endYear)
        });
      }

      setTimeout(() => {
        resetButtonState(copyUrlBtn, copyUrlDefaultHtml, copyUrlDefaultBg);
      }, 2000);
    } catch (err) {
      // Fallback for older browsers
      shareUrlInput.select();
      document.execCommand('copy');
      alert('URL copied to clipboard!');
    }
  });
  
  // Copy PNG functionality
  copyPngBtn.addEventListener('click', async () => {
    try {
      copyPngBtn.disabled = true;
      
      const chartImageData = await generateChartImage();
      const blob = dataURLtoBlob(chartImageData);
      
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        const clipboardItem = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([clipboardItem]);

        showCopiedState(copyPngBtn);

        if (window.supabaseModule?.trackAnalytics) {
          window.supabaseModule.trackAnalytics('share_png_copied', {
            pollutant: pollutantName,
            category_count: selectedCategories.length,
            start_year: startYear,
            end_year: endYear
          });
        }

        setTimeout(() => {
          resetButtonState(copyPngBtn, copyPngDefaultHtml, copyPngDefaultBg);
          copyPngBtn.disabled = false;
        }, 2000);
      } else {
        resetButtonState(copyPngBtn, copyPngDefaultHtml, copyPngDefaultBg);
        copyPngBtn.disabled = false;
        alert('Your browser doesn\'t support copying images to clipboard. Please use the PNG download button instead.');
      }
    } catch (error) {
      console.error('Failed to copy PNG:', error);
      resetButtonState(copyPngBtn, copyPngDefaultHtml, copyPngDefaultBg);
      copyPngBtn.disabled = false;
      alert('Failed to copy chart image: ' + error.message);
    }
  });
  
  // Email sharing functionality
  content.querySelector('#emailShareBtn').addEventListener('click', async () => {
    try {
      // Always copy chart image to clipboard
      const chartImageData = await generateChartImage();
      
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        const blob = dataURLtoBlob(chartImageData);
        const clipboardItem = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([clipboardItem]);
      }
    } catch (error) {
      console.warn('Could not copy chart image to clipboard:', error);
    }
    
    const emailPayload = window.EmailShareHelper
      ? window.EmailShareHelper.composeEmail({
          pollutantName,
          startYear,
          endYear,
          categories: selectedCategories,
          shareUrl
        })
      : null;

    window.supabaseModule.trackAnalytics('share_email_opened', {
      pollutant: pollutantName,
      category_count: selectedCategories.length,
      start_year: startYear,
      end_year: endYear,
      has_year_range: !!(startYear && endYear)
    });

    if (emailPayload && window.EmailShareHelper) {
      window.EmailShareHelper.openEmailClient(emailPayload);
    } else {
      const fallbackSubject = `UK Air Pollution/Emissions Data: ${pollutantName} ${yearRange.replace(/[()]/g, '')}`.trim();
      const readableShare = displayShareUrl || readableShareUrl(shareUrl);
      const fallbackBody = [
        `I'm sharing UK air pollution/emissions data for ${pollutantName}${yearRange ? ` ${yearRange}` : ''}.`,
        '',
        'Categories included:',
        ...(
          selectedCategories.length
            ? selectedCategories.map((category, index) => `${index + 1}. ${category}`)
            : ['None specified']
        ),
        '',
        readableShare ? `Interactive chart: ${readableShare}` : '',
        '',
        'Generated by the Chronic Illness Channel UK Air Pollution/Emissions Data Explorer',
        'chronicillnesschannel.co.uk/data-explorer'
      ].filter(Boolean);
      const encodedSubject = encodeURIComponent(fallbackSubject);
      const encodedBody = encodeURIComponent(fallbackBody.join('\n'));
      window.location.href = `mailto:?subject=${encodedSubject}&body=${encodedBody}`;
    }
  });
  
  // Close dialog
  const closeDialog = () => {
    document.body.removeChild(dialog);
  };
  
  content.querySelector('#closeShareBtn').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
  
  // Focus the URL input for easy copying
  setTimeout(() => {
    shareUrlInput.select();
  }, 100);
}



/**
 * Creates a high-resolution image from the visible chart's SVG, then composites it.
 * This function adapts the successful logic from v2.2.
 * @param {object} chart - The visible Google Chart instance.
 * @param {HTMLElement} chartContainer - The visible chart's container div.
 * @returns {Promise<string>} Data URI of the final composited chart image.
 */
function getChartImageURI(chart, chartContainer) {
    return new Promise((resolve, reject) => {
        const svgEl = chartContainer ? chartContainer.querySelector('svg') : null;
        if (!svgEl) {
            return reject(new Error("Chart SVG element not found."));
        }

        try {
            const origW = parseInt(svgEl.getAttribute('width')) || chartContainer.offsetWidth || 800;
            const origH = parseInt(svgEl.getAttribute('height')) || chartContainer.offsetHeight || 400;

            // 1. Clone the visible SVG and scale it for high resolution.
            const exportScale = 3; // Use a fixed high-res scale.
            const clonedSvg = svgEl.cloneNode(true);
            if (!clonedSvg.getAttribute('viewBox')) {
                clonedSvg.setAttribute('viewBox', `0 0 ${origW} ${origH}`);
            }
            clonedSvg.setAttribute('width', Math.round(origW * exportScale));
            clonedSvg.setAttribute('height', Math.round(origH * exportScale));

            // 2. Create a blob from the SVG string and generate an object URL.
            const svgString = new XMLSerializer().serializeToString(clonedSvg);
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = () => {
                // Once the SVG is loaded into an image, resolve with its data.
                // The composition will happen in generateChartImage.
                resolve({
                    uri: img.src,
                    width: img.width,
                    height: img.height,
                    svgBlobUrl: url // Pass the blob URL for cleanup
                });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Failed to load SVG as an image."));
            };
            img.src = url;

        } catch (err) {
            reject(new Error(`SVG processing failed: ${err.message}`));
        }
    });
}

// Generate comprehensive chart image for email sharing (same as PNG download)
async function generateChartImage() {
  return new Promise(async (resolve, reject) => {
    let svgBlobUrl = null; // To hold the temporary blob URL for cleanup
    try {
      const pollutant = document.getElementById('pollutantSelect').value;
      if (!chart || !pollutant) {
        return reject(new Error('Chart or pollutant not available'));
      }

      const chartContainer = document.getElementById('chart_div');
      // 1. Get the high-resolution chart URI from the *visible* chart's SVG.
      const { uri, width: chartWidth, height: chartHeight, svgBlobUrl: blobUrl } = await getChartImageURI(chart, chartContainer);
      svgBlobUrl = blobUrl; // Store for cleanup

      if (!uri) {
        return reject(new Error('Failed to generate chart image URI'));
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          const unit = window.pollutantUnits[pollutant] || "";
          const startYearValue = document.getElementById('startYear')?.value || '';
          const endYearValue = document.getElementById('endYear')?.value || '';
          const yearLabel = (startYearValue && endYearValue)
            ? (startYearValue === endYearValue ? `${startYearValue}` : `${startYearValue} - ${endYearValue}`)
            : (startYearValue || endYearValue || '');
          const pollutantTitle = unit ? `${pollutant} - ${unit}` : pollutant;
          const padding = 50; 
          const yearHeight = yearLabel ? 152 : 0;
          const titleHeight = 162;
          const headerText = 'UK Air Pollution/Emissions';
          const baseChartWidth = chartContainer?.offsetWidth || chartWidth;
          const logicalCanvasWidth = baseChartWidth + padding * 2;
          const isNarrowExport = logicalCanvasWidth < 768;
          const canvasWidth = chartWidth + padding * 2;
          const loadImageElement = (src) => new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = (err) => reject(err);
            image.src = src;
          });

          // --- 3. Set up the final canvas dimensions ---
          const measureCanvas = document.createElement('canvas');
          const measureCtx = measureCanvas.getContext('2d');
          const buildHeaderMetrics = width => {
            const headerFontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const maxWidth = Math.max(300, width - 200);
            let fontSize = 90;
            const minFontSize = 60;
            let font = `700 ${fontSize}px ${headerFontFamily}`;
            measureCtx.font = font;
            while (measureCtx.measureText(headerText).width > maxWidth && fontSize > minFontSize) {
              fontSize -= 2;
              font = `700 ${fontSize}px ${headerFontFamily}`;
              measureCtx.font = font;
            }
            const lineHeight = fontSize + 40;
            return {
              font,
              fontSize,
              height: lineHeight
            };
          };
          const buildFooterLayout = width => {
            const compactFooter = width < 768;
            const footerFontSize = compactFooter ? 42 : 52;
            const lineHeight = compactFooter ? 50 : 60;
            const footerFontFamily = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const footerFont = `${footerFontSize}px ${footerFontFamily}`;
            const footerFontBold = `600 ${footerFontSize}px ${footerFontFamily}`;
            const maxLineWidth = width - 80;
            const topPadding = lineHeight;
            measureCtx.textAlign = 'left';
            const licenseSegments = [
              '© Crown 2025 copyright Defra & DESNZ',
              'via naei.energysecurity.gov.uk',
              'licensed under the Open Government Licence (OGL).'
            ];
            const licenseLines = [];
            let currentLine = '';
            measureCtx.font = footerFont;
            licenseSegments.forEach(segment => {
              const candidate = currentLine ? `${currentLine} ${segment}` : segment;
              if (measureCtx.measureText(candidate).width <= maxLineWidth) {
                currentLine = candidate;
              } else {
                if (currentLine) {
                  licenseLines.push(currentLine);
                }
                currentLine = segment;
              }
            });
            if (currentLine) {
              licenseLines.push(currentLine);
            }
            const licenseHeight = licenseLines.length * lineHeight;

            const contactSegments = [
              { label: 'Website: ', value: 'chronicillnesschannel.co.uk/data-explorer' },
              { label: 'YouTube: ', value: 'youtube.com/@ChronicIllnessChannel' },
              { label: 'Contact: ', value: 'info@chronicillnesschannel.co.uk' }
            ];
            const segmentSpacing = 40;
            const measuredSegments = contactSegments.map(segment => {
              measureCtx.font = footerFontBold;
              const labelWidth = measureCtx.measureText(segment.label).width;
              measureCtx.font = footerFont;
              const valueWidth = measureCtx.measureText(segment.value).width;
              return {
                ...segment,
                labelWidth,
                valueWidth,
                totalWidth: labelWidth + valueWidth
              };
            });
            const computeLineWidth = indices => indices.reduce((sum, idx, position) => {
              const spacing = position > 0 ? segmentSpacing : 0;
              return sum + measuredSegments[idx].totalWidth + spacing;
            }, 0);
            const layouts = [
              [[0, 1, 2]],
              [[0, 1], [2]],
              [[0], [1, 2]],
              [[0], [1], [2]]
            ];
            const contactLines = (layouts.find(lines =>
              lines.every(indices => computeLineWidth(indices) <= maxLineWidth)
            ) || layouts[layouts.length - 1]).map(indices => ({
              indices,
              width: computeLineWidth(indices)
            }));
            const contactHeight = contactLines.length * lineHeight;
            const contactSpacingHeight = contactLines.length ? 20 : 0;
            const totalHeight = topPadding + licenseHeight + contactSpacingHeight + contactHeight;
            const contactSegmentWidth = measuredSegments[2]?.totalWidth || measuredSegments[measuredSegments.length - 1]?.totalWidth || 0;
            return {
              lineHeight,
              footerFont,
              footerFontBold,
              licenseLines,
              contactLines,
              measuredSegments,
              segmentSpacing,
              totalHeight,
              contactSegmentWidth
            };
          };

          const buildLegendLayout = width => {
            const legendDiv = document.getElementById('customLegend');
            if (!legendDiv) {
              return {
                rows: [],
                totalHeight: 0,
                rowHeight: 92,
                font: '600 70px system-ui, sans-serif'
              };
            }
            const allItems = [...legendDiv.children].filter(el => el.tagName === 'SPAN');
            const visibility = window.seriesVisibility || [];
            const filteredItems = allItems.reduce((acc, item, index) => {
              const text = item.textContent.trim();
              const hasNoData = text.includes('(No data available)');
              const isVisible = visibility[index] !== false;
              if (isVisible || hasNoData) {
                const dot = item.querySelector('span');
                if (dot) {
                  acc.push({
                    text,
                    dotColor: dot.style.backgroundColor,
                    faded: hasNoData
                  });
                }
              }
              return acc;
            }, []);

            if (!filteredItems.length) {
              return {
                rows: [],
                totalHeight: 0,
                rowHeight: 92,
                font: '600 70px system-ui, sans-serif'
              };
            }

            const rows = [];
            let row = [];
            let rowW = 0;
            const baseFontSize = 70;
            const minFontSize = 40;
            const fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const legendRowPadding = 22;
            const entryBasePadding = 138;
            const maxW = width - padding * 2;
            const measureText = size => {
              measureCtx.font = `600 ${size}px ${fontFamily}`;
              return text => measureCtx.measureText(text).width;
            };

            const buildEntries = size => {
              const measure = measureText(size);
              let maxEntryWidth = 0;
              const entries = filteredItems.map(item => {
                const textWidth = measure(item.text);
                const entryWidth = textWidth + entryBasePadding;
                maxEntryWidth = Math.max(maxEntryWidth, entryWidth);
                return {
                  ...item,
                  textWidth,
                  entryWidth
                };
              });
              return { entries, maxEntryWidth };
            };

            let legendFontSize = baseFontSize;
            let { entries, maxEntryWidth } = buildEntries(legendFontSize);
            const maxAllowedEntryWidth = Math.max(maxW, 0);
            if (maxAllowedEntryWidth > 0 && maxEntryWidth > maxAllowedEntryWidth) {
              const ratio = maxAllowedEntryWidth / maxEntryWidth;
              const adjustedSize = Math.max(minFontSize, Math.floor(legendFontSize * ratio));
              if (adjustedSize < legendFontSize) {
                legendFontSize = adjustedSize;
                ({ entries, maxEntryWidth } = buildEntries(legendFontSize));
              }
            }

            entries.forEach(entry => {
              if (rowW + entry.entryWidth > maxW && row.length) {
                rows.push({ entries: row, width: rowW });
                row = [];
                rowW = 0;
              }
              row.push(entry);
              rowW += entry.entryWidth;
            });
            if (row.length) {
              rows.push({ entries: row, width: rowW });
            }

            const legendRowHeight = Math.round(legendFontSize + legendRowPadding);
            return {
              rows,
              totalHeight: rows.length * legendRowHeight,
              rowHeight: legendRowHeight,
              font: `600 ${legendFontSize}px ${fontFamily}`
            };
          };

          const headerMetrics = buildHeaderMetrics(canvasWidth);
          const footerLayout = buildFooterLayout(canvasWidth);
          const legendLayout = buildLegendLayout(canvasWidth);
          const legendSpacing = legendLayout.rows.length ? 30 : 0;
          const legendHeight = legendLayout.totalHeight + legendSpacing;

          let bannerConfig = null;
          if (isNarrowExport) {
            try {
              const bannerImage = await loadImageElement('../SharedResources/images/CIC-Banner-alpha.svg');
              const targetWidth = Math.min(
                Math.max(footerLayout.contactSegmentWidth || 0, 200),
                canvasWidth - 160
              );
              if (targetWidth > 0) {
                const scaledHeight = Math.round((targetWidth / bannerImage.naturalWidth) * bannerImage.naturalHeight);
                bannerConfig = {
                  image: bannerImage,
                  width: targetWidth,
                  height: scaledHeight,
                  spacingTop: 30,
                  spacingBottom: 0
                };
              }
            } catch (err) {
              console.warn('CIC banner failed to load for narrow export', err);
            }
          }

          const bannerExtraHeight = bannerConfig ? bannerConfig.spacingTop + bannerConfig.height + bannerConfig.spacingBottom : 0;

          const canvas = document.createElement('canvas');
          const canvasHeight = headerMetrics.height + yearHeight + titleHeight + legendHeight + chartHeight + footerLayout.totalHeight + bannerExtraHeight + padding * 2;
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          const ctx = canvas.getContext('2d');

          // --- 4. Draw all elements onto the canvas ---

          // Background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);

          ctx.fillStyle = '#000000';
          ctx.textAlign = 'center';

          ctx.font = headerMetrics.font;
          const headerBaseline = padding + headerMetrics.fontSize;
          ctx.fillText(headerText, canvasWidth / 2, headerBaseline);

          const yearTopOffset = padding + headerMetrics.height + 90;

          if (yearLabel) {
            ctx.font = 'bold 120px system-ui, sans-serif';
            ctx.fillText(yearLabel, canvasWidth / 2, yearTopOffset);
          }

          ctx.font = 'bold 95px system-ui, sans-serif';
          ctx.fillText(pollutantTitle, canvasWidth / 2, padding + headerMetrics.height + yearHeight + 55);

          // Custom Legend - Larger Font and Dots
          let legendY = padding + headerMetrics.height + yearHeight + 155;
          legendLayout.rows.forEach(({ entries, width }) => {
            let x = (canvasWidth - width) / 2;
            entries.forEach(({ dotColor, text, faded, entryWidth }) => {
              ctx.globalAlpha = faded ? 0.5 : 1.0;
              ctx.beginPath();
              ctx.arc(x + 30, legendY - 27, 30, 0, 2 * Math.PI);
              ctx.fillStyle = dotColor;
              ctx.fill();
              ctx.font = legendLayout.font;
              ctx.fillStyle = '#000000';
              ctx.textAlign = 'left';
              ctx.fillText(text, x + 88, legendY);
              ctx.globalAlpha = 1.0;
              x += entryWidth;
            });
            legendY += legendLayout.rowHeight;
          });

          // Chart Image
          const chartY = padding + headerMetrics.height + yearHeight + titleHeight + legendHeight + 20;
          ctx.drawImage(img, padding, chartY, chartWidth, chartHeight);

          // --- 5. Draw Branding, Footer, then resolve ---
          const finishGeneration = () => {
            const {
              lineHeight,
              footerFont,
              footerFontBold,
              licenseLines,
              contactLines,
              measuredSegments,
              segmentSpacing
            } = footerLayout;
            let footerY = chartY + chartHeight + lineHeight;

            ctx.fillStyle = '#555';
            ctx.textAlign = 'center';
            ctx.font = footerFont;

            licenseLines.forEach((line, index) => {
              ctx.fillText(line, canvasWidth / 2, footerY + index * lineHeight);
            });
            footerY += licenseLines.length * lineHeight;

            if (contactLines.length) {
              footerY += 20;
              ctx.textAlign = 'left';
              contactLines.forEach(({ indices, width }, lineIndex) => {
                let lineX = (canvasWidth - width) / 2;
                indices.forEach((segmentIndex, idx) => {
                  const segment = measuredSegments[segmentIndex];
                  if (idx > 0) {
                    lineX += segmentSpacing;
                  }
                  ctx.font = footerFontBold;
                  ctx.fillText(segment.label, lineX, footerY);
                  lineX += segment.labelWidth;
                  ctx.font = footerFont;
                  ctx.fillText(segment.value, lineX, footerY);
                  lineX += segment.valueWidth;
                });
                if (lineIndex < contactLines.length - 1) {
                  footerY += lineHeight;
                }
              });
            }

            if (bannerConfig) {
              footerY += bannerConfig.spacingTop;
              const bannerX = (canvasWidth - bannerConfig.width) / 2;
              try {
                ctx.drawImage(bannerConfig.image, bannerX, footerY, bannerConfig.width, bannerConfig.height);
              } catch (err) {
                console.warn('Failed to draw CIC banner', err);
              }
              footerY += bannerConfig.height + bannerConfig.spacingBottom;
            }

            const dataURL = canvas.toDataURL('image/png');
            resolve(dataURL);
          };

          if (isNarrowExport) {
            finishGeneration();
          } else {
            const logo = new Image();
            logo.crossOrigin = 'anonymous';
            logo.onload = () => {
              try {
                const logoSize = 360; // Enlarged CIC logo for exports
                ctx.drawImage(logo, canvasWidth - logoSize - 30, 30, logoSize, logoSize);
              } catch (e) {
                console.warn('Logo failed to draw, continuing without logo:', e);
              }
              finishGeneration();
            };
            logo.onerror = () => {
              console.warn('Logo failed to load, continuing without logo');
              finishGeneration();
            };
            logo.src = '../SharedResources/images/CIC-Square-Border-Words-Alpha.svg';
          }

        } catch (error) {
          reject(error);
        } finally {
            // Final cleanup of the temporary URL
            if (svgBlobUrl) {
                URL.revokeObjectURL(svgBlobUrl);
            }
        }
      };
      img.onerror = (e) => {
        if (svgBlobUrl) {
            URL.revokeObjectURL(svgBlobUrl);
        }
        reject(new Error('Failed to load chart image for generation'));
      };
      img.src = uri;
    } catch (error) {
      if (svgBlobUrl) {
        URL.revokeObjectURL(svgBlobUrl);
      }
      reject(error);
    }
  });
}

// Convert data URL to Blob for clipboard
function dataURLtoBlob(dataURL) {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

document.addEventListener('DOMContentLoaded', () => {
  const downloadBtn = document.getElementById('downloadBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      try {
        const dataURL = await generateChartImage();
        const pollutant = document.getElementById('pollutantSelect').value;
        const startYear = +document.getElementById('startYear').value;
        const endYear = +document.getElementById('endYear').value;
        const firstCategory = getSelectedCategoryNames()[0];
        const filenameBase = buildLineFilenameBase({
          startYear,
          endYear,
          pollutantName: pollutant,
          firstCategoryName: firstCategory
        });
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `${filenameBase}.png`;
        link.click();
      } catch (error) {
        console.error('Failed to download chart image:', error);
        alert('Sorry, the chart image could not be downloaded. ' + error.message);
      }
    });
  }

  const cleanBtn = document.getElementById('downloadCleanBtn');
  if (cleanBtn) {
    cleanBtn.style.display = 'none'; // Hide the button
  }
});
