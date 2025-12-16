/**
 * Export and Share Module
 * Handles PNG export and share functionality for scatter charts
 */

const exportLogger = (() => {
  const logger = window.BubbleLogger;
  if (logger) {
    return {
      log: logger.tagged ? logger.tagged('export') : (...args) => {
        if (!logger.enabled) {
          return;
        }
        logger.log('[export]', ...args);
      },
      warn: logger.warn ? (...args) => {
        if (!logger.enabled) {
          return;
        }
        logger.warn('[export]', ...args);
      } : () => {}
    };
  }
  return {
    log: () => {},
    warn: (...args) => console.warn('[bubble:export]', ...args)
  };
})();

const bubbleChartTracker = () => window.ChartInteractionTracker?.track || window.trackChartInteraction;

function trackBubbleShareEvent(eventLabel, meta = {}) {
  const tracker = bubbleChartTracker();
  if (typeof tracker === 'function') {
    return tracker(eventLabel, meta, {
      chartType: 'bubblechart',
      pageSlug: '/bubblechart'
    });
  }
  return Promise.resolve(false);
}

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

function collectCategoryIdsFromChartData(chartData) {
  if (!chartData) {
    return [];
  }

  if (Array.isArray(chartData.categoryIds) && chartData.categoryIds.length) {
    return chartData.categoryIds;
  }

  const deduped = [];
  (chartData.dataPoints || []).forEach(point => {
    const id = point?.categoryId;
    if (id == null || deduped.includes(id)) {
      return;
    }
    deduped.push(id);
  });
  return deduped;
}

function resolveCategoryNameById(categoryId, fallbackPoints) {
  if (categoryId == null) {
    return null;
  }

  if (typeof window.supabaseModule?.getCategoryName === 'function') {
    const resolved = window.supabaseModule.getCategoryName(categoryId);
    if (resolved) {
      return resolved;
    }
  }

  if (Array.isArray(fallbackPoints) && fallbackPoints.length) {
    const match = fallbackPoints.find(point => point?.categoryId === categoryId);
    if (match?.categoryName) {
      return match.categoryName;
    }
  }

  return null;
}

function resolveCategoryShortTitleById(categoryId) {
  if (categoryId == null) {
    return null;
  }

  if (typeof window.supabaseModule?.getCategoryShortTitle === 'function') {
    const shortTitle = window.supabaseModule.getCategoryShortTitle(categoryId);
    if (shortTitle) {
      return shortTitle;
    }
  }
  return null;
}

function getSelectedCategoryCount(chartData) {
  return collectCategoryIdsFromChartData(chartData).length;
}

function buildBubbleFilenameBase(chartData) {
  if (!chartData) {
    return 'Bubble-Chart';
  }

  const pollutantShort = typeof window.supabaseModule?.getPollutantShortName === 'function'
    ? window.supabaseModule.getPollutantShortName(chartData.pollutantId)
    : null;

  const categoryIds = collectCategoryIdsFromChartData(chartData);
  const firstCategoryId = categoryIds.length ? categoryIds[0] : null;

  const categoryShort = resolveCategoryShortTitleById(firstCategoryId);

  const categoryName = resolveCategoryNameById(firstCategoryId, chartData.dataPoints)
    || chartData.dataPoints?.[0]?.categoryName
    || null;

  const yearSegment = sanitizeFilenameSegment(chartData.year ?? 'Year');
  const pollutantSegment = sanitizeFilenameSegment(pollutantShort || chartData.pollutantName || 'Pollutant');
  const categorySegment = sanitizeFilenameSegment(categoryShort || categoryName || 'Category');

  return `${yearSegment}_Bubble-Chart_${pollutantSegment}_${categorySegment}`;
}

function resolveEfConversionFactor(pollutantUnit) {
  if (!pollutantUnit || typeof pollutantUnit !== 'string') {
    exportLogger.warn('Missing pollutant unit while resolving EF conversion; defaulting to 1,000,000');
    return 1000000;
  }

  switch (pollutantUnit.trim().toLowerCase()) {
    case 't':
    case 'tonnes':
      return 1000;
    case 'grams international toxic equivalent':
      return 1000;
    case 'kilotonne':
    case 'kilotonne/kt co2 equivalent':
    case 'kt co2 equivalent':
      return 1000000;
    case 'kg':
      return 1;
    default:
      exportLogger.warn('Unknown pollutant unit for EF conversion, defaulting to 1,000,000:', pollutantUnit);
      return 1000000;
  }
}

function calculateEmissionFactor(point, conversionFactor) {
  if (!point) {
    return 0;
  }
  if (point.EF !== undefined && point.EF !== null) {
    return point.EF;
  }
  const activityValue = Number(point.actDataValue);
  const emissionsValue = Number(point.pollutantValue);
  if (!Number.isFinite(activityValue) || activityValue === 0 || !Number.isFinite(emissionsValue)) {
    return 0;
  }
  return (emissionsValue / activityValue) * conversionFactor;
}

const COMPARISON_ASSET_PATHS = {
  warningIcon: '../SharedResources/images/Warning%20triangle-alpha.svg',
  arrowGreen: '../SharedResources/images/green-arrow-alpha.svg',
  arrowRed: '../SharedResources/images/red-arrow-alpha.svg'
};

const BUBBLE_QR_BRAND_PATH = '../SharedResources/images/CIC-qrcode-Data-Explorer-bubblechart-brandimage.svg';
const CIC_LOGO_EXPORT_SIZE = 360;
const FOOTER_BRAND_GAP = 40;

let comparisonAssetCache = null;
let comparisonAssetPromise = null;

function loadComparisonAsset(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (error) => reject(error || new Error(`Failed to load asset: ${src}`));
    img.src = src;
  });
}

async function ensureComparisonAssets() {
  if (comparisonAssetCache) {
    return comparisonAssetCache;
  }
  if (!comparisonAssetPromise) {
    comparisonAssetPromise = Promise.all(
      Object.entries(COMPARISON_ASSET_PATHS).map(([key, src]) =>
        loadComparisonAsset(src)
          .then(image => ({ key, image }))
      )
    ).then(entries => {
      comparisonAssetCache = entries.reduce((acc, entry) => {
        acc[entry.key] = entry.image;
        return acc;
      }, {});
      return comparisonAssetCache;
    }).catch(error => {
      comparisonAssetPromise = null;
      throw error;
    });
  }
  return comparisonAssetPromise;
}

/**
 * Get chart SVG and convert to high-resolution image URI
 * @param {Object} chart - Google Charts instance
 * @param {HTMLElement} chartContainer - Chart container element
 * @returns {Promise<Object>} Object with uri, width, height, and svgBlobUrl
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

      // Clone the visible SVG and scale it for high resolution
      const exportScale = 3; // Use a fixed high-res scale
      const clonedSvg = svgEl.cloneNode(true);
      if (!clonedSvg.getAttribute('viewBox')) {
        clonedSvg.setAttribute('viewBox', `0 0 ${origW} ${origH}`);
      }
      clonedSvg.setAttribute('width', Math.round(origW * exportScale));
      clonedSvg.setAttribute('height', Math.round(origH * exportScale));

      // Create a blob from the SVG string and generate an object URL
      const svgString = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
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

/**
 * Generate comprehensive chart image with title, legend, and footer
 * @returns {Promise<string>} Base64 encoded PNG data URL
 */
