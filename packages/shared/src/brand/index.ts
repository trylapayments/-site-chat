/** Public Mill identity, shared by the widget and its admin preview. */
export const MILL_WEBSITE_URL = "https://mill.chat";
export const MILL_DIALOGUE_REAR_PATH =
  "M12 6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4v5l-4-4";
export const MILL_DIALOGUE_FRONT_PATH =
  "M6 9h12a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H9l-6 4v-6a4 4 0 0 1-2-3V13a4 4 0 0 1 5-4Z";
export const MILL_DIALOGUE_MARK = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 34 34"><path d="${MILL_DIALOGUE_REAR_PATH}" fill="none" stroke="#142838" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="${MILL_DIALOGUE_FRONT_PATH}" fill="none" stroke="#1761df" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
)}`;
