# Chart Colour Assignment Logic
*Version 1.0 – December 2025*

This document captures the exact rules the 2 charts use to pick colours for each selected category. The logic now lives in the shared `SharedResources/colors.js` module, which both `bubblechart/main.js` and `linechart/main.js` load and reset before drawing. Because they consume the same module, any changes in the shared file automatically affect both charts.

## Palette and keywords
- Base palette (`distinctPalette`) contains ten hex colours in a fixed order: Red, Green, Yellow, Blue, Orange, Purple, Cyan, Magenta, Lime, Pink.
- Keyword-to-base-colour map (`categoryBaseColor`):
  - Names containing `ecodesign` → Orange (`#F58231`).
  - Names containing `fireplace` → Red (`#E42020`).
  - Names containing `gas` → Blue (`#4363D8`).
  - Names containing `power` → Green (`#3CB44B`).
  - Names containing `road` → Cyan (`#46F0F0`).

## Stove/fireplace safeguards
- Any category name containing one of `stove`, `fireplace`, `chiminea`, `fire pit`, `fire-pit`, or `bonfire` is flagged as a stove/fireplace category.
- These flagged categories are not allowed to use either of the two green shades (`#3CB44B`, `#BCF60C`). If their preferred base colour would be one of those greens, the logic discards it and falls back to the general picker.

## Assignment flow (`getColorForCategory`)
1. Lower-case the category name and check the keyword map for a preferred base colour.
2. If the name has a stove/fireplace token, remember that we must avoid the restricted greens.
3. If the preferred colour is already assigned to a different category (the cache stores every previous assignment), treat it as unavailable.
4. Choose the next available colour:
   - Start with the palette order.
   - Skip any colour that is already assigned.
   - If the category is stove/fireplace, also skip the restricted greens.
   - If all filtered colours are gone, recycle the first unassigned palette entry; if the entire palette is already in use, wrap around using `(cache size) % palette length`.
5. Cache the chosen colour so subsequent calls for the same category reuse it.

## Reset and draw order
- `window.Colors.resetColorSystem()` clears the cache and restores the palette order.
- `drawChart()` (in `bubblechart/main.js`) now resets the colour system every time the chart renders, then walks the currently selected categories from top to bottom and calls `getColorForCategory()` to pre-assign colours in UI order before any drawing occurs. This guarantees deterministic colours that follow the list order the user sees.
- Any action that changes the selected categories (dropdown changes, compare toggles, etc.) triggers `updateChart()`, which calls `drawChart()`, so the reset happens automatically.

## Summary of guarantees
- Categories mentioning “Ecodesign” always *attempt* to take orange; they only lose it if another Ecodesign category already locked it earlier in the current selection order.
- Stove/fireplace categories never receive either green shade, even if their keyword map would normally point to green.
- The first category in the visible selector uses its preferred colour (orange for Ecodesign) so long as the keyword rules allow it; following categories take the next free palette entries, producing stable, predictable colouring across renders.