async function generateChartImage() {
  return new Promise(async (resolve, reject) => {
    let svgBlobUrl = null; // To hold the temporary blob URL for cleanup
    try {
      const chart = window.ChartRenderer.getChartInstance();
      const chartData = window.ChartRenderer.getCurrentChartData();
      
      if (!chart || !chartData) {
        return reject(new Error('Chart not available'));
      }

      const chartContainer = document.getElementById('chart_div');
      
      // Get the high-resolution chart URI from the visible chart's SVG
      const { uri, width: chartWidth, height: chartHeight, svgBlobUrl: blobUrl } = await getChartImageURI(chart, chartContainer);
      svgBlobUrl = blobUrl; // Store for cleanup

      if (!uri) {
        return reject(new Error('Failed to generate chart image URI'));
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          if (document.fonts && typeof document.fonts.load === 'function') {
            try {
              await document.fonts.load('400 60px "Tiresias Infofont"');
            } catch (fontErr) {
              exportLogger.warn('Tiresias font failed to load before export; falling back to system font.', fontErr);
            }
          }

          const pollutantName = chartData.pollutantName;
          const pollutantUnit = chartData.pollutantUnit;
          const pollutantUnitMeta = window.EmissionUnits?.getUnitMeta
            ? window.EmissionUnits.getUnitMeta(pollutantUnit)
            : null;
          const isActivityPollutant = window.EmissionUnits?.isActivityUnit
            ? window.EmissionUnits.isActivityUnit(pollutantUnitMeta || pollutantUnit)
            : false;
          const normalizedPollutantName = pollutantName || 'Selected Pollutant';
          const chartTitleText = isActivityPollutant
            ? 'Activity Data'
            : `UK ${normalizedPollutantName} Emissions`;
          const year = chartData.year;
          const padding = 50;
          const legendTopGap = 90; // Visual breathing room between year label and legend
          const yearFontSize = 140;
          const yearLineHeight = yearFontSize + 30;
          const baseChartWidth = chartContainer?.offsetWidth || chartWidth;
          const logicalCanvasWidth = baseChartWidth + padding * 2;
          const isNarrowExport = logicalCanvasWidth < 768;
          const canvasWidth = chartWidth + padding * 2;
          const loadImageElement = (src) => new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = src;
          });

          // Set up the final canvas dimensions
          const measureCanvas = document.createElement('canvas');
          const measureCtx = measureCanvas.getContext('2d');
          const buildChartTitleMetrics = width => {
            const titleFontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const maxWidth = Math.max(320, width - 220);
            let fontSize = 90;
            const minFontSize = 55;
            let font = `600 ${fontSize}px ${titleFontFamily}`;
            const titleSample = chartTitleText || '';
            measureCtx.font = font;
            while (measureCtx.measureText(titleSample).width > maxWidth && fontSize > minFontSize) {
              fontSize -= 2;
              font = `600 ${fontSize}px ${titleFontFamily}`;
              measureCtx.font = font;
            }
            const lineHeight = fontSize + 32;
            return {
              font,
              fontSize,
              height: lineHeight
            };
          };
          const buildFooterLayout = (width, options = {}) => {
            const reservedSideWidth = Math.max(0, options.reservedSideWidth || 0);
            const minContentHeight = Math.max(0, options.minContentHeight || 0);
            const compactFooter = width < 768;
            const footerFontSize = compactFooter ? 42 : 52;
            const lineHeight = compactFooter ? 50 : 60;
            const footerFontFamily = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const footerFont = `${footerFontSize}px ${footerFontFamily}`;
            const footerFontBold = `600 ${footerFontSize}px ${footerFontFamily}`;
            const availableTextWidth = Math.max(0, width - reservedSideWidth * 2);
            const textAreaWidth = Math.min(
              availableTextWidth,
              Math.max(320, availableTextWidth - 80)
            );
            const maxLineWidth = textAreaWidth;
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
            const totalTextHeight = topPadding + licenseHeight + contactSpacingHeight + contactHeight;
            const totalHeight = Math.max(minContentHeight, totalTextHeight);
            return {
              lineHeight,
              footerFont,
              footerFontBold,
              licenseLines,
              contactLines,
              measuredSegments,
              segmentSpacing,
              totalHeight,
              contactSegmentWidth: textAreaWidth,
              textAreaWidth,
              topPadding,
              reservedSideWidth
            };
          };

          const buildLegendLayout = (width, chartData) => {
            const fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const emptyLayout = {
              rows: [],
              totalHeight: 0,
              rowHeight: 92,
              font: '600 70px system-ui, sans-serif'
            };
            const legendDiv = document.getElementById('customLegend');
            const visibility = window.seriesVisibility || [];
            const domItems = legendDiv
              ? [...legendDiv.children].filter(el => el.tagName === 'SPAN').map((item, index) => {
                  const dot = item.querySelector('span');
                  if (!dot) {
                    return null;
                  }
                  if (visibility[index] === false) {
                    return null;
                  }
                  return {
                    text: item.textContent.trim(),
                    dotColor: dot.style.backgroundColor,
                    faded: item.textContent.includes('(No data available)')
                  };
                }).filter(Boolean)
              : [];

            let sourceItems = domItems;

            if (!sourceItems.length && chartData) {
              const categoryOrder = collectCategoryIdsFromChartData(chartData);
              const pointsByCategoryId = new Map(
                (chartData.dataPoints || []).map(point => [point.categoryId, point])
              );
              sourceItems = categoryOrder.map(categoryId => {
                const point = pointsByCategoryId.get(categoryId);
                const categoryName = point?.categoryName
                  || resolveCategoryNameById(categoryId, chartData.dataPoints)
                  || `Category ${categoryId}`;
                const hasData = Boolean(point);
                const dotColor = typeof window.Colors?.getColorForCategory === 'function'
                  ? window.Colors.getColorForCategory(categoryName)
                  : '#000000';
                return {
                  text: hasData ? categoryName : `${categoryName} (No data available)`,
                  dotColor,
                  faded: !hasData
                };
              });
            }

            if (!sourceItems.length) {
              return emptyLayout;
            }

            const rows = [];
            let row = [];
            let rowW = 0;
            const baseFontSize = 70;
            const minFontSize = 40;
            const rowPadding = 22;
            const entryPadding = 138;
            const maxW = width - padding * 2;
            const measureText = size => {
              measureCtx.font = `600 ${size}px ${fontFamily}`;
              return text => measureCtx.measureText(text).width;
            };
            const buildEntries = size => {
              const measure = measureText(size);
              let maxEntryWidth = 0;
              const entries = sourceItems.map(item => {
                const textWidth = measure(item.text);
                const entryWidth = textWidth + entryPadding;
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

            const legendRowHeight = Math.round(legendFontSize + rowPadding);
            return {
              rows,
              totalHeight: rows.length * legendRowHeight,
              rowHeight: legendRowHeight,
              font: `600 ${legendFontSize}px ${fontFamily}`
            };
          };

          const titleMetrics = buildChartTitleMetrics(canvasWidth);

          let brandConfig = null;
          try {
            const bubbleQrImage = await loadImageElement(BUBBLE_QR_BRAND_PATH);
            const naturalWidth = bubbleQrImage.naturalWidth || CIC_LOGO_EXPORT_SIZE;
            const naturalHeight = bubbleQrImage.naturalHeight || CIC_LOGO_EXPORT_SIZE;
            const targetWidth = CIC_LOGO_EXPORT_SIZE;
            const targetHeight = Math.round((targetWidth / naturalWidth) * naturalHeight);
            brandConfig = {
              image: bubbleQrImage,
              width: targetWidth,
              height: targetHeight,
              spacingTop: 0,
              spacingBottom: 0
            };
          } catch (err) {
            exportLogger.warn('Bubblechart QR brand image failed to load', err);
          }

          const brandReserveWidth = brandConfig ? brandConfig.width + FOOTER_BRAND_GAP : FOOTER_BRAND_GAP;
          const footerLayout = buildFooterLayout(canvasWidth, {
            reservedSideWidth: brandReserveWidth,
            minContentHeight: brandConfig?.height || 0
          });
          const legendLayout = buildLegendLayout(canvasWidth, chartData);
          const efTextLineHeight = 70;
          const legendSpacing = legendLayout.rows.length ? efTextLineHeight * 2 : 0;
          const legendHeight = legendLayout.totalHeight + legendSpacing;
          const titleBlockHeight = titleMetrics.height + yearLineHeight + legendTopGap;
          const comparisonExportState = getComparisonExportState();
          let comparisonAssets = null;
          if (comparisonExportState) {
            try {
              comparisonAssets = await ensureComparisonAssets();
            } catch (assetError) {
              exportLogger.warn('Comparison assets failed to preload for export; falling back to vector shapes.', assetError);
            }
          }
          const comparisonLayouts = comparisonExportState
            ? buildComparisonExportLayouts({
                width: canvasWidth,
                padding,
                measureCtx,
                data: comparisonExportState,
                assets: comparisonAssets
              })
            : null;
          const comparisonCardsHeight = comparisonLayouts?.cards?.totalHeight || 0;
          const comparisonDetailsHeight = comparisonLayouts?.details?.totalHeight || 0;

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
              exportLogger.warn('CIC banner failed to load for narrow export', err);
            }
          }

          const bannerExtraHeight = bannerConfig ? bannerConfig.spacingTop + bannerConfig.height + bannerConfig.spacingBottom : 0;

          const canvas = document.createElement('canvas');
          const canvasHeight = titleBlockHeight
            + legendHeight
            + comparisonCardsHeight
            + chartHeight
            + comparisonDetailsHeight
            + footerLayout.totalHeight
            + bannerExtraHeight
            + padding * 2;
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          const ctx = canvas.getContext('2d');

          // Draw all elements onto the canvas

          // Background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);

          // Title (new layout matches on-screen header)
          ctx.font = titleMetrics.font;
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'center';
          const titleBaseline = padding + titleMetrics.fontSize;
          ctx.fillText(chartTitleText, canvasWidth / 2, titleBaseline);

          const yearBaseline = padding + titleMetrics.height + yearFontSize;
          ctx.font = `700 ${yearFontSize}px system-ui, sans-serif`;
          ctx.fillText(year, canvasWidth / 2, yearBaseline);

          // Custom Legend - Larger Font and Dots (starts after title area)
          let legendY = padding + titleMetrics.height + yearLineHeight + legendTopGap; // matches new spacing below year label
          legendLayout.rows.forEach(({ entries, width }) => {
            let x = (canvasWidth - width) / 2;
            entries.forEach(({ dotColor, text, entryWidth }) => {
              ctx.beginPath();
              ctx.arc(x + 30, legendY - 27, 30, 0, 2 * Math.PI); // Larger dots to match font
              ctx.fillStyle = dotColor;
              ctx.fill();
              ctx.font = legendLayout.font;
              ctx.fillStyle = '#000000';
              ctx.textAlign = 'left';
              ctx.fillText(text, x + 88, legendY);
              x += entryWidth;
            });
            legendY += legendLayout.rowHeight;
          });

          // Calculate conversion factor and EF values BEFORE drawing text
          // Determine conversion factor based on pollutant unit
          let conversionFactor;
          switch(pollutantUnit.toLowerCase()) {
            case 't':
            case 'tonnes':
              conversionFactor = 1000;
              break;
            case 'grams international toxic equivalent':
              conversionFactor = 1000;
              break;
            case 'kilotonne':
            case 'kilotonne/kt co2 equivalent':
            case 'kt co2 equivalent':
              conversionFactor = 1000000;
              break;
            case 'kg':
              conversionFactor = 1;
              break;
            default:
              conversionFactor = 1000000;
          }

          // Get visible data points for EF calculation
          const dataPoints = chartData.dataPoints || [];
          const categoryOrdering = collectCategoryIdsFromChartData(chartData);
          const visibleDataPoints = dataPoints.filter(point => {
            if (!categoryOrdering.length || !window.seriesVisibility) {
              return true;
            }
            const categoryId = point.categoryId;
            const categoryIndex = categoryOrdering.indexOf(categoryId);
            if (categoryIndex === -1) {
              return true;
            }
            return window.seriesVisibility[categoryIndex] !== false;
          });

          // Calculate all EF values for scaling
          const allEFs = visibleDataPoints.map(p => 
            p.EF !== undefined ? p.EF : (p.actDataValue !== 0 ? (p.pollutantValue / p.actDataValue) * conversionFactor : 0)
          );
          const maxEF = Math.max(...allEFs);
          const minEF = Math.min(...allEFs.filter(ef => ef > 0));

          // Determine if logarithmic scaling should be used
          const efRatio = maxEF / minEF;
          const useLogScale = efRatio > 1000;

          // EF explanation text - place below legend (not on chart)
          const efTextY = legendY + 20; // Offset below legend block
          ctx.font = '58px system-ui, sans-serif';
          ctx.fillStyle = '#555555';
          ctx.textAlign = 'center';
          const efText = useLogScale
            ? 'Bubble size proportional to log₁₀(Emission Factor) — logarithmic scale used due to wide EF range'
            : 'Bubble size proportional to Emission Factor (area-scaled, radius = √EF)';
          const maxEfWidth = canvasWidth - padding * 2;
          const words = efText.split(' ');
          const lines = [];
          let currentLine = '';
          words.forEach(word => {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(testLine).width <= maxEfWidth) {
              currentLine = testLine;
            } else {
              if (currentLine) {
                lines.push(currentLine);
              }
              currentLine = word;
            }
          });
          if (currentLine) {
            lines.push(currentLine);
          }
          lines.forEach((line, index) => {
            ctx.fillText(line, canvasWidth / 2, efTextY + index * efTextLineHeight);
          });
          legendY = efTextY + lines.length * efTextLineHeight;

          if (comparisonLayouts?.cards) {
            const cardsStartY = padding + titleBlockHeight + legendHeight;
            comparisonLayouts.cards.draw(ctx, cardsStartY);
          }

          // Chart Image - with precise clipping on top and right only (no borders there)
          const chartY = padding + titleBlockHeight + legendHeight + comparisonCardsHeight + 20; // Tight gap before chart
          
          // Chart area boundaries from chart-renderer.js (scaled by exportScale = 3)
          const exportScale = 3;
          const chartAreaTop = 70 * exportScale;      // Matching chart renderer chartArea.top
          const chartAreaRight = 80 * exportScale;    // Matching chart renderer chartArea.right
          
          ctx.save();
          const maxBubbleRadiusPx = 90 * exportScale;
          const topClipAllowance = Math.max(0, chartAreaTop - Math.max(0, maxBubbleRadiusPx - 8));
          const rightClipAllowance = Math.max(0, chartAreaRight - Math.max(0, maxBubbleRadiusPx - 8));
          const clipX = padding;
          const clipY = chartY + topClipAllowance;
          const clipW = chartWidth - rightClipAllowance;
          const clipH = chartHeight - topClipAllowance;
          ctx.beginPath();
          ctx.rect(clipX, clipY, clipW, clipH);
          ctx.clip();
          ctx.drawImage(img, padding, chartY, chartWidth, chartHeight);
          ctx.restore();

          // Draw EF labels on bubbles
          // (visibleDataPoints, conversionFactor, allEFs, maxEF, minEF, efRatio, useLogScale already calculated above)

          // Get axis ranges from chart options
          const chartOptions = chartData.options;
          const xMax = chartOptions.hAxis.viewWindow.max;
          const yMax = chartOptions.vAxis.viewWindow.max;
          
          // Use existing chartArea variables (already defined above for clipping)
          // chartAreaTop and chartAreaRight are already defined as 80 * exportScale
          const plotWidth = chartWidth - (150 * exportScale) - chartAreaRight;
          const plotHeight = chartHeight - chartAreaTop - (120 * exportScale);

          // Calculate scaleFactor exactly as chart-renderer.js does
          const targetMaxRadius = 90;
          const targetMinRadius = 5;
          let scaleFactor;
          
          if (useLogScale) {
            const maxLog = Math.log10(maxEF);
            const minLog = Math.log10(minEF);
            const logRange = maxLog - minLog;
            scaleFactor = (targetMaxRadius - targetMinRadius) / logRange;
          } else {
            scaleFactor = targetMaxRadius / Math.sqrt(maxEF);
            const minRadiusWithMaxScale = scaleFactor * Math.sqrt(minEF);
            
            if (minRadiusWithMaxScale < targetMinRadius) {
              scaleFactor = targetMinRadius / Math.sqrt(minEF);
            }
          }

          const placedLabelBoxes = [];
          const labelPlacements = visibleDataPoints
            .map(point => {
              if (!point || typeof point.actDataValue !== 'number' || typeof point.pollutantValue !== 'number') {
                return null;
              }

              const emissionFactor = point.EF !== undefined ? point.EF :
                (point.actDataValue !== 0 ? (point.pollutantValue / point.actDataValue) * conversionFactor : 0);

              const xRatio = point.actDataValue / xMax;
              const yRatio = 1 - (point.pollutantValue / yMax);
              const bubbleX = padding + (150 * exportScale) + (xRatio * plotWidth);
              const bubbleY = chartY + chartAreaTop + (yRatio * plotHeight);

              let bubbleRadius;
              if (useLogScale && emissionFactor > 0) {
                const logEF = Math.log10(emissionFactor);
                const logMin = Math.log10(minEF);
                const logMax = Math.log10(maxEF);
                const logPosition = (logEF - logMin) / (logMax - logMin);
                const radius = targetMinRadius + (logPosition * (targetMaxRadius - targetMinRadius));
                bubbleRadius = radius * exportScale;
              } else {
                const sqrtEF = Math.sqrt(emissionFactor);
                bubbleRadius = (scaleFactor * sqrtEF) * exportScale;
              }

              return {
                point,
                emissionFactor,
                bubbleX,
                bubbleY,
                bubbleRadius
              };
            })
            .filter(Boolean)
            .sort((a, b) => b.bubbleY - a.bubbleY); // place lower labels first so upper ones can nudge upward

          const boxesOverlap = (a, b) => {
            return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
          };

          labelPlacements.forEach(({ point, emissionFactor, bubbleX, bubbleY, bubbleRadius }) => {
            const efDisplay = emissionFactor < 0.01 ? emissionFactor.toFixed(8) : emissionFactor.toFixed(2);
            const labelText = `${efDisplay} g/GJ`;
            const categoryLabel = point.categoryName || 'Category';
            const bubbleColor = window.Colors && typeof window.Colors.getColorForCategory === 'function'
              ? window.Colors.getColorForCategory(categoryLabel)
              : '#000000';

            ctx.font = '400 70px "Tiresias Infofont", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            const labelX = bubbleX + bubbleRadius + 20;
            let labelY = bubbleY;

            const desiredInnerStroke = 1.5;
            const desiredOuterStroke = 3;
            const innerStrokeWidth = desiredInnerStroke * exportScale;
            const outerStrokeWidth = desiredOuterStroke * exportScale;

            ctx.lineJoin = 'round';
            ctx.miterLimit = 2;

            const charSpacing = 0.5 * exportScale;
            const characters = [...labelText];
            const glyphWidths = characters.map(char => ctx.measureText(char).width);
            const labelWidth = glyphWidths.reduce((sum, width) => sum + width, 0)
              + (characters.length > 1 ? charSpacing * (characters.length - 1) : 0);
            const textMetrics = ctx.measureText(labelText);
            const labelHeight = Math.max(
              (textMetrics.actualBoundingBoxAscent || 0) + (textMetrics.actualBoundingBoxDescent || 0),
              70
            );
            const halfHeight = labelHeight / 2;
            const verticalStep = Math.max(labelHeight * 0.6, 25 * exportScale);

            const buildBox = (centerY) => ({
              left: labelX,
              right: labelX + labelWidth,
              top: centerY - halfHeight,
              bottom: centerY + halfHeight
            });

            let labelBox = buildBox(labelY);
            let guard = 0;
            const maxAdjustments = 25;
            const minimumLabelTop = chartY;
            while (placedLabelBoxes.some(existing => boxesOverlap(existing, labelBox)) && guard < maxAdjustments) {
              labelY -= verticalStep;
              if (labelY - halfHeight < minimumLabelTop) {
                labelY = minimumLabelTop + halfHeight;
                break;
              }
              labelBox = buildBox(labelY);
              guard += 1;
            }
            placedLabelBoxes.push(labelBox);

            let currentX = labelX;
            characters.forEach((char, index) => {
              ctx.lineWidth = outerStrokeWidth;
              ctx.strokeStyle = 'rgba(255,255,255,0.95)';
              ctx.strokeText(char, currentX, labelY);

              ctx.lineWidth = innerStrokeWidth;
              ctx.strokeStyle = '#000000';
              ctx.strokeText(char, currentX, labelY);

              ctx.fillStyle = bubbleColor;
              ctx.fillText(char, currentX, labelY);

              currentX += glyphWidths[index];
              if (index < characters.length - 1) {
                currentX += charSpacing;
              }
            });
          });

          if (comparisonLayouts?.details) {
            comparisonLayouts.details.draw(ctx, chartY + chartHeight);
          }

          // Draw Branding and Footer
          const finishGeneration = () => {
            const {
              lineHeight,
              footerFont,
              footerFontBold,
              licenseLines,
              contactLines,
              measuredSegments,
              segmentSpacing,
              textAreaWidth,
              topPadding,
              reservedSideWidth,
              totalHeight
            } = footerLayout;
            const footerBlockTop = chartY + chartHeight + comparisonDetailsHeight;
            const textCenterX = canvasWidth / 2;
            const contactSectionHeight = contactLines.length
              ? 20 + contactLines.length * lineHeight
              : 0;
            const textContentHeight = topPadding + (licenseLines.length * lineHeight) + contactSectionHeight;
            const textBlockTop = footerBlockTop + Math.max(0, (totalHeight - textContentHeight) / 2);
            let footerY = textBlockTop + topPadding;

            ctx.fillStyle = '#555';
            ctx.textAlign = 'center';
            ctx.font = footerFont;

            if (brandConfig) {
              const brandX = padding;
              const brandY = footerBlockTop + Math.max(0, (totalHeight - brandConfig.height) / 2);
              try {
                ctx.drawImage(brandConfig.image, brandX, brandY, brandConfig.width, brandConfig.height);
              } catch (err) {
                exportLogger.warn('Failed to draw bubblechart QR brand image', err);
              }
            }

            licenseLines.forEach(line => {
              ctx.fillText(line, textCenterX, footerY);
              footerY += lineHeight;
            });

            if (contactLines.length) {
              footerY += 20;
              ctx.textAlign = 'left';
              contactLines.forEach(({ indices, width }, lineIndex) => {
                const lineWidth = width || 0;
                let lineX = textCenterX - lineWidth / 2;
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
              ctx.textAlign = 'center';
            }

            footerY = textBlockTop + textContentHeight;

            if (bannerConfig) {
              footerY += bannerConfig.spacingTop;
              const bannerX = (canvasWidth - bannerConfig.width) / 2;
              try {
                ctx.drawImage(bannerConfig.image, bannerX, footerY, bannerConfig.width, bannerConfig.height);
              } catch (err) {
                exportLogger.warn('Failed to draw CIC banner', err);
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
                const logoSize = CIC_LOGO_EXPORT_SIZE; // Keep CIC logo consistent with QR badge
                ctx.drawImage(logo, canvasWidth - logoSize - 30, 30, logoSize, logoSize);
              } catch (e) {
                exportLogger.warn('Logo failed to draw, continuing without logo:', e);
              }
              finishGeneration();
            };
            logo.onerror = () => {
              exportLogger.warn('Logo failed to load, continuing without logo');
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
      reject(new Error(`SVG processing failed: ${error.message}`));
    }
  });
}

/**
 * Download chart as PNG file
 */
async function downloadChartPNG() {
  try {
    const chartData = window.ChartRenderer.getCurrentChartData();
    if (!chartData) {
      alert('No chart available to download');
      return;
    }
    const categoryCount = getSelectedCategoryCount(chartData);

    const imageData = await generateChartImage();
    const link = document.createElement('a');
    const filename = `${buildBubbleFilenameBase(chartData)}.png`;
    link.download = filename;
    link.href = imageData;
    link.click();

    // Track analytics
    trackBubbleShareEvent('bubblechart_downloaded', {
      year: chartData.year,
      pollutant: chartData.pollutantName,
      category_count: categoryCount,
      filename
    });
  } catch (error) {
    console.error('Failed to download chart:', error);
    alert('Failed to download chart: ' + error.message);
  }
}

/**
 * Convert data URL to Blob
 */
function dataURLtoBlob(dataURL) {
  const parts = dataURL.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Show share dialog
 */
function resolveBubbleShareCategories(chartData) {
  const fromSelectors = typeof window.getSelectedCategories === 'function'
    ? window.getSelectedCategories().filter(Boolean)
    : [];
  if (fromSelectors.length) {
    return fromSelectors;
  }

  const categoryIds = collectCategoryIdsFromChartData(chartData);
  if (categoryIds.length) {
    const byId = categoryIds
      .map(categoryId => resolveCategoryNameById(categoryId, chartData?.dataPoints))
      .filter(Boolean);
    if (byId.length) {
      return byId;
    }
  }

  if (Array.isArray(chartData?.dataPoints) && chartData.dataPoints.length) {
    const deduped = [];
    chartData.dataPoints.forEach(point => {
      const name = point?.categoryName;
      if (name && !deduped.includes(name)) {
        deduped.push(name);
      }
    });
    if (deduped.length) {
      return deduped;
    }
  }

  return [];
}

function resolveShareUrl(queryString) {
  if (window.NAEIUrlState?.buildShareUrl) {
    return window.NAEIUrlState.buildShareUrl(queryString);
  }
  return legacyShareUrlFallback(queryString);
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

async function copyChartImageSilently() {
  if (!(navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined')) {
    const error = new Error('Your browser does not support copying images to the clipboard.');
    error.code = 'CLIPBOARD_UNSUPPORTED';
    throw error;
  }

  const chartImageData = await generateChartImage();
  const blob = dataURLtoBlob(chartImageData);
  const clipboardItem = new ClipboardItem({ 'image/png': blob });
  await navigator.clipboard.write([clipboardItem]);
}

function legacyShareUrlFallback(queryString) {
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
  const normalizedQuery = typeof queryString === 'string' ? queryString.replace(/^[?&]+/, '') : '';
  return normalizedQuery
    ? `${currentUrl.origin}${basePath}?${normalizedQuery}`
    : `${currentUrl.origin}${basePath}`;
}

function showShareDialog() {
  const chartData = window.ChartRenderer.getCurrentChartData();
  if (!chartData) {
    alert('No chart available to share');
    return;
  }

  // Build shareable URL with parameters matching updateURL() format
  // Get category IDs with comparison flags ('c' suffix if checkbox is checked)
  const categoryRows = document.querySelectorAll('.categoryRow');
  const selectedCategoryIds = collectCategoryIdsFromChartData(chartData);
  const selectedCategoryCount = selectedCategoryIds.length;

  const categoryIdsWithFlags = selectedCategoryIds.map((categoryId, index) => {
    const row = categoryRows[index];
    const checkbox = row?.querySelector('.comparison-checkbox');
    const isChecked = checkbox?.checked || false;
    return isChecked ? `${categoryId}c` : `${categoryId}`;
  });

  // Format: pollutant_id, category_ids, year (year at the end)
  const query = `chart=1&pollutant_id=${chartData.pollutantId}&category_ids=${categoryIdsWithFlags.join(',')}&year=${chartData.year}`;
  const shareUrl = resolveShareUrl(query);
  const displayShareUrl = formatShareUrlForDisplay(shareUrl) || shareUrl;

  const shareCategoryNames = resolveBubbleShareCategories(chartData);
  const categorySummary = shareCategoryNames.length ? shareCategoryNames.join(', ') : 'Selected Categories';
  const yearSuffix = chartData.year ? ` (${chartData.year})` : '';
  const title = `${chartData.pollutantName} - ${categorySummary}${yearSuffix}`;

  // Create dialog
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
  
  dialog.onclick = (e) => {
    if (e.target === dialog) {
      document.body.removeChild(dialog);
    }
  };

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
        <img src="../SharedResources/images/clipboard_painting_icon_mjh-bubble-200x231.svg" alt="Copy Chart Image" style="height: 32px; width: auto; vertical-align: middle; margin-right: 8px;"> Copy Chart Image as PNG to clipboard
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
      
      trackBubbleShareEvent('bubblechart_share_url_copied', {
        year: chartData.year,
        pollutant: chartData.pollutantName,
        category_count: selectedCategoryCount
      });
      
      setTimeout(() => {
        resetButtonState(copyUrlBtn, copyUrlDefaultHtml, copyUrlDefaultBg);
      }, 2000);
    } catch (err) {
      // Fallback for older browsers
      const input = content.querySelector('#shareUrlInput');
      input.select();
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
        
        trackBubbleShareEvent('bubblechart_share_png_copied', {
          year: chartData.year,
          pollutant: chartData.pollutantName,
          category_count: selectedCategoryCount
        });
        
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

  // Email share functionality
  content.querySelector('#emailShareBtn').addEventListener('click', async () => {
    try {
      await copyChartImageSilently();

      trackBubbleShareEvent('bubblechart_share_email_opened', {
        year: chartData.year,
        pollutant: chartData.pollutantName,
        category_count: selectedCategoryCount,
        share_url: shareUrl
      });

      const emailPayload = window.EmailShareHelper
        ? window.EmailShareHelper.composeEmail({
            pollutantName: chartData.pollutantName,
            singleYear: chartData.year,
            shareUrl,
            categories: shareCategoryNames
          })
        : null;

      if (emailPayload && window.EmailShareHelper) {
        window.EmailShareHelper.openEmailClient(emailPayload);
      } else {
        const fallbackSubject = `UK Air Pollution/Emissions Data: ${chartData.pollutantName || ''} ${chartData.year || ''}`.trim();
        const readableShare = displayShareUrl || readableShareUrl(shareUrl);
        const fallbackBody = [
          `I'm sharing UK air pollution/emissions data for ${chartData.pollutantName || 'this chart'}.`,
          '',
          readableShare ? `Interactive chart: ${readableShare}` : '',
          '',
          'Generated by the Chronic Illness Channel UK Air Pollution/Emissions Data Explorer',
          'chronicillnesschannel.co.uk/data-explorer'
        ]
          .filter(Boolean)
          .join('\n');
        const encodedSubject = encodeURIComponent(fallbackSubject);
        const encodedBody = encodeURIComponent(fallbackBody);
        window.location.href = `mailto:?subject=${encodedSubject}&body=${encodedBody}`;
      }
    } catch (error) {
      if (error?.code === 'CLIPBOARD_UNSUPPORTED') {
        alert('Your browser doesn\'t support copying images to clipboard.');
        return;
      }
      console.error('Failed to copy image for email:', error);
      alert('Failed to copy chart image: ' + error.message);
    }
  });

  // Close button
  content.querySelector('#closeShareBtn').addEventListener('click', () => {
    document.body.removeChild(dialog);
  });
}

/**
 * Export scatter chart data to CSV or Excel
 * @param {string} format - 'csv' or 'xlsx'
 */
function exportData(format = 'csv') {
  const chartData = window.ChartRenderer.getCurrentChartData();
  
  if (!chartData || !chartData.dataPoints || chartData.dataPoints.length === 0) {
    alert('No chart data available to export. Please select a pollutant, categories, and year first.');
    return;
  }

  const pollutantName = chartData.pollutantName;
  const pollutantUnit = window.supabaseModule.getPollutantUnit(chartData.pollutantId);
  const efConversionFactor = resolveEfConversionFactor(pollutantUnit);
  const actDataId = window.supabaseModule.actDataPollutantId || window.supabaseModule.activityDataId;
  const activityUnit = window.supabaseModule.getPollutantUnit(actDataId);
  const year = chartData.year;
  const dataPoints = chartData.dataPoints;
  const selectedCategoryIds = collectCategoryIdsFromChartData(chartData);
  const categoryCount = selectedCategoryIds.length || dataPoints.length;

  const csvNumberFormatter = new Intl.NumberFormat('en-US', {
    useGrouping: false,
    notation: 'standard',
    maximumFractionDigits: 20
  });

  const applyCsvCellFormat = (value) => {
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
  };

  const formatCsvValue = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return applyCsvCellFormat(csvNumberFormatter.format(value));
    }
    return applyCsvCellFormat(value ?? '');
  };

  const toNumberOrEmpty = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : '';
  };

  // Track export analytics
  trackBubbleShareEvent('bubblechart_data_export', {
    format,
    pollutant: pollutantName,
    year,
    category_count: categoryCount
  });

  // Build rows
  const rows = [];
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);

  // Header rows
  rows.push([`Pollutant: ${pollutantName}`, `Emission Unit: ${pollutantUnit}`, `Year: ${year}`]);
  rows.push([]); // spacer row
  
  // Column headers - use hyphens instead of brackets to match chart formatting
  rows.push(['Category', `Activity Data - ${activityUnit}`, `Emissions - ${pollutantUnit}`, 'Emission Factor - g/GJ']);

  // Data rows
  dataPoints.forEach(point => {
    const emissionFactor = calculateEmissionFactor(point, efConversionFactor);

    const categoryLabel = point.categoryName || 'Category';
    rows.push([
      categoryLabel,
      toNumberOrEmpty(point.actDataValue),
      toNumberOrEmpty(point.pollutantValue),
      toNumberOrEmpty(emissionFactor)
    ]);
  });

  rows.push([]); // spacer
  rows.push([`Downloaded on: ${timestamp}`]);

  // Generate and download file
  const filename = buildBubbleFilenameBase(chartData);

  if (format === 'csv') {
    const csvContent = rows
      .map(row => row.map(formatCsvValue).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
  } else if (format === 'xlsx') {
    // Check if XLSX library is loaded
    if (typeof XLSX === 'undefined') {
      alert('Excel export library not loaded. Please use CSV format instead.');
      return;
    }
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Auto-size columns with explicit width metadata understood by Excel/Numbers/Sheets
    const measuredWidths = [];
    rows.forEach(row => {
      row.forEach((cell, colIndex) => {
        if (cell == null) {
          return;
        }

        const text = String(cell);
        const longestLine = text
          .split(/\r?\n/)
          .reduce((max, part) => Math.max(max, part.length), 0);
        const length = Math.max(longestLine, text.length) + 2; // padding

        if (!measuredWidths[colIndex] || length > measuredWidths[colIndex]) {
          measuredWidths[colIndex] = length;
        }
      });
    });

    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const columnDefs = Array.from({ length: columnCount }, (_, idx) => {
      const rawWidth = measuredWidths[idx] || 12;
      const charWidth = Math.min(32, Math.max(10, rawWidth));
      const pixelWidth = Math.max(60, Math.round(charWidth * 6.5));
      return {
        wch: charWidth,
        wpx: pixelWidth,
        customWidth: 1
      };
    });
    ws['!cols'] = columnDefs;

    const dataRowStartIndex = 3; // zero-based index where data rows begin
    const dataRowEndIndex = dataRowStartIndex + dataPoints.length;
    const numberColumns = [
      { index: 1, format: '0.####################' },
      { index: 2, format: '0.####################' },
      { index: 3, format: '0.####################' }
    ];

    numberColumns.forEach(({ index, format }) => {
      for (let r = dataRowStartIndex; r < dataRowEndIndex; r += 1) {
        const cellRef = XLSX.utils.encode_cell({ r, c: index });
        const cell = ws[cellRef];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = format;
        }
      }
    });

    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }
}

// Export functions
window.ExportShare = {
  downloadChartPNG,
  showShareDialog,
  generateChartImage,
  exportData
};

function getComparisonExportState() {
  const payload = window.__bubbleComparisonExport;
  if (!payload || !payload.visible || !payload.cards?.left || !payload.cards?.right) {
    return null;
  }
  return payload;
}

function buildComparisonExportLayouts({ width, padding, measureCtx, data, assets }) {
  const cards = buildComparisonCardsLayout({ width, padding, data, measureCtx, assets });
  const details = buildComparisonDetailsLayout({ width, padding, data, measureCtx });
  if (!cards && !details) {
    return null;
  }
  return { cards, details };
}

function buildComparisonCardsLayout({ width, padding, data, measureCtx, assets }) {
  const cards = data?.cards;
  if (!cards?.left || !cards?.right) {
    return null;
  }
  const viewportWidth = width;
  const typography = buildComparisonTypography(viewportWidth, { emphasize: true });
  const arrowHeight = resolveResponsiveClampPx(viewportWidth, { min: 220, max: 360, vw: 17 });
  const arrowAspect = getImageAspectRatio(assets?.arrowGreen) || getImageAspectRatio(assets?.arrowRed) || 0.72;
  const desiredArrowWidth = Math.round(arrowHeight * arrowAspect);
  const arrowWidthMin = resolveResponsiveClampPx(viewportWidth, { min: 120, max: 190, vw: 6 });
  const arrowWidthMax = resolveResponsiveClampPx(viewportWidth, { min: 200, max: 320, vw: 10 });
  const arrowWidth = Math.max(arrowWidthMin, Math.min(arrowWidthMax, desiredArrowWidth));
  const rowGap = resolveResponsiveClampPx(viewportWidth, { min: 16, max: 26, vw: 1.8 });
  const topPadding = 36;
  const contentWidth = width - padding * 2;
  const baseCardWidth = Math.max(240, (contentWidth - arrowWidth * 2 - rowGap * 3) / 2);
  const leftLayout = measureComparisonCardLayout({ card: cards.left, width: baseCardWidth, typography, measureCtx });
  const rightLayout = measureComparisonCardLayout({ card: cards.right, width: baseCardWidth, typography, measureCtx });
  const cardHeight = Math.max(typography.minHeight, leftLayout.height, rightLayout.height);
  const rowTotalWidth = arrowWidth * 2 + baseCardWidth * 2 + rowGap * 3;
  const rowStartX = padding + Math.max(0, (contentWidth - rowTotalWidth) / 2);
  const arrowLeftX = rowStartX;
  const leftCardX = arrowLeftX + arrowWidth + rowGap;
  const rightCardX = leftCardX + baseCardWidth + rowGap;
  const arrowRightX = rightCardX + baseCardWidth + rowGap;
  const warningLayout = data.warning
    ? buildComparisonWarningLayout({
        width: contentWidth,
        viewportWidth,
        warning: data.warning,
        measureCtx,
        emphasize: true,
        assets,
        cardTypography: typography
      })
    : null;
  const warningHeight = warningLayout ? warningLayout.height : 0;
  const afterCardSpacing = warningLayout ? warningLayout.spacingBefore : 0;
  const bottomSpacing = warningLayout ? 36 : 24;
  const totalHeight = topPadding + cardHeight + afterCardSpacing + warningHeight + bottomSpacing;
  return {
    totalHeight,
    draw(ctx, startY) {
      const cardY = startY + topPadding;
      const arrowVerticalOffset = cardY + Math.max(0, (cardHeight - arrowHeight) / 2);
      drawComparisonArrow(ctx, {
        x: arrowLeftX,
        y: arrowVerticalOffset,
        width: arrowWidth,
        height: arrowHeight,
        trend: cards.left.trend,
        isEnergy: false,
        assets
      });
      drawComparisonArrow(ctx, {
        x: arrowRightX,
        y: arrowVerticalOffset,
        width: arrowWidth,
        height: arrowHeight,
        trend: cards.right.trend,
        isEnergy: true,
        assets
      });
      drawComparisonCard(ctx, {
        card: cards.left,
        x: leftCardX,
        y: cardY,
        width: baseCardWidth,
        height: cardHeight,
        layout: leftLayout,
        typography
      });
      drawComparisonCard(ctx, {
        card: cards.right,
        x: rightCardX,
        y: cardY,
        width: baseCardWidth,
        height: cardHeight,
        layout: rightLayout,
        typography
      });
      if (warningLayout && data.warning) {
        const warningY = cardY + cardHeight + afterCardSpacing;
        drawComparisonWarning(ctx, {
          x: padding,
          y: warningY,
          width: contentWidth,
          warning: data.warning,
          layout: warningLayout,
          assets,
          centerText: true
        });
      }
    }
  };
}

function resolveInclusionAnchorIndex(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) {
    return 0;
  }
  const pollutionEstimateIndex = blocks.findIndex(block => {
    if (!block || typeof block.title !== 'string') {
      return false;
    }
    return block.title.trim().toLowerCase() === 'pollution estimate';
  });
  return pollutionEstimateIndex >= 0 ? pollutionEstimateIndex : blocks.length;
}

function buildComparisonDetailsLayout({ width, padding, data, measureCtx }) {
  const metrics = Array.isArray(data.metrics) ? data.metrics.filter(Boolean) : [];
  const rawCalcBlocks = Array.isArray(data.calcBlocks)
    ? data.calcBlocks.filter(block => block && Array.isArray(block.lines) && block.lines.length)
    : [];
  const normalizedCalcBlocks = rawCalcBlocks.map(block => ({
    ...block,
    lines: Array.isArray(block.lines) ? [...block.lines] : []
  }));
  const shouldReplaceEnergyCalc = Boolean(data.shouldReplaceEnergyCalc);
  const hasEnergyBlock = normalizedCalcBlocks.some(block => block.showEnergy || String(block.title || '').toLowerCase() === 'energy');
  let calcBlocks = normalizedCalcBlocks;
  if (shouldReplaceEnergyCalc) {
    calcBlocks = normalizedCalcBlocks.filter(block => !(block.showEnergy || String(block.title || '').toLowerCase() === 'energy'));
  } else if (!hasEnergyBlock) {
    const fallbackEnergyBlock = {
      title: 'Energy',
      lines: ['Calculation unavailable for this selection'],
      showEnergy: true
    };
    const insertIndex = Math.min(2, normalizedCalcBlocks.length);
    calcBlocks = [
      ...normalizedCalcBlocks.slice(0, insertIndex),
      fallbackEnergyBlock,
      ...normalizedCalcBlocks.slice(insertIndex)
    ];
  }
  const inclusionText = typeof data.inclusionNote === 'string' ? data.inclusionNote.trim() : '';
  const inclusionDetails = Array.isArray(data.inclusionNoteDetails)
    ? data.inclusionNoteDetails.filter(Boolean)
    : null;
  const inclusionLabel = data.inclusionNoteLabel || (inclusionText ? 'Note: ' : null);
  const inclusionConfig = shouldReplaceEnergyCalc && inclusionText
    ? {
      text: inclusionText,
      label: inclusionLabel,
      detailLines: inclusionDetails
    }
    : null;
  const inclusionGap = 20;
  let inclusionCard = null;
  let inclusionAnchorIndex = null;
  const topSpacing = 60;
  let bottomSpacing = 40;
  const detailSideMargin = Math.max(70, Math.min(220, padding * 1.3));
  const contentStartX = padding + detailSideMargin;
  const contentEndX = width - padding - detailSideMargin;
  const availableWidth = Math.max(320, contentEndX - contentStartX);
  let metricCardGap = metrics.length > 1 ? 36 : 0;
  const metricCardPadding = 28;
  const metricLabelFont = '600 42px "Inter", system-ui, sans-serif';
  const metricValueFont = '700 58px "Inter", system-ui, sans-serif';
  let maxValueWidth = 0;
  if (metrics.length) {
    measureCtx.font = metricValueFont;
    const valueWidths = metrics.map(metric => Math.max(
      measureCtx.measureText(metric.pollution || '—').width,
      measureCtx.measureText(metric.energy || '—').width,
      measureCtx.measureText(metric.emissionFactor || '—').width
    ));
    maxValueWidth = Math.max(0, ...valueWidths);
  }
  const minCardInnerWidth = maxValueWidth + metricCardPadding * 2;
  let metricCardWidth = metrics.length > 1
    ? Math.max(320, (availableWidth - metricCardGap) / 2)
    : Math.min(520, availableWidth);
  metricCardWidth = Math.max(Math.min(460, metricCardWidth), minCardInnerWidth || 320);
  const measureMetricCardHeight = (cardWidth) => {
    if (!metrics.length) {
      return 0;
    }
    return Math.max(520, Math.max(...metrics.map(metric => {
      const nameLines = wrapTextIntoLines(
        measureCtx,
        metricNameFont,
        metric?.name || '—',
        cardWidth - metricCardPadding * 2
      );
      const totalNameHeight = nameLines.length * metricNameLineHeight;
      const labelValueHeight = 3 * (metricLabelLineHeight + metricValueLineHeight);
      return totalNameHeight + labelValueHeight + metricCardPadding * 2 + 20;
    })));
  };
  const metricNameFont = '700 64px "Inter", system-ui, sans-serif';
  const metricNameLineHeight = 74;
  const metricLabelLineHeight = 56;
  const metricValueLineHeight = 64;
  let metricCardHeight = metrics.length ? measureMetricCardHeight(metricCardWidth) : 0;
  let metricsRowWidth = metrics.length
    ? Math.min(availableWidth, metrics.length * metricCardWidth + metricCardGap * (metrics.length - 1))
    : 0;
  const sectionGap = metrics.length && calcBlocks.length ? 60 : 0;
  const remainingWidth = availableWidth - metricsRowWidth - sectionGap;
  let alignCalculationsRight = metrics.length && calcBlocks.length && remainingWidth >= 320;
  const forceSingleColumn = shouldReplaceEnergyCalc;
  const calcHeaderFont = '700 58px "Inter", system-ui, sans-serif';
  const calcLineFont = '700 54px "Inter", system-ui, sans-serif';
  const calcLineHeight = 62;
  let columnsPerRow;
  let calcColumnGap;
  let calcBlockWidth;
  let calcBlockPadding;

  const updateCalcSizing = () => {
    columnsPerRow = (alignCalculationsRight || forceSingleColumn) ? 1 : 2;
    calcColumnGap = columnsPerRow === 1 ? 0 : 40;
    calcBlockWidth = alignCalculationsRight
      ? Math.max(320, remainingWidth)
      : Math.max(320, (availableWidth - calcColumnGap) / columnsPerRow);
    calcBlockPadding = alignCalculationsRight ? 10 : 34;
  };

  updateCalcSizing();

  let forcedStackedCalcLayout = false;
  if (alignCalculationsRight) {
    const needsStackedCalc = shouldStackCalcBlocks({
      blocks: calcBlocks,
      measureCtx,
      headerFont: calcHeaderFont,
      lineFont: calcLineFont,
      blockWidth: calcBlockWidth,
      padding: calcBlockPadding
    });
    if (needsStackedCalc) {
      alignCalculationsRight = false;
      forcedStackedCalcLayout = true;
      updateCalcSizing();
    }
  }

  if (forcedStackedCalcLayout && metrics.length) {
    const hasDualColumns = columnsPerRow === 2 && metrics.length > 1;
    metricCardGap = hasDualColumns ? calcColumnGap : 0;
    metricCardWidth = calcBlockWidth;
    metricCardWidth = Math.max(metricCardWidth, minCardInnerWidth || 320);
    metricCardHeight = measureMetricCardHeight(metricCardWidth);
    metricsRowWidth = hasDualColumns ? availableWidth : metricCardWidth;
  }

  const metricsRenderedHeight = metrics.length ? metricCardHeight : 0;

  const rowGap = 30;
  const hasCalcContent = calcBlocks.length > 0 || inclusionConfig;
  const shouldRenderRightColumn = alignCalculationsRight && hasCalcContent;
  const calcColumnX = shouldRenderRightColumn
    ? contentStartX + metricsRowWidth + sectionGap
    : contentStartX;
  const calcColumnWidth = columnsPerRow === 1 ? calcBlockWidth : availableWidth;
  if (inclusionConfig) {
    inclusionCard = buildInclusionCardLayout({
      text: inclusionConfig.text,
      label: inclusionConfig.label,
      detailLines: inclusionConfig.detailLines,
      width: calcColumnWidth,
      padding,
      measureCtx,
      singleLine: true
    });
    inclusionAnchorIndex = resolveInclusionAnchorIndex(calcBlocks);
    if (inclusionCard) {
      bottomSpacing = 32;
    }
  }
  const hasContent = metrics.length || calcBlocks.length || inclusionCard;
  if (!hasContent) {
    return null;
  }
  const calcRows = [];
  for (let i = 0; i < calcBlocks.length; i += columnsPerRow) {
    const sourceBlocks = calcBlocks.slice(i, i + columnsPerRow);
    const rowBlocks = sourceBlocks.map(block => {
      const normalized = normalizeCalculationLines(block.lines);
      const contentWidth = Math.max(40, calcBlockWidth - calcBlockPadding * 2);
      if (alignCalculationsRight) {
        const primaryLine = normalized.primaryLine || '—';
        const secondaryLine = normalized.secondaryLine || '';
        measureCtx.font = calcLineFont;
        const primaryWidth = measureCtx.measureText(primaryLine).width;
        const secondaryWidth = secondaryLine ? measureCtx.measureText(secondaryLine).width : 0;
        const contentHeight = calcBlockPadding * 2 + calcLineHeight + (secondaryLine ? calcLineHeight : 0);
        return {
          title: block.title || '',
          primaryLine,
          secondaryLine,
          primaryWidth,
          secondaryWidth,
          contentHeight
        };
      }
      const lines = [normalized.primaryLine, normalized.secondaryLine, ...normalized.extraLines]
        .filter(Boolean);
      const wrappedLines = (lines.length ? lines : ['—']).flatMap(line => wrapTextIntoLines(
        measureCtx,
        calcLineFont,
        line,
        contentWidth
      ));
      const contentHeight = (wrappedLines.length * calcLineHeight) + calcLineHeight + calcBlockPadding * 2;
      return {
        title: block.title || '',
        lines: wrappedLines,
        contentHeight
      };
    });
    const rowContentHeight = rowBlocks.reduce((max, block) => Math.max(max, block.contentHeight), 0);
    calcRows.push({ blocks: rowBlocks, contentHeight: rowContentHeight });
  }
  let calcHeight = calcRows.reduce((sum, row, index) => sum + row.contentHeight + (index < calcRows.length - 1 ? rowGap : 0), 0);
  let inclusionHeight = 0;
  if (inclusionCard) {
    const inclusionExtra = inclusionCard.height + inclusionGap;
    if (calcBlocks.length) {
      calcHeight += inclusionExtra;
    } else {
      inclusionHeight = inclusionExtra;
    }
  }
  const metricsGap = alignCalculationsRight ? 0 : (metrics.length && (calcRows.length || inclusionCard) ? 50 : 0);
  const combinedTopHeight = alignCalculationsRight
    ? Math.max(metricsRenderedHeight, calcHeight)
    : (metrics.length ? metricsRenderedHeight : 0)
      + (calcRows.length ? (metrics.length ? metricsGap : 0) + calcHeight : 0);
  const totalHeight = topSpacing + combinedTopHeight + inclusionHeight + bottomSpacing;
  return {
    totalHeight,
    draw(ctx, startY) {
      let cursorY = startY + topSpacing;
      const metricsShareCalcColumn = forcedStackedCalcLayout && metrics.length;
      if (metrics.length) {
        const metricsStartX = metricsShareCalcColumn ? calcColumnX : contentStartX;
        drawMetricCardRow(ctx, {
          metrics,
          x: metricsStartX,
          y: cursorY,
          cardWidth: metricCardWidth,
          cardGap: metricCardGap,
          height: metricCardHeight
        });
        if (!alignCalculationsRight) {
          cursorY += metricsRenderedHeight + (calcRows.length ? metricsGap : 0);
        }
      }
      const calcStartY = alignCalculationsRight ? startY + topSpacing : cursorY;
      const inclusionIndex = inclusionCard ? inclusionAnchorIndex : null;
      let inclusionDrawn = false;
      let globalBlockIndex = 0;
      const maybeDrawInclusionBetween = (currentBottomY) => {
        if (!inclusionCard || inclusionDrawn || inclusionIndex == null) {
          return currentBottomY;
        }
        if (globalBlockIndex >= inclusionIndex) {
          const insertionY = currentBottomY + inclusionGap;
          drawInclusionCard(ctx, { layout: inclusionCard, x: calcColumnX, y: insertionY });
          inclusionDrawn = true;
          return insertionY + inclusionCard.height;
        }
        return currentBottomY;
      };
      if (calcRows.length) {
        let rowY = calcStartY;
        calcRows.forEach((row, index) => {
          drawCalculationRow(ctx, {
            row,
            x: calcColumnX,
            y: rowY,
            blockWidth: calcBlockWidth,
            columnGap: calcColumnGap,
            rowWidth: calcColumnWidth,
            headerFont: calcHeaderFont,
            lineFont: calcLineFont,
            lineHeight: calcLineHeight,
            padding: calcBlockPadding,
            alignRight: alignCalculationsRight
          });
          globalBlockIndex += row.blocks.length;
          let rowBottom = rowY + row.contentHeight;
          rowBottom = maybeDrawInclusionBetween(rowBottom);
          rowY = rowBottom;
          if (index < calcRows.length - 1) {
            rowY += rowGap;
          }
        });
        const calcColumnHeight = rowY - calcStartY;
        if (alignCalculationsRight) {
          const columnHeight = Math.max(metricsRenderedHeight, calcColumnHeight);
          cursorY = startY + topSpacing + columnHeight;
        } else {
          cursorY = rowY;
        }
      }
      if (inclusionCard && !inclusionDrawn) {
        const baseY = alignCalculationsRight
          ? startY + topSpacing + Math.max(metricsRenderedHeight, calcHeight)
          : cursorY;
        const insertionY = baseY + inclusionGap;
        drawInclusionCard(ctx, { layout: inclusionCard, x: calcColumnX, y: insertionY });
        cursorY = insertionY + inclusionCard.height;
      }
    }
  };
}

function wrapTextIntoLines(measureContext, font, text, maxWidth) {
  const ctx = measureContext;
  const value = (text ?? '').toString();
  if (!value) {
    return [''];
  }
  ctx.font = font;
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || maxWidth <= 0) {
    return [value];
  }
  const lines = [];
  let currentLine = '';
  words.forEach(word => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  });
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length ? lines : [''];
}

