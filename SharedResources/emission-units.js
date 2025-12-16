(function initializeEmissionUnits(global) {
  if (global.EmissionUnits) {
    return;
  }

  function normalizeUnitLabel(label) {
    if (typeof label !== 'string') {
      return '';
    }
    return label
      .toLowerCase()
      .replace(/\u2082/g, '2')
      .replace(/co₂/g, 'co2')
      .replace(/[^a-z0-9()+/.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const UNIT_DEFINITIONS = [
    {
      key: 'kt-co2-equivalent',
      aliases: [
        'kt co2 equivalent',
        'kilotonne/kt co2 equivalent',
        'kt co2-equivalent',
        'kt co₂ equivalent',
        'kt co₂-equivalent'
      ],
      abbreviation: 'kt CO₂-e',
      singular: 'kilotonne CO₂-equivalent',
      plural: 'kilotonnes CO₂-equivalent',
      axisLabel: 'kilotonnes CO₂-equivalent',
      conversionFactor: 1000000
    },
    {
      key: 'tj-net',
      aliases: ['tj (net)', 'tj net', 'terajoule (net)', 'terajoules (net)', 'tj'],
      abbreviation: 'TJ (net)',
      singular: 'terajoule (net)',
      plural: 'terajoules (net)',
      axisLabel: 'TJ'
    },
    {
      key: 'kg',
      aliases: ['kg', 'kilogram', 'kilograms'],
      abbreviation: 'kg',
      singular: 'kilogram',
      plural: 'kilograms',
      axisLabel: 'kilograms',
      conversionFactor: 1
    },
    {
      key: 'g-i-teq',
      aliases: [
        'grams international toxic equivalent',
        'g i-teq',
        'g i-teq (or g i-teq)'
      ],
      abbreviation: 'g I-TEQ',
      singular: 'gram International Toxic Equivalent',
      plural: 'grams International Toxic Equivalent',
      axisLabel: 'grams International Toxic Equivalent',
      conversionFactor: 1000
    },
    {
      key: 'kilotonne',
      aliases: ['kilotonne', 'kilotonnes', 'kt'],
      abbreviation: 'kt',
      singular: 'kilotonne',
      plural: 'kilotonnes',
      axisLabel: 'kilotonnes',
      conversionFactor: 1000000
    },
    {
      key: 'tonne',
      aliases: ['t', 'tonne', 'tonnes'],
      abbreviation: 't',
      singular: 'tonne',
      plural: 'tonnes',
      axisLabel: 'tonnes',
      conversionFactor: 1000
    }
  ].map(def => Object.freeze({ ...def, __isEmissionUnit: true }));

  const unitLookup = new Map();
  UNIT_DEFINITIONS.forEach(def => {
    def.aliases.forEach(alias => {
      unitLookup.set(normalizeUnitLabel(alias), def);
    });
  });

  const DEFAULT_CONVERSION_FACTOR = 1000000;

  function coerceMeta(unit) {
    if (!unit) {
      return null;
    }
    if (typeof unit === 'object' && unit.__isEmissionUnit) {
      return unit;
    }
    return getUnitMeta(unit);
  }

  function getUnitMeta(label) {
    const normalized = normalizeUnitLabel(label);
    if (normalized && unitLookup.has(normalized)) {
      return unitLookup.get(normalized);
    }
    if (label) {
      console.warn(`[EmissionUnits] Unmapped unit label "${label}"`);
    }
    return null;
  }

  function useSingular(value) {
    if (!Number.isFinite(value)) {
      return false;
    }
    return Math.abs(Math.abs(value) - 1) < 1e-9;
  }

  function formatValueLabel(unit, value, { context = 'value' } = {}) {
    const meta = coerceMeta(unit);
    if (!meta) {
      return '';
    }

    const isActivityUnit = meta.key === 'tj-net';

    if (context === 'axis') {
      return meta.axisLabel || meta.plural || meta.singular || '';
    }

    if (context === 'calc') {
      if (isActivityUnit) {
        return 'TJ';
      }
      return meta.abbreviation || meta.plural || meta.singular || '';
    }

    if (context === 'abbreviation') {
      return meta.abbreviation || meta.plural || meta.singular || '';
    }

    if (isActivityUnit) {
      // Value displays for activity data retain the (net) suffix, while
      // other contexts (axis/calc) strip it per brief.
      return 'TJ (net)';
    }

    const singularPreferred = useSingular(value);
    if (singularPreferred && meta.singular) {
      return meta.singular;
    }
    return meta.plural || meta.singular || '';
  }

  function formatAxisLabel(unit) {
    return formatValueLabel(unit, null, { context: 'axis' });
  }

  function formatCalcLabel(unit) {
    return formatValueLabel(unit, null, { context: 'calc' });
  }

  function formatAbbreviation(unit) {
    return formatValueLabel(unit, null, { context: 'abbreviation' });
  }

  function formatValueParts(unit, value, options = {}) {
    const label = formatValueLabel(unit, value, options);
    return {
      unitText: label,
      hasUnit: Boolean(label)
    };
  }

  function getConversionFactor(unit) {
    const meta = coerceMeta(unit);
    if (meta && typeof meta.conversionFactor === 'number') {
      return meta.conversionFactor;
    }
    return DEFAULT_CONVERSION_FACTOR;
  }

  function isActivityUnit(unit) {
    return coerceMeta(unit)?.key === 'tj-net';
  }

  global.EmissionUnits = {
    normalizeUnitLabel,
    getUnitMeta,
    formatValueLabel,
    formatAxisLabel,
    formatCalcLabel,
    formatAbbreviation,
    formatValueParts,
    getConversionFactor,
    isActivityUnit
  };
})(window);
