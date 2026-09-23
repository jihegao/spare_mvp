const PAGE_ZOOM_KEYS = new Set(["+", "-", "=", "0"]);
const PAGE_ZOOM_CODES = new Set([
  "Equal",
  "Minus",
  "Digit0",
  "NumpadAdd",
  "NumpadSubtract",
  "Numpad0",
]);

export function isPageZoomShortcut(input = {}) {
  if ((!input.control && !input.meta) || input.alt) return false;
  return PAGE_ZOOM_KEYS.has(String(input.key || ""))
    || PAGE_ZOOM_CODES.has(String(input.code || ""));
}

export function enforceDefaultBusinessZoom(contents) {
  const resetZoom = () => contents.setZoomLevel(0);

  // Chromium persists zoom by origin. Reset after navigation so an old
  // 127.0.0.1 preference cannot shrink a newly installed package.
  contents.on("did-navigate", resetZoom);
  contents.on("did-finish-load", resetZoom);
  contents.on("zoom-changed", (event) => {
    event.preventDefault();
    resetZoom();
  });
  contents.on("before-input-event", (event, input) => {
    if (!isPageZoomShortcut(input)) return;
    event.preventDefault();
    resetZoom();
  });
}
