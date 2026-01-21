(function (global) {
  var MiniColors = {
    eco: '#F58231',
    fireplace: '#911EB4',
    replacement: '#F58231'
  };

  function formatValue(value) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    var abs = Math.abs(value);
    if (abs === 0) {
      return '0';
    }
    if (abs >= 1) {
      var maxFrac = abs >= 1000 ? 0
        : abs >= 100 ? 1
        : 2;
      var formatter = new Intl.NumberFormat('en-GB', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxFrac
      });
      return formatter.format(value);
    }
    var exp = Math.floor(Math.log10(abs));
    var decimals = Math.min(8, Math.max(3, -exp + 2));
    var fixed = value.toFixed(decimals);
    return fixed.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, '$1');
  }

  function computePercentTrend(fireplace, replacement) {
    var baseline = Math.abs(fireplace);
    var change;
    if (baseline === 0) {
      if (replacement === fireplace) {
        change = 0;
      } else {
        change = replacement > fireplace ? Infinity : -Infinity;
      }
    } else {
      change = ((replacement - fireplace) / baseline) * 100;
    }
    var absChange = Math.abs(change);
    var isFiniteChange = Number.isFinite(absChange);
    var formatted = isFiniteChange ? absChange.toFixed(1) : '∞';
    var display = change > 0 ? '+' + formatted + '%' : change < 0 ? '-' + formatted + '%' : '0%';
    var trend = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
    return { display: display, trend: trend, value: change };
  }

  function getUnitShort(unit) {
    if (global.EmissionUnits && typeof global.EmissionUnits.formatAbbreviation === 'function') {
      var formatted = global.EmissionUnits.formatAbbreviation(unit);
      if (formatted) {
        return formatted;
      }
    }
    return unit || '';
  }

  function normalizeLabel(text) {
    return (text || '')
      .replace(/[\u0000-\u0020\u00a0\u2000-\u200f\u2028\u202f\u3000]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var _measureCanvas = null;
  function measureTextWidth(text, fontSize, fontWeight) {
    if (!_measureCanvas) {
      _measureCanvas = document.createElement('canvas');
    }
    var ctx = _measureCanvas.getContext('2d');
    if (!ctx) {
      return 0;
    }
    var size = Number(fontSize) || 11;
    var weight = fontWeight || '600';
    ctx.font = weight + ' ' + size + 'px "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    var metrics = ctx.measureText(String(text || ''));
    return metrics && metrics.width ? metrics.width : 0;
  }

  function formatTickShort(value) {
    if (!Number.isFinite(value)) {
      return '';
    }
    var abs = Math.abs(value);
    if (abs >= 1000) {
      var short = value / 1000;
      var rounded = Math.abs(short) >= 10 ? short.toFixed(0) : short.toFixed(1);
      return rounded.replace(/\.0$/, '') + 'k';
    }
    var maxFrac = abs >= 100 ? 0
      : abs >= 10 ? 1
      : abs >= 1 ? 2
      : abs >= 0.1 ? 3
      : abs >= 0.01 ? 4
      : abs >= 0.001 ? 5
      : 6;
    var formatter = new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFrac
    });
    return formatter.format(value);
  }

  function getRowTotal(row) {
    if (!row) {
      return NaN;
    }
    var explicit = Number(row.value);
    if (Number.isFinite(explicit) && explicit > 0) {
      return explicit;
    }
    if (Array.isArray(row.values)) {
      return row.values.reduce(function (sum, value) {
        var num = Number(value);
        if (!Number.isFinite(num) || num <= 0) {
          return sum;
        }
        return sum + num;
      }, 0);
    }
    return NaN;
  }

  function getRowAnnotationColor(row, fallback) {
    if (row && row.annotationColor) {
      return row.annotationColor;
    }
    if (row && row.color) {
      return row.color;
    }
    return fallback || MiniColors.eco;
  }

  function resolveSeriesColors(seriesCount, provided) {
    var defaults = [MiniColors.eco, MiniColors.fireplace, MiniColors.replacement];
    var colors = Array.isArray(provided) && provided.length ? provided.slice(0, seriesCount) : defaults.slice(0, seriesCount);
    while (colors.length < seriesCount) {
      colors.push(MiniColors.eco);
    }
    return colors;
  }

  function styleBarAnnotations(container, labels, colors) {
    var svg = container ? container.querySelector('svg') : null;
    if (!svg) {
      return;
    }
    var normalized = labels.map(normalizeLabel);
    var texts = Array.from(svg.querySelectorAll('text')).filter(function (node) {
      return node.getAttribute('text-anchor') === 'middle';
    });
    texts.forEach(function (node, idx) {
      var content = normalizeLabel(node.textContent || '');
      var labelIndex = normalized.indexOf(content);
      var color = colors[labelIndex >= 0 ? labelIndex : idx % colors.length] || '#111827';
      node.setAttribute('fill', color);
      node.setAttribute('stroke', '#ffffff');
      node.setAttribute('stroke-width', '3');
      node.setAttribute('paint-order', 'stroke');
      node.setAttribute('font-family', '"Tiresias Infofont", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
      node.setAttribute('font-weight', '700');
      node.setAttribute('font-size', '15');
      if (node.hasAttribute('y')) {
        var currentY = Number(node.getAttribute('y'));
        if (Number.isFinite(currentY)) {
          node.setAttribute('y', String(currentY - 6));
        }
      }
      var spans = node.querySelectorAll('tspan');
      spans.forEach(function (span) {
        span.setAttribute('fill', color);
        span.setAttribute('stroke', '#ffffff');
        span.setAttribute('stroke-width', '3');
        span.setAttribute('paint-order', 'stroke');
        span.setAttribute('font-family', '"Tiresias Infofont", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
        span.setAttribute('font-weight', '700');
        span.setAttribute('font-size', '15');
      });
    });
  }

  function styleAxes(container, axisColors, options) {
    var svg = container ? container.querySelector('svg') : null;
    if (!svg) {
      return 0;
    }
    var vAxisColor = (axisColors && axisColors.labelColor) || '#0f172a';
    var majorColor = (axisColors && axisColors.majorColor) || '#cbd5e1';
    var minorColor = (axisColors && axisColors.minorColor) || '#e2e8f0';
    var formatter = options && options.labelFormatter;
    var axisTicks = options && Array.isArray(options.axisTicks) ? options.axisTicks.filter(Number.isFinite) : null;
    var axisFontSize = options && Number.isFinite(options.fontSize) ? options.fontSize : 11;
    var layoutInterface = options && options.layoutInterface;
    var hasLayoutValue = layoutInterface && typeof layoutInterface.getVAxisValue === 'function';
    var maxWidth = 0;

    function parseAxisNumber(raw) {
      var rawText = String(raw || '').trim();
      var cleaned = rawText.replace(/,/g, '').trim().toLowerCase();
      if (!cleaned) {
        return NaN;
      }
      var hasEllipsis = cleaned.includes('…') || cleaned.includes('...');
      if (hasEllipsis) {
        var digits = cleaned.replace(/[^0-9]/g, '');
        if (digits) {
          var base = Number(digits);
          if (Number.isFinite(base)) {
            return base * 1000;
          }
        }
      }
      var multiplier = 1;
      var suffix = cleaned.slice(-1);
      if (suffix === 'k') {
        multiplier = 1000;
        cleaned = cleaned.slice(0, -1);
      } else if (suffix === 'm') {
        multiplier = 1000000;
        cleaned = cleaned.slice(0, -1);
      } else if (suffix === 'b') {
        multiplier = 1000000000;
        cleaned = cleaned.slice(0, -1);
      }
      var num = Number(cleaned);
      return Number.isFinite(num) ? num * multiplier : NaN;
    }

    var axisNodes = Array.from(svg.querySelectorAll('text[text-anchor="end"]'));
    var nodesByY = axisNodes.map(function (node) {
      return { node: node, y: Number(node.getAttribute('y')) || 0 };
    });
    var needsMapping = false;
    if (axisNodes.length) {
      axisNodes.forEach(function (node) {
        var raw = (node.textContent || '').trim();
        if (raw.includes('…') || raw.includes('...') || !Number.isFinite(parseAxisNumber(raw))) {
          needsMapping = true;
        }
      });
    }
    var mapped = false;
    var chartArea = hasLayoutValue && layoutInterface.getChartAreaBoundingBox
      ? layoutInterface.getChartAreaBoundingBox()
      : null;
    if (formatter && axisNodes.length && hasLayoutValue) {
      var gridlineNodes = Array.from(svg.querySelectorAll('g[aria-label="gridline"] rect, g[aria-label="gridline"] line'));
      var gridlines = [];
      var seen = new Set();
      gridlineNodes.forEach(function (node) {
        var tag = node.tagName ? node.tagName.toLowerCase() : '';
        var y = tag === 'rect' ? Number(node.getAttribute('y')) : Number(node.getAttribute('y1'));
        if (!Number.isFinite(y)) {
          return;
        }
        var key = String(Math.round(y * 10) / 10);
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        var localY = y;
        if (chartArea && Number.isFinite(chartArea.top)) {
          localY = y - chartArea.top;
        }
        var value = layoutInterface.getVAxisValue(localY);
        if (Number.isFinite(value)) {
          if (Math.abs(value) < 1e-8) {
            value = 0;
          }
          gridlines.push({ y: y, value: value });
        }
      });
      if (gridlines.length) {
        gridlines.sort(function (a, b) { return b.y - a.y; });
        nodesByY.sort(function (a, b) { return b.y - a.y; });
        var count = Math.min(nodesByY.length, gridlines.length);
        for (var i = 0; i < count; i += 1) {
          var formatted = formatter(gridlines[i].value);
          if (formatted) {
            nodesByY[i].node.textContent = formatted;
          }
        }
        mapped = true;
      }
    }
    if (!mapped && formatter && axisTicks && axisTicks.length && axisNodes.length && needsMapping) {
      var sortedTicks = axisTicks.slice().sort(function (a, b) { return a - b; });
      nodesByY.sort(function (a, b) { return b.y - a.y; });
      if (sortedTicks.length === nodesByY.length) {
        nodesByY.forEach(function (entry, idx) {
          var formatted = formatter(sortedTicks[idx]);
          if (formatted) {
            entry.node.textContent = formatted;
          }
        });
      }
    } else if (!mapped && formatter) {
      axisNodes.forEach(function (node) {
        var raw = (node.textContent || '').trim();
        var num = parseAxisNumber(raw);
        if (Number.isFinite(num)) {
          var formatted = formatter(num);
          if (formatted) {
            node.textContent = formatted;
          }
        }
      });
    }

    if (formatter) {
      axisNodes.forEach(function (node) {
        var raw = (node.textContent || '').trim();
        if (raw.includes('…') || raw.includes('...')) {
          var num = parseAxisNumber(raw);
          if (Number.isFinite(num)) {
            var formatted = formatter(num);
            if (formatted) {
              node.textContent = formatted;
            }
          }
        }
      });
    }

    var hasKLabel = axisNodes.some(function (node) {
      var label = (node.textContent || '').trim().toLowerCase();
      return label.endsWith('k');
    });

    axisNodes.forEach(function (node) {
      node.setAttribute('fill', vAxisColor);
      node.setAttribute('font-size', String(axisFontSize));
      node.setAttribute('font-weight', '600');
      node.removeAttribute('aria-hidden');
      node.style.opacity = '1';
      if (hasKLabel) {
        node.setAttribute('dx', '-10');
      } else {
        node.removeAttribute('dx');
      }
      maxWidth = Math.max(maxWidth, measureTextWidth(node.textContent || '', axisFontSize, '600'));
    });

    Array.from(svg.querySelectorAll('g[aria-label="gridline"] line, g[aria-label="gridline"] rect')).forEach(function (line) {
      if (line.tagName && line.tagName.toLowerCase() === 'rect') {
        line.setAttribute('fill', majorColor);
      } else {
        line.setAttribute('stroke', majorColor);
        line.setAttribute('stroke-width', '1');
      }
      line.setAttribute('opacity', '1');
    });

    Array.from(svg.querySelectorAll('g[aria-label="minor gridline"] line, g[aria-label="minor gridline"] rect')).forEach(function (line) {
      if (line.tagName && line.tagName.toLowerCase() === 'rect') {
        line.setAttribute('fill', minorColor);
      } else {
        line.setAttribute('stroke', minorColor);
        line.setAttribute('stroke-width', '1');
      }
      line.setAttribute('opacity', '1');
    });

    return maxWidth;
  }

  function renderCustomAxis(chart, container, ticks, options) {
    if (!chart || !chart.getChartLayoutInterface || !container) {
      return;
    }
    var cli = chart.getChartLayoutInterface();
    if (!cli || typeof cli.getXLocation !== 'function' || typeof cli.getYLocation !== 'function') {
      return;
    }
    var svg = container.querySelector('svg');
    if (!svg) {
      return;
    }

    if (!container.style.position || container.style.position === 'static') {
      container.style.position = 'relative';
    }
    var layer = container.querySelector('.mini-axis-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'mini-axis-layer';
      Object.assign(layer.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '2'
      });
      container.appendChild(layer);
    }
    layer.innerHTML = '';

    var bbox = cli.getChartAreaBoundingBox();
    var top = bbox.top || 0;
    var height = bbox.height || 0;
    var left = bbox.left || 0;
    var width = bbox.width || 0;
    var majorColor = (options && options.majorColor) || '#cbd5e1';
    var minorColor = (options && options.minorColor) || '#e2e8f0';
    var labelColor = (options && options.labelColor) || '#0f172a';

    var labels = Array.isArray(ticks) && ticks.length ? ticks : [];
    labels.forEach(function (tick, idx) {
      if (!Number.isFinite(tick)) {
        return;
      }
      var y = cli.getYLocation(tick);
      if (!Number.isFinite(y)) {
        return;
      }
      var line = document.createElement('div');
      Object.assign(line.style, {
        position: 'absolute',
        left: left + 'px',
        width: width + 'px',
        top: y + 'px',
        height: '1px',
        background: idx === 0 ? minorColor : majorColor,
        opacity: '1'
      });
      layer.appendChild(line);

      var label = document.createElement('div');
      label.textContent = formatValue(tick);
      Object.assign(label.style, {
        position: 'absolute',
        right: (width + 12) + 'px',
        top: (y - 8) + 'px',
        color: labelColor,
        fontSize: '12px',
        fontWeight: '600',
        textAlign: 'right',
        minWidth: '48px'
      });
      layer.appendChild(label);
    });

    var minorCount = (options && options.minorCount) || 0;
    if (labels.length >= 2 && minorCount > 0) {
      for (var i = 0; i < labels.length - 1; i++) {
        var start = labels[i];
        var end = labels[i + 1];
        var step = (end - start) / (minorCount + 1);
        for (var j = 1; j <= minorCount; j++) {
          var minorValue = start + step * j;
          var yMinor = cli.getYLocation(minorValue);
          if (!Number.isFinite(yMinor)) {
            continue;
          }
          var mline = document.createElement('div');
          Object.assign(mline.style, {
            position: 'absolute',
            left: left + 'px',
            width: width + 'px',
            top: yMinor + 'px',
            height: '1px',
            background: minorColor,
            opacity: '1'
          });
          layer.appendChild(mline);
        }
      }
    }
  }

  function buildTicksFromRows(rows, viewWindowMax) {
    var values = Array.isArray(rows)
      ? rows.map(function (row) { return getRowTotal(row); }).filter(Number.isFinite)
      : [];
    var max = Math.max.apply(Math, [0].concat(values, [Number(viewWindowMax) || 0]));
    if (!Number.isFinite(max) || max <= 0) {
      return [];
    }
    var magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    var candidates = [1, 2, 2.5, 5, 10].map(function (m) { return (m * magnitude) / 5; });
    var step = candidates.find(function (c) { return max / c <= 6; }) || magnitude;
    var upper = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = 0; v <= upper + 1e-9; v += step) {
      ticks.push(Number(v.toFixed(6)));
    }
    return ticks;
  }

  function removeNativeAnnotations(container) {
    var svg = container ? container.querySelector('svg') : null;
    if (!svg) {
      return;
    }
    var selectors = [
      'g[aria-label="annotation"]',
      'g[aria-label="annotations"]',
      'g[aria-label="annotation"] text',
      'g[clip-path*="annotation"] text'
    ];
    selectors.forEach(function (sel) {
      Array.from(svg.querySelectorAll(sel)).forEach(function (node) {
        node.remove();
      });
    });
  }

  function renderOverlayAnnotations(chart, container, rows, unitShort) {
    if (!chart || !chart.getChartLayoutInterface || !container) {
      return;
    }
    var svg = container.querySelector('svg');
    if (!svg) {
      return;
    }
    var cli = chart.getChartLayoutInterface();
    if (!cli || typeof cli.getXLocation !== 'function' || typeof cli.getYLocation !== 'function') {
      return;
    }

    if (!container.style.position || container.style.position === 'static') {
      container.style.position = 'relative';
    }
    var layer = container.querySelector('.mini-anno-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'mini-anno-layer';
      Object.assign(layer.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '4'
      });
      container.appendChild(layer);
    }
    layer.innerHTML = '';
    var containerBox = container.getBoundingClientRect ? container.getBoundingClientRect() : null;
    var containerWidth = containerBox ? containerBox.width : (container.clientWidth || 0);
    var edgePad = 0;

    rows.forEach(function (row, idx) {
      var value = getRowTotal(row);
      if (!Number.isFinite(value)) {
        return;
      }
      var x = cli.getXLocation(idx);
      var y = cli.getYLocation(value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      var text = document.createElement('div');
      text.className = 'mini-anno';
      var annotation = row.annotation || (formatValue(value) + (unitShort ? ' ' + unitShort : ''));
      text.textContent = annotation;
      var color = getRowAnnotationColor(row, MiniColors.eco);
      Object.assign(text.style, {
        position: 'absolute',
        left: x + 'px',
        top: y + 'px',
        transform: 'translate(-50%, -18px)',
        color: color,
        fontFamily: '"Tiresias Infofont", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontWeight: '700',
        fontSize: '15px',
        WebkitTextStroke: '3px #ffffff',
        paintOrder: 'stroke',
        textShadow: '0 0 0 #ffffff'
      });
      layer.appendChild(text);
    });
  }

  function renderStackedStyleAnnotations(chart, container, rows, unitShort) {
    if (!chart || !chart.getChartLayoutInterface || !container) {
      return;
    }
    var svg = container.querySelector('svg');
    if (!svg) {
      return;
    }
    var cli = chart.getChartLayoutInterface();
    if (!cli || typeof cli.getXLocation !== 'function' || typeof cli.getYLocation !== 'function') {
      return;
    }
    if (!container.style.position || container.style.position === 'static') {
      container.style.position = 'relative';
    }
    var layer = container.querySelector('.mini-anno-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'mini-anno-layer';
      Object.assign(layer.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '4'
      });
      container.appendChild(layer);
    }
    layer.innerHTML = '';
    var containerBox = container.getBoundingClientRect ? container.getBoundingClientRect() : null;
    var containerWidth = containerBox ? containerBox.width : (container.clientWidth || 0);
    var edgePad = 6;

    rows.forEach(function (row, idx) {
      var value = getRowTotal(row);
      if (!Number.isFinite(value)) {
        return;
      }
      var x = cli.getXLocation(idx);
      var y = cli.getYLocation(value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      var span = document.createElement('span');
      span.className = 'mini-anno';
      var annotation = row.annotation || (formatValue(value) + (unitShort ? ' ' + unitShort : ''));
      span.textContent = annotation;
      var color = getRowAnnotationColor(row, MiniColors.eco);
      var isEdge = idx === rows.length - 1 && Number.isFinite(containerWidth) && containerWidth > 0;
      var left = x;
      Object.assign(span.style, {
        position: 'absolute',
        left: left + 'px',
        top: y + 'px',
        transform: 'translate(-50%, -18px)',
        color: color,
        fontFamily: '"Tiresias Infofont", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontWeight: '700',
        fontSize: '15px',
        WebkitTextStroke: '3px #ffffff',
        textShadow: '1px 1px 0 #ffffff, -1px -1px 0 #ffffff, -1px 1px 0 #ffffff, 1px -1px 0 #ffffff, 0 1px 0 #ffffff, 0 -1px 0 #ffffff, 1px 0 0 #ffffff, -1px 0 0 #ffffff, 0 0 3px rgba(255,255,255,0.9)',
        paintOrder: 'stroke',
        whiteSpace: isEdge ? 'nowrap' : 'normal',
        pointerEvents: 'none'
      });
      layer.appendChild(span);
      if (isEdge && containerBox && span.getBoundingClientRect) {
        var spanBox = span.getBoundingClientRect();
        var maxRight = containerBox.right - edgePad;
        if (spanBox.right > maxRight) {
          var overflow = spanBox.right - maxRight;
          var currentLeft = parseFloat(span.style.left) || left;
          span.style.left = (currentLeft - overflow) + 'px';
        }
      }
    });
  }

  function renderOverlayFromRects(container, rows, unitShort) {
    var svg = container ? container.querySelector('svg') : null;
    if (!svg) {
      return;
    }
    var svgPoint = svg.createSVGPoint ? svg.createSVGPoint() : null;
    var mapPoint = function (x, y) {
      if (!svgPoint || !svg.getScreenCTM) {
        return null;
      }
      svgPoint.x = x;
      svgPoint.y = y;
      var ctm = svg.getScreenCTM();
      if (!ctm) {
        return null;
      }
      var screen = svgPoint.matrixTransform(ctm);
      return screen;
    };

    var rects = Array.from(svg.querySelectorAll('rect[fill]')).filter(function (r) {
      var box = r.getBBox();
      return box && box.width > 0 && box.height > 0;
    });
    if (!rects.length) {
      return;
    }
    rects.sort(function (a, b) { return a.getBBox().x - b.getBBox().x; });
    var target = rects.slice(0, rows.length);

    if (!container.style.position || container.style.position === 'static') {
      container.style.position = 'relative';
    }
    var layer = container.querySelector('.mini-anno-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'mini-anno-layer';
      Object.assign(layer.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '4'
      });
      container.appendChild(layer);
    }
    layer.innerHTML = '';

    var svgBox = svg.getBoundingClientRect();
    var containerBox = container.getBoundingClientRect();

    target.forEach(function (bar, idx) {
      var box = bar.getBBox();
      var row = rows[idx] || {};
      var value = getRowTotal(row);
      if (!Number.isFinite(value)) {
        return;
      }
      var text = document.createElement('div');
      var annotation = row.annotation || (formatValue(value) + (unitShort ? ' ' + unitShort : ''));
      text.className = 'mini-anno';
      text.textContent = annotation;
      var color = getRowAnnotationColor(row, MiniColors.eco);

      var mapped = mapPoint ? mapPoint(box.x + box.width / 2, box.y) : null;
      var absoluteLeft = mapped ? mapped.x - containerBox.left : (svgBox.left + box.x + box.width / 2 - containerBox.left);
      var absoluteTop = mapped ? mapped.y - containerBox.top : (svgBox.top + box.y - containerBox.top);
      var lift = Number(container.dataset?.rectOverlayLift) || 10;
      absoluteTop -= lift;

      Object.assign(text.style, {
        position: 'absolute',
        left: absoluteLeft + 'px',
        top: absoluteTop + 'px',
        transform: 'translate(-50%, -4px)',
        color: color,
        fontFamily: '"Tiresias Infofont", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontWeight: '700',
        fontSize: '15px',
        WebkitTextStroke: '3px #ffffff',
        paintOrder: 'stroke',
        pointerEvents: 'none'
      });
      layer.appendChild(text);
    });
  }

  function renderMiniBarChart(config) {
    if (!config || !config.container) {
      return null;
    }
    if (!global.google || !global.google.visualization) {
      return null;
    }
    var rows = Array.isArray(config.rows) ? config.rows : [];
    var unitShort = typeof config.unitShort === 'string' ? config.unitShort : '';
    var height = Number(config.height) || 260;
    var ticks = Array.isArray(config.ticks) && config.ticks.length ? config.ticks : undefined;
    var viewWindowMax = Number.isFinite(config.viewWindowMax) ? config.viewWindowMax : undefined;
    var useMultiSeries = rows.some(function (row) { return Array.isArray(row && row.values); }) || Array.isArray(config.seriesColors);
    var seriesCount = useMultiSeries
      ? Math.max(
        Array.isArray(config.seriesColors) ? config.seriesColors.length : 0,
        rows.reduce(function (max, row) {
          return Math.max(max, Array.isArray(row && row.values) ? row.values.length : 0);
        }, 0)
      )
      : 1;
    if (seriesCount < 1) {
      seriesCount = 1;
    }
    if (!ticks || !ticks.length) {
      ticks = buildTicksFromRows(config.rows, viewWindowMax);
    }
    if (!ticks || !ticks.length) {
      ticks = undefined;
    }
    var labelColor = config.vAxisLabelColor || '#0f172a';
    var majorColor = config.vAxisGridColor || '#cbd5e1';
    var minorColor = config.vAxisMinorGridColor || '#e2e8f0';
    var axisFontSize = Number.isFinite(config.axisLabelFontSize) ? config.axisLabelFontSize : 12;
    var useNativeAxis = !!config.nativeAxis;
    var nativeAxisAuto = !!config.nativeAxisAuto;
    var nativeTicksOverride = Array.isArray(config.nativeAxisTicks) && config.nativeAxisTicks.length ? config.nativeAxisTicks : undefined;
    var nativeViewWindowMax = Number.isFinite(config.nativeAxisViewWindowMax) ? config.nativeAxisViewWindowMax : undefined;
    var nativeViewWindowMin = Number.isFinite(config.nativeAxisViewWindowMin) ? config.nativeAxisViewWindowMin : 0;
    var nativeGridlineOverride = Number.isFinite(config.nativeGridlineCount) ? config.nativeGridlineCount : undefined;
    var nativeMinorGridOverride = Number.isFinite(config.nativeMinorGridlineCount) ? config.nativeMinorGridlineCount : undefined;
    var debugLabel = config.debugLabel || '';
    var categoryTicks = Array.isArray(config.categoryTicks) && config.categoryTicks.length ? config.categoryTicks : undefined;

    var useAutoTicks = useNativeAxis && nativeAxisAuto && !nativeTicksOverride;
    var axisTicks = useNativeAxis ? (useAutoTicks ? undefined : (nativeTicksOverride || ticks)) : ticks;
    var labelTicks = useNativeAxis ? (nativeTicksOverride || ticks) : ticks;
    var axisViewWindowMax = useNativeAxis
      ? (useAutoTicks ? undefined : (nativeViewWindowMax !== undefined ? nativeViewWindowMax : (axisTicks && axisTicks.length ? axisTicks[axisTicks.length - 1] : undefined)))
      : viewWindowMax;
    var axisViewWindowMin = useNativeAxis ? nativeViewWindowMin : 0;
    var gridlineCount = nativeGridlineOverride !== undefined ? nativeGridlineOverride : (ticks && ticks.length ? Math.max(2, ticks.length) : 5);
    var minorGridlineCount = nativeMinorGridOverride !== undefined ? nativeMinorGridOverride : Math.max(1, Math.min(4, gridlineCount - 1));

    var dataTable = new global.google.visualization.DataTable();
    dataTable.addColumn('string', 'Scenario');
    var isOverlay = !!config.overlayAnnotations || useMultiSeries;
    if (useMultiSeries) {
      for (var s = 0; s < seriesCount; s++) {
        dataTable.addColumn('number', 'Emissions ' + (s + 1));
      }
      dataTable.addRows(
        rows.map(function (row) {
          var values = Array.isArray(row && row.values) ? row.values : [];
          var label = row && row.label ? row.label : '';
          var columns = [label];
          for (var i = 0; i < seriesCount; i++) {
            var value = Number(values[i]);
            columns.push(Number.isFinite(value) && value > 0 ? value : null);
          }
          return columns;
        })
      );
    } else {
      dataTable.addColumn('number', 'Emissions');
      dataTable.addColumn({ type: 'string', role: 'style' });
      dataTable.addColumn({ type: 'string', role: 'annotation' });
      dataTable.addRows(
        rows.map(function (row) {
          var value = Number.isFinite(row.value) ? row.value : null;
          var label = row.label || '';
          var color = row.color || MiniColors.eco;
          var annotation = isOverlay ? '' : (row.annotation || (formatValue(row.value) + (unitShort ? ' ' + unitShort : '')));
          return [label, value, 'color: ' + color, annotation];
        })
      );
    }

    var containerWidth = (config.container && config.container.clientWidth) ? config.container.clientWidth : 320;
    var resolvedChartArea = config.chartArea || { width: '78%', height: '74%', top: 8, left: 56, right: 18 };
    var axisLabelPadding = Number.isFinite(config.axisLabelPadding) ? config.axisLabelPadding : 12;
    var axisLabelMinLeft = Number.isFinite(config.axisLabelMinLeft) ? config.axisLabelMinLeft : 0;
    var widthTicks = useNativeAxis ? (nativeTicksOverride || ticks) : ticks;
    var maxRowValue = rows.reduce(function (acc, row) {
      var value = getRowTotal(row);
      return Number.isFinite(value) ? Math.max(acc, value) : acc;
    }, 0);
    if (useNativeAxis && widthTicks && widthTicks.length) {
      var maxLabelWidth = 0;
      widthTicks.forEach(function (tick) {
        if (!Number.isFinite(tick)) {
          return;
        }
        var label = formatTickShort(tick);
        if (label) {
          maxLabelWidth = Math.max(maxLabelWidth, measureTextWidth(label, axisFontSize, '600'));
        }
      });
      var maxValueForWidth = Number.isFinite(axisViewWindowMax) ? axisViewWindowMax : maxRowValue;
      if (widthTicks.length > 1) {
        var step = widthTicks[1] - widthTicks[0];
        if (Number.isFinite(step) && step > 0) {
          maxValueForWidth = Math.max(maxValueForWidth, maxRowValue + step);
        }
      }
      if (Number.isFinite(maxValueForWidth)) {
        var maxLabel = formatTickShort(maxValueForWidth);
        if (maxLabel) {
          maxLabelWidth = Math.max(maxLabelWidth, measureTextWidth(maxLabel, axisFontSize, '600'));
        }
      }
      if (maxLabelWidth > 0) {
        var rightPad = Number(resolvedChartArea.right) || 0;
        var desiredLeft = Math.ceil(maxLabelWidth + axisLabelPadding);
        var nextLeft = Math.max(axisLabelMinLeft, desiredLeft);
        var widthPx = Math.max(0, Math.round(containerWidth - nextLeft - rightPad));
        resolvedChartArea = Object.assign({}, resolvedChartArea, { left: nextLeft, width: widthPx });
      }
    }

    var axisFormat = config.vAxisFormat || '#,##0.######';
    var axisDisplayTicks = axisTicks;
    var options = {
      height: height,
      width: Math.max(240, Math.round(containerWidth)),
      backgroundColor: 'transparent',
      isStacked: useMultiSeries,
      legend: { position: 'none' },
      chartArea: resolvedChartArea,
      colors: useMultiSeries ? resolveSeriesColors(seriesCount, config.seriesColors) : rows.map(function (r) { return r.color || MiniColors.eco; }),
      hAxis: {
        textStyle: { color: '#111827', fontSize: 13, bold: true },
        baselineColor: '#cbd5e1',
        gridlines: { color: 'transparent' },
        ticks: categoryTicks,
        slantedText: false
      },
      vAxis: useNativeAxis ? {
        textStyle: { color: labelColor, fontSize: 12, fontWeight: 600 },
        baselineColor: majorColor,
        gridlines: { color: majorColor, count: gridlineCount },
        minorGridlines: { color: minorColor, count: minorGridlineCount },
        viewWindow: axisViewWindowMax === undefined ? { min: axisViewWindowMin } : { min: axisViewWindowMin, max: axisViewWindowMax },
        viewWindowMode: axisTicks ? 'explicit' : 'pretty',
        ticks: axisDisplayTicks,
        format: axisFormat,
        textPosition: 'out'
      } : {
        textStyle: { color: 'transparent', fontSize: 12 },
        baselineColor: 'transparent',
        gridlines: { color: 'transparent', count: gridlineCount },
        minorGridlines: { color: 'transparent', count: minorGridlineCount },
        viewWindow: viewWindowMax === undefined ? { min: 0 } : { min: 0, max: viewWindowMax },
        viewWindowMode: ticks ? 'explicit' : 'pretty',
        ticks: ticks,
        format: axisFormat,
        textPosition: 'out'
      },
      annotations: isOverlay ? {
        textStyle: { color: 'transparent' },
        alwaysOutside: true,
        stem: { length: 0, color: 'transparent' }
      } : {
        textStyle: {
          color: '#0f172a',
          fontSize: 15,
          bold: true,
          auraColor: 'transparent',
          fontName: 'Tiresias Infofont, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        },
        alwaysOutside: true,
        stem: { length: 0, color: 'transparent' }
      },
      bar: { groupWidth: '55%' },
      animation: config.overlayAnnotations ? null : {
        startup: true,
        duration: 320,
        easing: 'out'
      },
      enableInteractivity: false,
      tooltip: { trigger: 'none' }
    };

    var chart = new global.google.visualization.ColumnChart(config.container);
    global.google.visualization.events.addListener(chart, 'ready', function () {
      var labels = rows.map(function (row) {
        return row.annotation || (formatValue(getRowTotal(row)) + (unitShort ? ' ' + unitShort : ''));
      });
      var colors = rows.map(function (row) { return getRowAnnotationColor(row, MiniColors.eco); });

      var applyAnnotations = function () {
        if (config.overlayAnnotations) {
          removeNativeAnnotations(config.container);
          if (config.overlayMode === 'stacked-style') {
            renderStackedStyleAnnotations(chart, config.container, rows, unitShort);
          } else if (config.overlayMode === 'rects') {
            renderOverlayFromRects(config.container, rows, unitShort);
          } else {
            renderOverlayAnnotations(chart, config.container, rows, unitShort);
          }
          return;
        }
        styleBarAnnotations(config.container, labels, colors);
      };

      var finalize = function () {
        var axisColors = { labelColor: labelColor, majorColor: majorColor, minorColor: minorColor, minorCount: minorGridlineCount };
        var layoutInterface = chart && chart.getChartLayoutInterface ? chart.getChartLayoutInterface() : null;
        var maxAxisWidth = styleAxes(config.container, axisColors, {
          labelFormatter: formatTickShort,
          axisTicks: labelTicks,
          layoutInterface: layoutInterface,
          fontSize: axisFontSize
        });
        if (!useNativeAxis) {
          renderCustomAxis(chart, config.container, ticks || [], axisColors);
        }
        applyAnnotations();
        if (config.overlayAnnotations) {
          removeNativeAnnotations(config.container);
        }
        try {
          var svg = config.container.querySelector('svg');
          var bbox = chart.getChartLayoutInterface && chart.getChartLayoutInterface().getChartAreaBoundingBox ? chart.getChartLayoutInterface().getChartAreaBoundingBox() : null;
          var axisNodes = svg ? Array.from(svg.querySelectorAll('text[text-anchor="end"]')) : [];
          var axisTexts = axisNodes.map(function (n) { return (n.textContent || '').trim(); }).filter(Boolean);
        } catch (e) {
          // axis debug muted
        }
        if (config.forceAnnotationColors && !config.overlayAnnotations) {
          var svg = config.container.querySelector('svg');
          if (svg) {
            if (svg.__annoObserver) {
              svg.__annoObserver.disconnect();
            }
            var obs = new MutationObserver(function () {
              applyAnnotations();
            });
            obs.observe(svg, { subtree: true, attributes: true, childList: true, characterData: true });
            svg.__annoObserver = obs;
          }
        }
      };

      global.requestAnimationFrame(function () {
        finalize();
        if (config.overlayAnnotations) {
          setTimeout(finalize, 240);
          setTimeout(finalize, 520);
        }
      });
    });
    chart.draw(dataTable, options);
    return chart;
  }

  global.EcoMiniCharts = {
    renderMiniBarChart: renderMiniBarChart,
    styleBarAnnotations: styleBarAnnotations,
    computePercentTrend: computePercentTrend,
    formatValue: formatValue,
    getUnitShort: getUnitShort
  };
})(window);
