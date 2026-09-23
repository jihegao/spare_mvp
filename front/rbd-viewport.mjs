export const RBD_MIN_ZOOM = 0.1;
export const RBD_MAX_ZOOM = 4;
export const rbdViewportSessionState = new Map();

const VIEWPORT_SELECTOR = "[data-rbd-viewport]";
const STAGE_SELECTOR = "[data-rbd-viewport-stage]";
const CONTENT_SELECTOR = "[data-rbd-viewport-content]";
const ACTION_SELECTOR = "[data-rbd-zoom-action]";
const VALUE_SELECTOR = "[data-rbd-zoom-value]";

export function clampRbdZoom(value, { minZoom = RBD_MIN_ZOOM, maxZoom = RBD_MAX_ZOOM } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(maxZoom, Math.max(minZoom, numeric));
}

export function rbdZoomAroundPoint({
  zoom,
  nextZoom,
  scrollLeft = 0,
  scrollTop = 0,
  pointX = 0,
  pointY = 0
}) {
  const current = Number(zoom) > 0 ? Number(zoom) : 1;
  const next = Number(nextZoom) > 0 ? Number(nextZoom) : current;
  const ratio = next / current;
  return {
    scrollLeft: Math.max(0, (Number(scrollLeft) + Number(pointX)) * ratio - Number(pointX)),
    scrollTop: Math.max(0, (Number(scrollTop) + Number(pointY)) * ratio - Number(pointY))
  };
}

export function attachRbdViewportController(root, {
  stateKey = "default",
  stateStore = rbdViewportSessionState,
  minZoom = RBD_MIN_ZOOM,
  maxZoom = RBD_MAX_ZOOM,
  zoomStep = 0.1,
  fitPadding = 24
} = {}) {
  if (!root || typeof root.querySelector !== "function") {
    throw new TypeError("RBD viewport root must be a DOM element");
  }
  const key = String(stateKey || "default");
  const restored = stateStore.get(key) || {};
  let zoom = clampRbdZoom(restored.zoom ?? 1, { minZoom, maxZoom });
  let destroyed = false;
  const measuredSizes = new WeakMap();

  function elements() {
    const viewport = root.querySelector(VIEWPORT_SELECTOR);
    const stage = viewport?.querySelector?.(STAGE_SELECTOR) || null;
    const content = stage?.querySelector?.(CONTENT_SELECTOR) || null;
    return { viewport, stage, content };
  }

  function persist(viewport = elements().viewport) {
    stateStore.set(key, {
      zoom,
      scrollLeft: Math.max(0, Number(viewport?.scrollLeft) || 0),
      scrollTop: Math.max(0, Number(viewport?.scrollTop) || 0)
    });
  }

  function measure(content) {
    if (measuredSizes.has(content)) return measuredSizes.get(content);
    const svg = content.matches?.("svg") ? content : content.querySelector?.("svg");
    const viewBox = svg?.viewBox?.baseVal;
    const width = positiveNumber(content.dataset?.rbdContentWidth)
      ?? positiveNumber(viewBox?.width)
      ?? positiveNumber(content.scrollWidth)
      ?? positiveNumber(content.offsetWidth)
      ?? positiveNumber(content.getBoundingClientRect?.().width)
      ?? 1;
    const height = positiveNumber(content.dataset?.rbdContentHeight)
      ?? positiveNumber(viewBox?.height)
      ?? positiveNumber(content.scrollHeight)
      ?? positiveNumber(content.offsetHeight)
      ?? positiveNumber(content.getBoundingClientRect?.().height)
      ?? 1;
    const size = { width, height };
    measuredSizes.set(content, size);
    return size;
  }

  function apply({ restoreScroll = false } = {}) {
    if (destroyed) return;
    const { viewport, stage, content } = elements();
    if (!viewport || !stage || !content) return;
    const size = measure(content);
    content.style.transformOrigin = "top left";
    content.style.transform = `scale(${zoom})`;
    stage.style.width = `${size.width * zoom}px`;
    stage.style.height = `${size.height * zoom}px`;
    root.querySelectorAll?.(VALUE_SELECTOR).forEach((node) => {
      node.textContent = `${Math.round(zoom * 100)}%`;
    });
    if (restoreScroll) {
      const state = stateStore.get(key) || {};
      viewport.scrollLeft = Math.max(0, Number(state.scrollLeft) || 0);
      viewport.scrollTop = Math.max(0, Number(state.scrollTop) || 0);
    }
    persist(viewport);
  }

  function setZoom(value, { clientX = null, clientY = null, resetScroll = false } = {}) {
    const { viewport } = elements();
    if (!viewport) return zoom;
    const nextZoom = clampRbdZoom(value, { minZoom, maxZoom });
    const rect = viewport.getBoundingClientRect?.() || { left: 0, top: 0 };
    const pointX = clientX === null ? viewport.clientWidth / 2 : Number(clientX) - Number(rect.left || 0);
    const pointY = clientY === null ? viewport.clientHeight / 2 : Number(clientY) - Number(rect.top || 0);
    const nextScroll = resetScroll
      ? { scrollLeft: 0, scrollTop: 0 }
      : rbdZoomAroundPoint({
        zoom,
        nextZoom,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        pointX,
        pointY
      });
    zoom = nextZoom;
    apply();
    viewport.scrollLeft = nextScroll.scrollLeft;
    viewport.scrollTop = nextScroll.scrollTop;
    persist(viewport);
    return zoom;
  }

  function fit() {
    const { viewport, content } = elements();
    if (!viewport || !content) return zoom;
    const size = measure(content);
    const availableWidth = Math.max(1, Number(viewport.clientWidth) - fitPadding * 2);
    const availableHeight = Math.max(1, Number(viewport.clientHeight) - fitPadding * 2);
    return setZoom(Math.min(availableWidth / size.width, availableHeight / size.height), { resetScroll: true });
  }

  function onClick(event) {
    const control = event.target?.closest?.(ACTION_SELECTOR);
    if (!control || !root.contains?.(control)) return;
    const action = control.dataset?.rbdZoomAction;
    if (action === "in") setZoom(zoom + zoomStep);
    if (action === "out") setZoom(zoom - zoomStep);
    if (action === "reset") setZoom(1, { resetScroll: true });
    if (action === "fit") fit();
  }

  function onWheel(event) {
    const viewport = event.target?.closest?.(VIEWPORT_SELECTOR);
    if (!viewport || !root.contains?.(viewport)) return;
    event.preventDefault?.();
    const direction = Number(event.deltaY) < 0 ? 1 : -1;
    setZoom(zoom + direction * zoomStep, { clientX: event.clientX, clientY: event.clientY });
  }

  function onScroll(event) {
    if (event.target?.matches?.(VIEWPORT_SELECTOR)) persist(event.target);
  }

  root.addEventListener?.("click", onClick);
  root.addEventListener?.("wheel", onWheel, { passive: false });
  root.addEventListener?.("scroll", onScroll, true);
  apply({ restoreScroll: true });

  return {
    get zoom() { return zoom; },
    zoomIn: () => setZoom(zoom + zoomStep),
    zoomOut: () => setZoom(zoom - zoomStep),
    reset: () => setZoom(1, { resetScroll: true }),
    fit,
    setZoom,
    refresh: () => apply({ restoreScroll: true }),
    destroy() {
      if (destroyed) return;
      persist();
      destroyed = true;
      root.removeEventListener?.("click", onClick);
      root.removeEventListener?.("wheel", onWheel, { passive: false });
      root.removeEventListener?.("scroll", onScroll, true);
    }
  };
}

function positiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