function normalizeCalculationLines(lines) {
  const sanitized = Array.isArray(lines)
    ? lines.map(line => (line ?? '').toString().trim()).filter(Boolean)
    : [];
  let primaryLine = sanitized.shift() || '';
  let secondaryLine = sanitized.shift() || '';
  const extraLines = sanitized.slice();

  const splitOutParenthetical = (source) => {
    const openIndex = source.indexOf('(');
    const closeIndex = source.indexOf(')', openIndex + 1);
    if (openIndex > 0 && closeIndex > openIndex) {
      const before = source.slice(0, openIndex).trim();
      const parenPart = source.slice(openIndex, closeIndex + 1).trim();
      return { before, parenPart };
    }
    return null;
  };

  if (primaryLine && !secondaryLine) {
    const extracted = splitOutParenthetical(primaryLine);
    if (extracted) {
      primaryLine = extracted.before || primaryLine;
      secondaryLine = extracted.parenPart;
    }
  }

  if (secondaryLine && !secondaryLine.startsWith('(')) {
    const extracted = splitOutParenthetical(secondaryLine);
    if (extracted) {
      secondaryLine = extracted.parenPart;
      extraLines.unshift(extracted.before);
    }
  }

  return {
    primaryLine,
    secondaryLine,
    extraLines
  };
}

