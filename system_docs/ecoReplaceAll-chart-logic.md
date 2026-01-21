# EcoReplaceAll Chart Logic

This note summarizes the chart logic used by the EcoReplaceAll page. The main references are
`EcoReplacesAll/embed.html` (middle PM stacked chart) and `EcoReplacesAll/mini-chart-renderer.js`
(mini charts). The details below focus on emission-unit scaling and the Y-axis max logic.

## Emission Unit Scaling (computeUnitScale)

Location: `EcoReplacesAll/embed.html` (`computeUnitScale`, `UNIT_SCALE_STEPS`, `UNIT_FALLBACKS`).

Purpose: keep values readable by promoting to smaller units when values are tiny.

Algorithm:
- Inspect the absolute max of the values passed in.
- Start with the pollutant's base unit (via `EmissionUnits` when available).
- While the scaled max stays below `0.01`, step to a smaller unit and multiply by 1000.
- Hard-coded steps (current):
  - `kilotonne` -> `tonne` -> `kg` -> `g` -> `mg` -> `µg`
  - `g-i-teq` -> `mg-i-teq` -> `µg-i-teq`
  - `kt-co2-equivalent` -> `t-co2-equivalent`
- Return:
  - `factor` (multiplier applied to all values),
  - `unitLabel` (plural label),
  - `unitShort` (abbreviation).

This is used by the PM stacked chart and any place that needs unit changes for small values.

## Y-Axis Max & Tick Logic (PM stacked chart)

Location: `EcoReplacesAll/embed.html` (`renderPmStackedChart`).

Input: `maxValue` is the max of the stacked column totals (after any unit scaling).

Rules:
- If max is `<= 0`, set `max = 2`.
- If `max < 5`, use a "nice decimals" step:
  - `roughStep = max / 4`
  - `magnitude = 10 ^ floor(log10(roughStep))`
  - choose `niceBase` from `{1, 2, 2.5, 5, 10}` based on the normalized step
  - `step = niceBase * magnitude`
  - `max = ceil(max / step) * step`
  - ticks are `0 .. max` in `step` increments (decimals allowed)
- If `5 <= max < 20`, use the next even integer.
- If `20 <= max < 100`, round up to the nearest 5.
- If `max >= 100`, round up to 2 significant digits
  (e.g., `4537` -> `4600`).

Ticks:
- For the decimal case, ticks are already computed from `step`.
- Otherwise, ticks are integers with a step chosen so the tick count is close to 5.

## Notes

- `formatBarValue` controls the displayed precision for labels (dynamic decimals).
- Mini charts have their own Y-axis logic in `EcoReplacesAll/mini-chart-renderer.js`.
