/** Public Mill identity, shared by the widget and its admin preview. */
export const MILL_WEBSITE_URL = "https://mill.chat";
export const MILL_DIALOGUE_REAR_PATH =
  "M14 7V5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3v4l-2-2";
export const MILL_DIALOGUE_FRONT_PATH =
  "M6 10h13a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H9l-6 4V13a3 3 0 0 1 3-3Z";
export const MILL_DIALOGUE_MARK = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 34 34"><path d="${MILL_DIALOGUE_REAR_PATH}" fill="none" stroke="#142838" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="${MILL_DIALOGUE_FRONT_PATH}" fill="none" stroke="#1761df" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
)}`;