function shouldStackCalcBlocks({ blocks, measureCtx, headerFont, lineFont, blockWidth, padding }) {
  if (!Array.isArray(blocks) || !blocks.length || !measureCtx) {
    return false;
  }
  const innerWidth = Math.max(0, blockWidth - padding * 2);
  if (innerWidth <= 0) {
    return true;
  }
  const MIN_LABEL_VALUE_GAP = 28;
  return blocks.some(block => {
    const title = (block?.title || '').toString();
    const normalized = normalizeCalculationLines(block?.lines || []);
    const primaryLine = normalized.primaryLine || normalized.secondaryLine || '';

    measureCtx.font = headerFont;
    const labelWidth = measureCtx.measureText(title).width || 0;
    measureCtx.font = lineFont;
    const valueWidth = measureCtx.measureText(primaryLine || '—').width || 0;

    return labelWidth + valueWidth + MIN_LABEL_VALUE_GAP > innerWidth;
  });
}

function resolveResponsiveClampPx(viewportWidth, clampConfig = {}) {
  const { min = 0, max = min, vw = 0, add = 0 } = clampConfig;
  const vwComponent = vw ? (viewportWidth * (vw / 100)) : 0;
  const preferred = vw ? (vwComponent + add) : add;
  const normalized = Number.isFinite(preferred) && preferred !== 0 ? preferred : min;
  return Math.min(max, Math.max(min, normalized));
}

