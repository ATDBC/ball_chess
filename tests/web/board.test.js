import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { renderBoard } from "../../web/board.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.textContent = "";
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  emit(type, event = {}) { for (const listener of this.listeners[type] || []) listener(event); }
}

function fixture() {
  const document = { createElementNS: (_namespace, tag) => new FakeElement(tag) };
  const container = new FakeElement("div");
  container.ownerDocument = document;
  return container;
}

function findAll(element, predicate, found = []) {
  if (predicate(element)) found.push(element);
  for (const child of element.children) findAll(child, predicate, found);
  return found;
}

test("SVG move previews submit only the selected legal action", () => {
  const container = fixture();
  const actions = [];
  renderBoard(container, createGame(), {
    legalActions: [{ type: "move", direction: "up" }],
    mode: "move",
    orientation: "h",
    interactive: true,
    onAction: (action) => actions.push(action)
  });
  const targets = findAll(container, (element) => element.attributes["data-action"]);
  assert.equal(targets.length, 1);
  targets[0].emit("click");
  assert.deepEqual(actions, [{ type: "move", direction: "up" }]);
});

test("wall previews use geometry and noninteractive boards register no handlers", () => {
  const container = fixture();
  const wall = { type: "place_wall", orientation: "h", x: 1, y: 2 };
  renderBoard(container, createGame(), {
    legalActions: [wall], mode: "wall", orientation: "h", interactive: false, onAction: () => assert.fail()
  });
  const targets = findAll(container, (element) => element.attributes["data-action"]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].listeners.click, undefined);
  const preview = findAll(targets[0], (element) => element.attributes.class === "wall-preview")[0];
  assert.equal(preview.attributes.width, "48");
  assert.equal(preview.attributes.height, "4.5");
});
