import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { enforceDefaultBusinessZoom, isPageZoomShortcut } from "../desktop/window-zoom.mjs";

class FakeWebContents extends EventEmitter {
  zoomLevels = [];

  setZoomLevel(level) {
    this.zoomLevels.push(level);
  }
}

function preventableEvent() {
  return {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

test("page zoom shortcuts cover keyboard zoom without blocking unrelated input", () => {
  assert.equal(isPageZoomShortcut({ control: true, key: "-", code: "Minus" }), true);
  assert.equal(isPageZoomShortcut({ control: true, shift: true, key: "+", code: "Equal" }), true);
  assert.equal(isPageZoomShortcut({ control: true, key: "0", code: "Digit0" }), true);
  assert.equal(isPageZoomShortcut({ control: true, key: "Subtract", code: "NumpadSubtract" }), true);
  assert.equal(isPageZoomShortcut({ meta: true, key: "=", code: "Equal" }), true);
  assert.equal(isPageZoomShortcut({ control: true, alt: true, key: "=", code: "Equal" }), false);
  assert.equal(isPageZoomShortcut({ control: true, key: "s", code: "KeyS" }), false);
  assert.equal(isPageZoomShortcut({ key: "-", code: "Minus" }), false);
});

test("business window always restores the Chromium origin zoom to 100 percent", () => {
  const contents = new FakeWebContents();
  enforceDefaultBusinessZoom(contents);

  contents.emit("did-navigate");
  contents.emit("did-finish-load");
  assert.deepEqual(contents.zoomLevels, [0, 0]);

  const wheelEvent = preventableEvent();
  contents.emit("zoom-changed", wheelEvent, "out");
  assert.equal(wheelEvent.prevented, true);
  assert.deepEqual(contents.zoomLevels, [0, 0, 0]);

  const shortcutEvent = preventableEvent();
  contents.emit("before-input-event", shortcutEvent, { control: true, key: "-", code: "Minus" });
  assert.equal(shortcutEvent.prevented, true);
  assert.deepEqual(contents.zoomLevels, [0, 0, 0, 0]);

  const unrelatedEvent = preventableEvent();
  contents.emit("before-input-event", unrelatedEvent, { control: true, key: "s", code: "KeyS" });
  assert.equal(unrelatedEvent.prevented, false);
  assert.deepEqual(contents.zoomLevels, [0, 0, 0, 0]);
});