function buildWrappedLines(measureContext, font, text, maxWidth) {
  const normalized = (text ?? '').toString().trim();
  if (!normalized) {
    return [];
  }
  return wrapTextIntoLines(measureContext, font, normalized, maxWidth);
}

function getFontPixelSize(font) {
  if (typeof font !== 'string' || !font.length) {
    return 16;
  }
  const match = font.match(/([0-9]+(?:\.[0-9]+)?)px/);
  return match ? parseFloat(match[1]) : 16;
}

function getImageAspectRatio(image) {
  if (!image) {
    return null;
  }
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  if (!width || !height) {
    return null;
  }
  return width / height;
}

function measureWarningLines(lineDefinitions, measureCtx) {
  if (!Array.isArray(lineDefinitions) || !lineDefinitions.length) {
    return null;
  }
  const measured = lineDefinitions
    .map(def => {
      const rawTokens = (def.tokens || []).filter(token => token && token.text);
      if (!rawTokens.length) {
        return null;
      }
      let width = 0;
      let ascent = 0;
      let descent = 0;
      const tokens = rawTokens.map(token => {
        measureCtx.font = token.font;
        const metrics = measureCtx.measureText(token.text);
        const tokenWidth = metrics.width || 0;
        const fallbackSize = getFontPixelSize(token.font);
        const tokenAscent = Number.isFinite(metrics.actualBoundingBoxAscent)
          ? metrics.actualBoundingBoxAscent
          : fallbackSize * 0.78;
        const tokenDescent = Number.isFinite(metrics.actualBoundingBoxDescent)
          ? metrics.actualBoundingBoxDescent
          : fallbackSize * 0.22;
        width += tokenWidth;
        ascent = Math.max(ascent, tokenAscent);
        descent = Math.max(descent, tokenDescent);
        return { ...token, width: tokenWidth };
      });
      if (!width) {
        return null;
      }
      return {
        tokens,
        width,
        ascent,
        descent,
        lineHeight: Math.max(def.lineHeight || 0, ascent + descent)
      };
    })
    .filter(Boolean);
  return measured.length ? measured : null;
}

