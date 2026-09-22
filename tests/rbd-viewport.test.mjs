import assert from "node:assert/strict";
import test from "node:test";

import {
  attachRbdViewportController,
  clampRbdZoom,
  rbdZoomAroundPoint
} from "../front/rbd-viewport.mjs";

test("RBD zoom clamps to 10%-400% and keeps the pointed content coordinate stationary", () => {
  assert.equal(clampRbdZoom(0), 0.1);
  assert.equal(clampRbdZoom(10), 4);
  assert.equal(clampRbdZoom("invalid"), 1);
  assert.deepEqual(rbdZoomAroundPoint({
    zoom: 1,
    nextZoom: 2,
    scrollLeft: 100,
    scrollTop: 50,
    pointX: 250,
    pointY: 150
  }), { scrollLeft: 450, scrollTop: 250 });
});

test("RBD viewport controller scales its stage, fits content, and restores session state", () => {
  const stateStore = new Map();
  const first = fakeRbdDom();
  const controller = attachRbdViewportController(first.root, { stateKey: "aircraft:a", stateStore });
  first.viewport.scrollLeft = 100;
  first.viewport.scrollTop = 50;

  controller.setZoom(2, { clientX: 250, clientY: 150 });
  assert.equal(controller.zoom, 2);
  assert.equal(first.content.style.transform, "scale(2)");
  assert.equal(first.stage.style.width, "2000px");
  assert.equal(first.stage.style.height, "1000px");
  assert.equal(first.viewport.scrollLeft, 450);
  assert.equal(first.viewport.scrollTop, 250);
  assert.equal(first.label.textContent, "200%");

  controller.fit();
  assert.equal(controller.zoom, 0.452);
  assert.equal(first.viewport.scrollLeft, 0);
  assert.equal(first.viewport.scrollTop, 0);
  controller.setZoom(1.5);
  first.viewport.scrollLeft = 123;
  first.viewport.scrollTop = 45;
  first.root.dispatch("scroll", { target: first.viewport });
  controller.destroy();

  const second = fakeRbdDom();
  const restored = attachRbdViewportController(second.root, { stateKey: "aircraft:a", stateStore });
  assert.equal(restored.zoom, 1.5);
  assert.equal(second.viewport.scrollLeft, 123);
  assert.equal(second.viewport.scrollTop, 45);
  assert.equal(second.label.textContent, "150%");
  restored.destroy();
});

test("RBD delegated controls and wheel only act for the owned viewport", () => {
  const dom = fakeRbdDom();
  const controller = attachRbdViewportController(dom.root, { stateStore: new Map() });
  const zoomIn = fakeControl("in");
  dom.root.dispatch("click", { target: zoomIn });
  assert.equal(controller.zoom, 1.1);

  let prevented = false;
  dom.root.dispatch("wheel", {
    target: { closest: (selector) => selector === "[data-rbd-viewport]" ? dom.viewport : null },
    deltaY: -1,
    clientX: 100,
    clientY: 100,
    preventDefault() { prevented = true; }
  });
  assert.ok(Math.abs(controller.zoom - 1.2) < 1e-12);
  assert.equal(prevented, true);
  controller.destroy();
});

function fakeRbdDom() {
  const content = fakeElement();
  content.dataset = { rbdContentWidth: "1000", rbdContentHeight: "500" };
  content.matches = () => false;
  const stage = fakeElement();
  stage.querySelector = (selector) => selector === "[data-rbd-viewport-content]" ? content : null;
  const viewport = fakeElement();
  viewport.clientWidth = 500;
  viewport.clientHeight = 300;
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  viewport.matches = (selector) => selector === "[data-rbd-viewport]";
  viewport.querySelector = (selector) => selector === "[data-rbd-viewport-stage]" ? stage : null;
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const label = fakeElement();
  const listeners = new Map();
  const root = fakeElement();
  root.querySelector = (selector) => selector === "[data-rbd-viewport]" ? viewport : null;
  root.querySelectorAll = (selector) => selector === "[data-rbd-zoom-value]" ? [label] : [];
  root.contains = (node) => node === viewport || Boolean(node?.dataset?.rbdZoomAction);
  root.addEventListener = (type, listener) => listeners.set(type, listener);
  root.removeEventListener = (type, listener) => {
    if (listeners.get(type) === listener) listeners.delete(type);
  };
  root.dispatch = (type, event) => listeners.get(type)?.(event);
  return { root, viewport, stage, content, label };
}

function fakeElement() {
  return { dataset: {}, style: {}, textContent: "" };
}

function fakeControl(action) {
  const control = fakeElement();
  control.dataset.rbdZoomAction = action;
  control.closest = (selector) => selector === "[data-rbd-zoom-action]" ? control : null;
  return control;
}
