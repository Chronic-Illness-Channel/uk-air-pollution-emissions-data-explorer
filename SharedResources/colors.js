/**
 * Shared Color Palette Module
 * Provides consistent color assignment across NAEI data viewers
 */

// Distinct color palette for up to 10 series
const distinctPalette = [
  '#E6194B', // Red
  '#911EB4', // Purple
  '#4363D8', // Blue
  '#F58231', // Orange
  '#FFE119', // Yellow
  '#3CB44B', // Green
  '#46F0F0', // Cyan
  '#F032E6', // Magenta
  '#BCF60C', // Lime
  '#FABEBE'  // Pink
];

// Category-based color preferences
const categoryBaseColor = {
  ecodesign: distinctPalette[4],  // Orange
  fireplace: distinctPalette[0],  // Red
  gas: distinctPalette[3],        // Blue
  power: distinctPalette[1],      // Green
  road: distinctPalette[6]        // Cyan
};

// Color assignment state
let colorCache = {};
let availableColors = [...distinctPalette];

/**
 * Reset the color assignment system
 */
function resetColorSystem() {
  colorCache = {};
  availableColors = [...distinctPalette];
}

/**
 * Get a consistent color for a category/series name
 * @param {string} name - Category or series name
 * @returns {string} Hex color code
 */
function getColorForCategory(name) {
  if (!name) return '#888888';
  if (colorCache[name]) return colorCache[name];

  const lower = name.toLowerCase();
  const cat = Object.keys(categoryBaseColor).find(c => lower.includes(c));

  // Prefer category color if available
  let baseColor = cat ? categoryBaseColor[cat] : null;
  let chosenColor = baseColor;

  // Avoid duplicates: if base color already used, pick next available
  if (!chosenColor || Object.values(colorCache).includes(chosenColor)) {
    chosenColor = availableColors.find(c => !Object.values(colorCache).includes(c));
  }

  // Fallback to any color if palette exhausted (shouldn't happen with ≤10)
  if (!chosenColor) {
    chosenColor = distinctPalette[Object.keys(colorCache).length % distinctPalette.length];
  }

  colorCache[name] = chosenColor;
  return chosenColor;
}

/**
 * Get the current color cache
 * @returns {Object} Map of names to colors
 */
function getColorCache() {
  return { ...colorCache };
}

/**
 * Set a specific color for a name
 * @param {string} name - Category or series name
 * @param {string} color - Hex color code
 */
function setColorForCategory(name, color) {
  colorCache[name] = color;
}

// Export color functions and constants
window.Colors = {
  distinctPalette,
  categoryBaseColor,
  resetColorSystem,
  getColorForCategory,
  getColorCache,
  setColorForCategory
};