function buildComparisonTypography(viewportWidth, options = {}) {
  const emphasis = options.emphasize;
  const paddingY = resolveResponsiveClampPx(viewportWidth, { min: emphasis ? 36 : 8, max: emphasis ? 60 : 14, vw: emphasis ? 4.4 : 1.4 });
  const paddingX = resolveResponsiveClampPx(viewportWidth, { min: emphasis ? 34 : 10, max: emphasis ? 52 : 16, vw: emphasis ? 4.4 : 1.9 });
  const minHeight = resolveResponsiveClampPx(viewportWidth, { min: emphasis ? 260 : 72, max: emphasis ? 360 : 110, vw: emphasis ? 26 : 11 });
  const largeSize = resolveResponsiveClampPx(viewportWidth, { min: emphasis ? 52 : 11, max: emphasis ? 78 : 26, vw: emphasis ? 5.2 : 1.2, add: emphasis ? 20 : 7 });
  const smallSize = resolveResponsiveClampPx(viewportWidth, { min: emphasis ? 46 : 12, max: emphasis ? 62 : 22, vw: emphasis ? 4.5 : 1.1, add: emphasis ? 18 : 6 });
  return {
    paddingX,
    paddingY,
    minHeight,
    largeFont: `800 ${largeSize}px "Inter", system-ui, sans-serif`,
    largeLineHeight: largeSize * 1.3,
    smallFont: `700 ${smallSize}px "Inter", system-ui, sans-serif`,
    smallLineHeight: smallSize * 1.35,
    blockGap: 6
  };
}

function measureComparisonCardLayout({ card, width, typography, measureCtx }) {
  const contentWidth = Math.max(80, width - typography.paddingX * 2);
  const nameLines = buildWrappedLines(measureCtx, typography.largeFont, card.title || '—', contentWidth);
  const subtitleLines = buildWrappedLines(measureCtx, typography.smallFont, card.subtitle || '', contentWidth);
  const ratioLines = buildWrappedLines(measureCtx, typography.largeFont, card.ratioLine || '—', contentWidth);
  const followerLines = buildWrappedLines(measureCtx, typography.smallFont, card.followerLine || '', contentWidth);

  const blockMeta = [
    { lines: nameLines, lineHeight: typography.largeLineHeight },
    { lines: subtitleLines, lineHeight: typography.smallLineHeight },
    { lines: ratioLines, lineHeight: typography.largeLineHeight },
    { lines: followerLines, lineHeight: typography.smallLineHeight }
  ];

  const textHeight = blockMeta.reduce((sum, block) => (
    block.lines.length ? sum + block.lines.length * block.lineHeight : sum
  ), 0);
  const activeBlocks = blockMeta.filter(block => block.lines.length).length;
  const gapTotal = Math.max(0, activeBlocks - 1) * typography.blockGap;
  const intrinsicHeight = typography.paddingY * 2 + textHeight + gapTotal;
  const height = Math.max(typography.minHeight, intrinsicHeight);

  return {
    nameLines,
    subtitleLines,
    ratioLines,
    followerLines,
    contentHeight: intrinsicHeight,
    height
  };
}

 function buildComparisonWarningLayout({ width, viewportWidth, warning, measureCtx, emphasize = false, assets, cardTypography = null }) {
  const warningText = warning?.text;
  const warningChangeText = typeof warning?.changeText === 'string' ? warning.changeText.trim() : '';
  if (!warningText) {
    return null;
  }
  const iconHeight = resolveResponsiveClampPx(viewportWidth, { min: emphasize ? 190 : 100, max: emphasize ? 290 : 170, vw: emphasize ? 16 : 8 });
  const wrapGap = emphasize ? 38 : 14;
  const paddingY = resolveResponsiveClampPx(viewportWidth, { min: emphasize ? 52 : 12, max: emphasize ? 78 : 18, vw: emphasize ? 5.6 : 1.8 });
  const paddingX = resolveResponsiveClampPx(viewportWidth, { min: emphasize ? 54 : 14, max: emphasize ? 78 : 20, vw: emphasize ? 5.8 : 2.2 });
  const baseFontSize = resolveResponsiveClampPx(viewportWidth, { min: emphasize ? 48 : 14, max: emphasize ? 72 : 24, vw: emphasize ? 3.8 : 1.1, add: emphasize ? 22 : 6 });
  const referenceTypography = cardTypography || buildComparisonTypography(viewportWidth, { emphasize });
  const referenceLargePx = getFontPixelSize(referenceTypography.largeFont);
  const valueFontBump = Math.max(6, Math.min(18, referenceLargePx * 0.2));
  const valueFontSize = referenceLargePx + valueFontBump;
  const unitFontSize = Math.max(baseFontSize * 0.85, valueFontSize * 0.58);
  const baseFont = `600 ${baseFontSize}px "Inter", system-ui, sans-serif`;
  const entityFont = `800 ${baseFontSize}px "Inter", system-ui, sans-serif`;
  const valueFont = `800 ${valueFontSize}px "Inter", system-ui, sans-serif`;
  const unitFont = `700 ${unitFontSize}px "Inter", system-ui, sans-serif`;
  const changeFont = `800 ${baseFontSize}px "Inter", system-ui, sans-serif`;
  const baseLineHeight = Math.max(baseFontSize * 1.28, baseFontSize + 12);
  const valueLineHeight = Math.max(valueFontSize * 1.08, valueFontSize + 8);
  const lineGap = Math.max(14, baseFontSize * 0.24);
  const warningIconAspect = getImageAspectRatio(assets?.warningIcon) || 1;
  const uncappedIconWidth = iconHeight * warningIconAspect;
  const minIconWidth = iconHeight * 0.88;
  const minRowWidth = 220;
  const maxIconWidthSpace = Math.max(minIconWidth, (width - wrapGap * 2 - minRowWidth) / 2);
  const iconWidth = Math.min(maxIconWidthSpace, Math.max(minIconWidth, uncappedIconWidth || minIconWidth));
  const rowWidth = Math.max(minRowWidth, width - iconWidth * 2 - wrapGap * 2);
  const innerWidth = Math.max(200, rowWidth - paddingX * 2);

  const structuredLines = buildStructuredWarningLines({
    warning,
    fonts: { base: baseFont, entity: entityFont, value: valueFont, unit: unitFont, change: changeFont },
    lineHeights: { base: baseLineHeight, value: valueLineHeight, change: baseLineHeight },
    measureCtx,
    maxWidth: innerWidth
  });
  let lines = structuredLines?.lines;
  let customLineGap = structuredLines?.lineGap;

  if (!lines || !lines.length) {
    const fallbackLines = buildWrappedLines(measureCtx, baseFont, warningText, innerWidth);
    const normalized = fallbackLines.length ? fallbackLines : [warningText ?? ''];
    const sanitized = normalized.filter(line => typeof line === 'string' ? line.trim().length : Boolean(line));
    const sourceLines = sanitized.length ? sanitized : [''];
    const fallbackDefinitions = sourceLines.map(text => ({
      tokens: [{ text, font: baseFont, fill: '#ffffff' }],
      lineHeight: baseLineHeight
    }));
    if (warningChangeText) {
      fallbackDefinitions.push({
        tokens: [{ text: warningChangeText, font: changeFont, fill: '#ffffff' }],
        lineHeight: baseLineHeight
      });
    }
    lines = measureWarningLines(fallbackDefinitions, measureCtx) || [];
  }

  if (!lines.length) {
    return null;
  }

  const effectiveLineGap = typeof customLineGap === 'number' ? customLineGap : lineGap;
  const textHeight = lines.reduce((total, line, index) => (
    total + line.ascent + line.descent + (index > 0 ? effectiveLineGap : 0)
  ), 0);
  const rowHeight = Math.max(iconHeight, paddingY * 2 + textHeight);

  return {
    height: rowHeight,
    spacingBefore: emphasize ? 36 : 20,
    paddingX,
    paddingY,
    iconHeight,
    iconWidth,
    wrapGap,
    lines,
    textHeight,
    lineGap: effectiveLineGap
  };
}

