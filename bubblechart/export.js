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
      chartType: 'bubble_chart',
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
          const year = chartData.year;
          const padding = 50;
          const yearHeight = 152; // Space tuned for 120px year label plus additional top offset
          const titleHeight = 162; // Space for enlarged pollutant title
          const subtitleHeight = 40; // Space for subtitle line
          const headerText = 'UK Air Pollution/Emissions';
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

          const headerMetrics = buildHeaderMetrics(canvasWidth);
          const footerLayout = buildFooterLayout(canvasWidth);
          const legendLayout = buildLegendLayout(canvasWidth, chartData);
          const efTextLineHeight = 70;
          const legendSpacing = legendLayout.rows.length ? efTextLineHeight * 2 : 0;
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
              exportLogger.warn('CIC banner failed to load for narrow export', err);
            }
          }

          const bannerExtraHeight = bannerConfig ? bannerConfig.spacingTop + bannerConfig.height + bannerConfig.spacingBottom : 0;

          const canvas = document.createElement('canvas');
          const canvasHeight = headerMetrics.height + yearHeight + titleHeight + legendHeight + chartHeight + footerLayout.totalHeight + bannerExtraHeight + padding * 2;
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          const ctx = canvas.getContext('2d');

          // Draw all elements onto the canvas

          // Background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);

          // Year - Above title (larger than title)
          ctx.font = headerMetrics.font;
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'center';
          const headerBaseline = padding + headerMetrics.fontSize;
          ctx.fillText(headerText, canvasWidth / 2, headerBaseline);

          const yearTopOffset = padding + headerMetrics.height + 90;

          ctx.font = 'bold 120px system-ui, sans-serif'; // Dramatically larger than title
          ctx.fillText(year, canvasWidth / 2, yearTopOffset);

          // Title - Pollutant name
          ctx.font = 'bold 95px system-ui, sans-serif'; // Larger title while remaining below year size
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'center';
          ctx.fillText(`${pollutantName}${pollutantUnit ? " - " + pollutantUnit : ""}`, canvasWidth / 2, padding + headerMetrics.height + yearHeight + 55);

          // Custom Legend - Larger Font and Dots (starts after title area)
          let legendY = padding + headerMetrics.height + yearHeight + 155; // 100px baseline gap below pollutant title
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

          // Chart Image - with precise clipping on top and right only (no borders there)
          const chartY = padding + headerMetrics.height + yearHeight + titleHeight + legendHeight + 20; // Tight gap before chart
          
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

          // Draw Branding and Footer
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
                const logoSize = 360; // Enlarged CIC logo for exports
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

