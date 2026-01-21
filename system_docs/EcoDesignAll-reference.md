# EcoDesignAll Mini Chart Reference (WIP)

## Current mini-chart setup (as of v1-mini13)
- Renderer: `EcoReplacesAll/mini-chart-renderer.js` (Google Charts column chart wrapper) with `overlayAnnotations` enabled and `overlayMode: "stacked-style"`.
- Colors: Each row supplies a color (eco/fireplace/replacement). `forceAnnotationColors: true` recolors annotations per bar after draw. Labels use a white outline (stroke/paint-order) to keep legible on colored bars.
- Axis & gridlines: We keep Google’s native v-axis and gridlines (major). Minor gridlines are currently not shown. h-axis labels remain hidden.

## Embed page (EcoReplacesAll/embed.html)
- Uses `overlayAnnotations: true` + `overlayMode: "stacked-style"` to position labels above each bar via the chart layout interface.
- Annotation colors: per bar (eco/fireplace/replacement) with a white stroke/paint-order outline for legibility on the bar color. `forceAnnotationColors: true` ensures they stay tinted correctly.
- Native axis is on; major gridlines are visible. v-axis labels should be visible; if they disappear, check for CSS overrides.
- Minor gridlines are currently off to match the desired look.
- Labels are formatted values with the unit abbreviation from `EmissionUnits` (fallback to provided unit short).

## Debug page (EcoReplacesAll/mini-chart-debug.html)
- Mirrors embed: stacked-style overlay annotations, per-bar colors, native axis on.
- Debug currently shows major gridlines; minor gridlines are not displayed.
- v-axis labels should be visible; annotations use overlay styling rather than Google’s native annotation styling.

## Known gaps / follow-ups
- Confirm embed v-axis labels consistently render (no CSS hiding) and match debug.
- Decide whether minor gridlines should be enabled; currently they are not shown.
- Once final behaviour is locked, document the exact option set (ticks, viewWindow, gridline counts) and any CSS hooks.