function buildInclusionCardLayout({ text, label, detailLines, width, padding, measureCtx, singleLine = false }) {
  const cardPadding = 32;
  const radius = 24;
  const labelFont = '700 52px "Inter", system-ui, sans-serif';
  const baseFontFamily = '"Inter", system-ui, sans-serif';
  const detailFont = `600 48px ${baseFontFamily}`;
  const cardWidth = Math.max(320, Math.round(Number(width) || 0));
  const innerWidth = Math.max(160, cardWidth - cardPadding * 2);
  const buildTextFont = (size) => `600 ${size}px ${baseFontFamily}`;
  let textFontSize = 50;
  const minTextFontSize = 34;
  let textFont = buildTextFont(textFontSize);
  const normalizedBodyBase = (text ?? '').toString().trim() || '—';
  const normalizedLabel = typeof label === 'string' ? label : '';
  let normalizedBody = normalizedBodyBase;
  let layoutLabel = normalizedLabel;
  if (singleLine && normalizedLabel) {
    normalizedBody = `${normalizedLabel}${normalizedBodyBase}`;
    layoutLabel = '';
  }
  if (singleLine) {
    measureCtx.font = textFont;
    while (measureCtx.measureText(normalizedBody).width > innerWidth && textFontSize > minTextFontSize) {
      textFontSize -= 2;
      textFont = buildTextFont(textFontSize);
      measureCtx.font = textFont;
    }
  }
  const lineHeight = Math.round(textFontSize + 12);
  const detailLineHeight = 56;
  const bodyLines = singleLine
    ? [normalizedBody]
    : wrapTextIntoLines(measureCtx, textFont, normalizedBody, innerWidth);
  const details = Array.isArray(detailLines)
    ? detailLines.filter(Boolean).map(line => wrapTextIntoLines(measureCtx, detailFont, line, innerWidth))
    : [];
  const detailHeight = details.reduce((sum, group) => sum + (group.length * detailLineHeight), 0);
  const height = cardPadding * 2
    + (layoutLabel ? lineHeight : 0)
    + (layoutLabel ? 16 : 0)
    + bodyLines.length * lineHeight
    + (details.length ? 30 : 0)
    + detailHeight;
  return {
    width: cardWidth,
    height,
    radius,
    padding: cardPadding,
    label: layoutLabel || null,
    labelFont,
    textFont,
    detailFont,
    bodyLines,
    details,
    lineHeight,
    detailLineHeight,
    background: '#fff4e5',
    borderColor: '#f7c97b'
  };
}

function buildStructuredWarningLines({ warning, fonts, lineHeights, measureCtx, maxWidth }) {
  const polluterName = warning?.polluterName;
  const baselineName = warning?.baselineName;
  const pollutantName = warning?.pollutantName;
  if (!polluterName || !baselineName || !pollutantName) {
    return null;
  }
  const changeText = typeof warning?.changeText === 'string' ? warning.changeText.trim() : '';
  const changePercentRaw = warning?.changePercent;
  const changePercentValue = Number(changePercentRaw);
  const hasFiniteChangePercent = Number.isFinite(changePercentValue) && changePercentValue !== 0;
  const textColor = '#ffffff';
  const formatPercentValue = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }
    const absValue = Math.abs(numericValue);
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
  const formatEntity = (value) => {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (value != null) {
      return String(value);
    }
    return '—';
  };

  const changeDefinitionTemplate = (() => {
    if (hasFiniteChangePercent) {
      const percentText = formatPercentValue(changePercentValue);
      if (!percentText) {
        return null;
      }
      const isIncrease = changePercentValue > 0;
      const article = isIncrease ? 'an' : 'a';
      const directionText = isIncrease ? 'INCREASE' : 'decrease';
      const changeLineHeight = lineHeights.change || lineHeights.value || lineHeights.base;
      return {
        lineHeight: changeLineHeight,
        tokens: [
          { text: 'This is ', font: fonts.base, fill: textColor },
          { text: article, font: fonts.base, fill: textColor },
          { text: ' ', font: fonts.base, fill: textColor },
          { text: directionText, font: isIncrease ? fonts.entity : fonts.base, fill: textColor },
          { text: ' of ', font: fonts.base, fill: textColor },
          { text: percentText, font: fonts.value, fill: textColor }
        ]
      };
    }
    if (changeText) {
      return {
        lineHeight: lineHeights.change || lineHeights.base,
        tokens: [{ text: changeText, font: fonts.change || fonts.base, fill: textColor }]
      };
    }
    return null;
  })();

  const cloneChangeDefinition = () => {
    if (!changeDefinitionTemplate) {
      return null;
    }
    return {
      lineHeight: changeDefinitionTemplate.lineHeight,
      tokens: changeDefinitionTemplate.tokens.map(token => ({ ...token }))
    };
  };

  const appendChangeDefinition = (definitions) => {
    const changeDefinition = cloneChangeDefinition();
    return changeDefinition ? [...definitions, changeDefinition] : definitions;
  };

  const hasChangeLine = Boolean(changeDefinitionTemplate);

  const firstLineLeadingTokens = [
    { text: 'If ', font: fonts.base, fill: textColor },
    { text: formatEntity(polluterName), font: fonts.entity, fill: textColor }
  ];

  const firstLineTrailingTokens = [
    { text: ' replaced ', font: fonts.base, fill: textColor },
    { text: formatEntity(baselineName), font: fonts.entity, fill: textColor },
    { text: ',', font: fonts.base, fill: textColor }
  ];

  const firstLineTokens = [...firstLineLeadingTokens, ...firstLineTrailingTokens];

  const secondLineTokens = [
    { text: `${formatEntity(pollutantName)} pollution would be`, font: fonts.base, fill: textColor }
  ];

  const rawValueText = typeof warning.valueText === 'string'
    ? warning.valueText
    : (warning.valueText != null ? String(warning.valueText) : null);
  const fallbackValue = typeof warning.valueDisplay === 'string' ? warning.valueDisplay : null;
  const resolvedValueText = rawValueText || fallbackValue;
  const valueTokens = [];
  if (resolvedValueText) {
    valueTokens.push({ text: resolvedValueText, font: fonts.value, fill: textColor });
    const unitText = typeof warning.valueUnit === 'string' ? warning.valueUnit.trim() : '';
    if (unitText) {
      valueTokens.push({ text: ` ${unitText}`, font: fonts.unit, fill: textColor });
    }
  }

  const allowCompactLayout = true;
  const shouldForceFirstLineBreak = (() => {
    if (!maxWidth || !firstLineTokens.length) {
      return false;
    }
    const measured = measureWarningLines([
      { tokens: firstLineTokens, lineHeight: lineHeights.base }
    ], measureCtx);
    return Boolean(measured?.[0] && measured[0].width > maxWidth);
  })();
  let singleLine = null;
  if (allowCompactLayout) {
    const singleLineTokens = [
      ...firstLineTokens,
      { text: ' ', font: fonts.base, fill: textColor },
      ...secondLineTokens
    ];
    if (valueTokens.length) {
      singleLineTokens.push({ text: ' ', font: fonts.base, fill: textColor }, ...valueTokens);
    }

    const singleLineDefinitions = appendChangeDefinition([
      { tokens: singleLineTokens, lineHeight: Math.max(lineHeights.value, lineHeights.base) }
    ]);
    singleLine = measureWarningLines(singleLineDefinitions, measureCtx);

    if (singleLine) {
      const line = singleLine[0];
      if (!maxWidth || line.width <= maxWidth) {
        return { lines: singleLine, lineGap: hasChangeLine ? null : 0 };
      }
      if (line.tokens.length > 1) {
        let removed = false;
        const trimmedTokens = line.tokens.filter(token => {
          if (!removed && token.text && token.text.trim().startsWith('$')) {
            removed = true;
            return false;
          }
          return true;
        });
        if (trimmedTokens.length && (!removed || trimmedTokens.length > 1)) {
          const adjustedDefinitions = appendChangeDefinition([
            { tokens: trimmedTokens, lineHeight: line.lineHeight }
          ]);
          const adjusted = measureWarningLines(adjustedDefinitions, measureCtx);
          if (adjusted && adjusted[0]?.width <= maxWidth * 1.05) {
            return { lines: adjusted, lineGap: hasChangeLine ? null : 0 };
          }
        }
      }
    }

    if (maxWidth) {
      const combinedSecondLineTokens = secondLineTokens.slice();
      if (valueTokens.length) {
        combinedSecondLineTokens.push({ text: ' ', font: fonts.base, fill: textColor }, ...valueTokens);
      }
      if (firstLineTokens.length && combinedSecondLineTokens.length) {
        const twoLineDefinitions = [
          { tokens: firstLineTokens, lineHeight: lineHeights.base },
          { tokens: combinedSecondLineTokens, lineHeight: Math.max(lineHeights.value, lineHeights.base) }
        ];
        const measuredTwoLine = measureWarningLines(appendChangeDefinition(twoLineDefinitions), measureCtx);
        if (measuredTwoLine && measuredTwoLine.every(line => line.width <= maxWidth * 1.02)) {
          return { lines: measuredTwoLine, lineGap: null };
        }
      }
    }
  }

  const multiline = [];
  if (shouldForceFirstLineBreak && firstLineLeadingTokens.length && firstLineTrailingTokens.length) {
    multiline.push({ tokens: firstLineLeadingTokens, lineHeight: lineHeights.base });
    multiline.push({ tokens: firstLineTrailingTokens, lineHeight: lineHeights.base });
  } else {
    multiline.push({ tokens: firstLineTokens, lineHeight: lineHeights.base });
  }
  multiline.push({ tokens: secondLineTokens, lineHeight: lineHeights.base });
  if (valueTokens.length) {
    multiline.push({ tokens: valueTokens, lineHeight: lineHeights.value });
  }
  const changeDefinition = cloneChangeDefinition();
  if (changeDefinition) {
    multiline.push(changeDefinition);
  }

  const measuredMultiline = measureWarningLines(multiline, measureCtx);
  return measuredMultiline ? { lines: measuredMultiline, lineGap: null } : null;
}

function drawRoundedRect(ctx, x, y, width, height, radius = 24) {
  const r = Math.max(4, radius);
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, r);
    ctx.closePath();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawComparisonArrow(ctx, { x, y, width, height, trend, isEnergy, assets }) {
  const shouldUseGreen = isEnergy || trend === 'lower';
  const image = shouldUseGreen ? assets?.arrowGreen : assets?.arrowRed;
  const shouldFlip = !isEnergy && trend === 'lower';
  if (image) {
    ctx.save();
    if (shouldFlip) {
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate(Math.PI);
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    } else {
      ctx.drawImage(image, x, y, width, height);
    }
    ctx.restore();
    return;
  }

  ctx.save();
  const fallbackColor = shouldUseGreen ? '#2e8540' : '#d62828';
  ctx.fillStyle = fallbackColor;
  ctx.beginPath();
  if (shouldFlip) {
    ctx.moveTo(x + width / 2, y + height);
    ctx.lineTo(x, y);
    ctx.lineTo(x + width, y);
  } else {
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x + width, y + height);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawComparisonCard(ctx, { card, layout, x, y, width, height, typography }) {
  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, 24);
  ctx.fillStyle = card.color || '#444444';
  ctx.fill();
  const shouldOutlineText = Boolean(window.Colors?.shouldOutlineLightCard?.(card.color));
  const outlineColor = 'rgba(0, 0, 0, 0.62)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  const textX = x + width / 2;
  const verticalOffset = Math.max(0, (height - layout.contentHeight) / 2);
  let cursorY = y + verticalOffset + typography.paddingY;
  const blocks = [
    { lines: layout.nameLines, font: typography.largeFont, lineHeight: typography.largeLineHeight },
    { lines: layout.subtitleLines, font: typography.smallFont, lineHeight: typography.smallLineHeight },
    { lines: layout.ratioLines, font: typography.largeFont, lineHeight: typography.largeLineHeight },
    { lines: layout.followerLines, font: typography.smallFont, lineHeight: typography.smallLineHeight }
  ];
  blocks.forEach((block, index) => {
    if (!block.lines.length) {
      return;
    }
    ctx.font = block.font;
    const outlineWidth = shouldOutlineText
      ? Math.min(4, Math.max(1.1, getFontPixelSize(block.font) * 0.085))
      : 0;
    block.lines.forEach(line => {
      if (shouldOutlineText) {
        ctx.lineWidth = outlineWidth;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2.5;
        ctx.strokeStyle = outlineColor;
        ctx.strokeText(line, textX, cursorY);
      }
      ctx.fillText(line, textX, cursorY);
      cursorY += block.lineHeight;
    });
    const hasNext = blocks.slice(index + 1).some(next => next.lines.length);
    if (hasNext) {
      cursorY += typography.blockGap;
    }
  });
  ctx.restore();
}

function drawInclusionCard(ctx, { layout, x, y }) {
  if (!layout) {
    return;
  }
  ctx.save();
  drawRoundedRect(ctx, x, y, layout.width, layout.height, layout.radius);
  ctx.fillStyle = layout.background;
  ctx.strokeStyle = layout.borderColor;
  ctx.lineWidth = 4;
  ctx.fill();
  ctx.stroke();
  let cursorY = y + layout.padding;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  if (layout.label) {
    ctx.font = layout.labelFont;
    ctx.fillStyle = '#1d2939';
    ctx.fillText(layout.label, x + layout.padding, cursorY);
    cursorY += layout.lineHeight + 12;
  }
  ctx.font = layout.textFont;
  ctx.fillStyle = '#1d2939';
  layout.bodyLines.forEach(line => {
    ctx.fillText(line, x + layout.padding, cursorY);
    cursorY += layout.lineHeight;
  });
  if (layout.details.length) {
    cursorY += 20;
    ctx.font = layout.detailFont;
    layout.details.forEach(group => {
      group.forEach(line => {
        ctx.fillText(line, x + layout.padding, cursorY);
        cursorY += layout.detailLineHeight;
      });
    });
  }
  ctx.restore();
}

function drawComparisonWarning(ctx, { x, y, width, warning, layout, assets, centerText = false }) {
  if (!layout) {
    return;
  }
  const { iconHeight, iconWidth, wrapGap, paddingX, paddingY, height, lines, textHeight, lineGap } = layout;
  const resolvedIconHeight = iconHeight || layout.iconSize || 0;
  const resolvedIconWidth = iconWidth || resolvedIconHeight;
  let renderLines = Array.isArray(lines) && lines.length ? lines : null;
  if (!renderLines) {
    const fallbackFont = '700 44px "Inter", system-ui, sans-serif';
    renderLines = measureWarningLines([
      {
        tokens: [{ text: warningText || '', font: fallbackFont, fill: '#ffffff' }],
        lineHeight: 56
      }
    ], ctx) || [];
  }
  if (!renderLines.length) {
    return;
  }
  const computedLineGap = typeof lineGap === 'number' ? lineGap : 0;

  const leftIconX = x;
  const iconY = y + (height - resolvedIconHeight) / 2;
  drawComparisonWarningIcon(ctx, assets?.warningIcon, leftIconX, iconY, resolvedIconWidth, resolvedIconHeight);

  const rowX = x + resolvedIconWidth + wrapGap;
  const rowWidth = Math.max(220, width - resolvedIconWidth * 2 - wrapGap * 2);
  const availableWidth = Math.max(80, rowWidth - paddingX * 2);
  ctx.save();
  drawRoundedRect(ctx, rowX, y, rowWidth, height, 18);
  ctx.fillStyle = '#e32020';
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const shouldOutlineText = true;
  const outlineColor = 'rgba(0, 0, 0, 0.62)';
  const blockHeight = typeof textHeight === 'number'
    ? textHeight
    : renderLines.reduce((sum, line, index) => sum + line.ascent + line.descent + (index > 0 ? computedLineGap : 0), 0);
  const blockTop = centerText
    ? y + (height - blockHeight) / 2
    : y + paddingY;
  let currentTop = blockTop;

  renderLines.forEach((line, index) => {
    const lineWidth = Number.isFinite(line.width) ? Math.min(line.width, availableWidth) : availableWidth;
    const shouldCenter = centerText && lineWidth < availableWidth;
    const startX = shouldCenter
      ? rowX + paddingX + (availableWidth - lineWidth) / 2
      : rowX + paddingX;
    let cursorX = startX;
    const baselineY = currentTop + line.ascent;
    (line.tokens || []).forEach(token => {
      if (!token?.text) {
        return;
      }
      ctx.font = token.font;
      ctx.fillStyle = token.fill || '#ffffff';
      if (shouldOutlineText) {
        const outlineWidth = Math.min(4, Math.max(1.1, getFontPixelSize(token.font) * 0.085));
        ctx.lineWidth = outlineWidth;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2.5;
        ctx.strokeStyle = outlineColor;
        ctx.strokeText(token.text, cursorX, baselineY);
      }
      ctx.fillText(token.text, cursorX, baselineY);
      cursorX += token.width ?? ctx.measureText(token.text).width;
    });
    currentTop += line.ascent + line.descent + (index < renderLines.length - 1 ? computedLineGap : 0);
  });
  ctx.restore();

  const rightIconX = rowX + rowWidth + wrapGap;
  drawComparisonWarningIcon(ctx, assets?.warningIcon, rightIconX, iconY, resolvedIconWidth, resolvedIconHeight);
}

function drawComparisonWarningIcon(ctx, image, x, y, width, height) {
  if (image) {
    ctx.save();
    ctx.drawImage(image, x, y, width, height);
    ctx.restore();
    return;
  }
  drawWarningIcon(ctx, x + width / 2, y + height / 2, Math.min(width, height));
}

function drawWarningIcon(ctx, centerX, centerY, size) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - half);
  ctx.lineTo(centerX - half, centerY + half);
  ctx.lineTo(centerX + half, centerY + half);
  ctx.closePath();
  ctx.stroke();
  ctx.font = '700 48px "Inter", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', centerX, centerY + 8);
  ctx.restore();
}

function drawMetricCardRow(ctx, { metrics, x, y, cardWidth, cardGap, height }) {
  let cardX = x;
  metrics.forEach((metric, index) => {
    drawMetricCard(ctx, { metric, x: cardX, y, width: cardWidth, height });
    cardX += cardWidth + (index < metrics.length - 1 ? cardGap : 0);
  });
}

function drawMetricCard(ctx, { metric, x, y, width, height }) {
  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, 24);
  ctx.fillStyle = '#f4f4f6';
  ctx.fill();
  ctx.strokeStyle = '#e0e0e0';
  ctx.stroke();
  const innerPadding = 28;
  let cursorY = y + innerPadding;
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '700 64px "Inter", system-ui, sans-serif';
  const nameLines = wrapTextIntoLines(ctx, ctx.font, metric.name || '—', width - innerPadding * 2);
  nameLines.forEach(line => {
    ctx.fillText(line, x + innerPadding, cursorY);
    cursorY += 74;
  });
  const statLabelFont = '600 42px "Inter", system-ui, sans-serif';
  const statValueFont = '700 58px "Inter", system-ui, sans-serif';
  const statLabelColor = '#6c6f78';
  const statValueColor = '#111111';
  const stats = [
    { label: 'POLLUTION', value: metric.pollution || '—' },
    { label: 'ENERGY', value: metric.energy || '—' },
    { label: 'EMISSION FACTOR', value: metric.emissionFactor || '—' }
  ];
  stats.forEach((stat, index) => {
    ctx.fillStyle = statLabelColor;
    ctx.font = statLabelFont;
    ctx.fillText(stat.label, x + innerPadding, cursorY);
    cursorY += 52;
    ctx.fillStyle = statValueColor;
    ctx.font = statValueFont;
    ctx.fillText(stat.value, x + innerPadding, cursorY);
    cursorY += index < stats.length - 1 ? 72 : 64;
  });
  ctx.restore();
}

function drawCalculationRow(ctx, { row, x, y, blockWidth, columnGap, rowWidth, headerFont, lineFont, lineHeight, padding, alignRight }) {
  const blockCount = row.blocks.length;
  if (!blockCount) {
    return;
  }
  let blockX = x;
  row.blocks.forEach(block => {
    drawCalculationBlock(ctx, {
      block,
      x: blockX,
      y,
      width: blockWidth,
      height: row.contentHeight,
      headerFont,
      lineFont,
      lineHeight,
      padding,
      alignRight
    });
    blockX += blockWidth + columnGap;
  });
}

function drawCalculationBlock(ctx, { block, x, y, width, height, headerFont, lineFont, lineHeight, padding, alignRight }) {
  ctx.save();
  const radius = alignRight ? 0 : 18;
  if (radius > 0) {
    drawRoundedRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  ctx.textBaseline = 'top';
  const labelColor = '#000000';
  const valueColor = '#000000';
  const firstRowY = y + padding;
  if (alignRight) {
    const valueX = x + width - padding;
    ctx.textAlign = 'left';
    ctx.font = headerFont;
    ctx.fillStyle = labelColor;
    ctx.fillText(block.title || '', x + padding, firstRowY);
    ctx.textAlign = 'right';
    ctx.font = lineFont;
    ctx.fillStyle = valueColor;
    ctx.fillText(block.primaryLine || '—', valueX, firstRowY);
    if (block.secondaryLine) {
      ctx.fillText(block.secondaryLine, valueX, firstRowY + lineHeight);
    }
  } else {
    ctx.textAlign = 'left';
    ctx.font = headerFont;
    ctx.fillStyle = labelColor;
    let cursorY = firstRowY;
    ctx.fillText(block.title || '', x + padding, cursorY);
    cursorY += lineHeight;
    ctx.font = lineFont;
    ctx.fillStyle = valueColor;
    block.lines.forEach(line => {
      ctx.fillText(line, x + padding, cursorY);
      cursorY += lineHeight;
    });
  }
  ctx.restore();
}

function drawInclusionNote(ctx) {
  // legacy no-op retained for backward compatibility
}

