// Isolated CommonJS runtime avoids mixing Vitest's ESM Yjs constructor with
// the pinned CommonJS Lexical binding. No network, database or seeded data.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { JSDOM } = require("jsdom");
const dom = new JSDOM('<!doctype html><body><div id="test"></div></body>', { url: "http://localhost" });
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Node", "Text", "MutationObserver", "DocumentFragment", "DOMParser", "KeyboardEvent", "MouseEvent", "Event", "getComputedStyle"]) {
  if (dom.window[key]) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
const req = createRequire(resolve("packages/studio-react/package.json"));
const React = req("react");
const { createRoot } = req("react-dom/client");
const { act } = React;
const { LexicalComposer } = req("@lexical/react/LexicalComposer");
const { RichTextPlugin } = req("@lexical/react/LexicalRichTextPlugin");
const { ContentEditable } = req("@lexical/react/LexicalContentEditable");
const LexicalErrorBoundary = req("@lexical/react/LexicalErrorBoundary");
const { CollaborationPlugin } = req("@lexical/react/LexicalCollaborationPlugin");
const { Awareness } = req("y-protocols/awareness");
const Y = req("yjs");
const { createDefaultStudioDocument } = require(resolve("packages/studio-core/src/index.ts"));
let retained;
let activeDoc;
const live = [];
const providerFactory = (id, map) => {
  const doc = new Y.Doc(); activeDoc = doc; map.set(id, doc);
  const awareness = new Awareness(doc);
  const listeners = new Map();
  const emit = (event, ...args) => { for (const fn of listeners.get(event) || []) fn(...args); };
  const provider = { doc, awareness,
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    off(event, fn) { listeners.get(event)?.delete(fn); },
    connect() { if (retained) Y.applyUpdate(doc, retained, provider); emit("sync", true); },
    disconnect() {},
  };
  live.push({ doc, awareness });
  return provider;
};
const editor = text => React.createElement(LexicalComposer, { initialConfig: {
  namespace: "restore-boundary", editorState: null, onError: error => { throw error; },
} }, React.createElement(RichTextPlugin, { contentEditable: React.createElement(ContentEditable), placeholder: null, ErrorBoundary: LexicalErrorBoundary }),
React.createElement(CollaborationPlugin, { id: "same-post", providerFactory, shouldBootstrap: true,
  initialEditorState: JSON.stringify({ root: createDefaultStudioDocument(text).root }),
}));
(async () => {
  const target = document.getElementById("test");
  let root = createRoot(target);
  try {
    await act(async () => { root.render(editor("Existing collaborative content")); });
    assert.equal(target.textContent, "Existing collaborative content");
    retained = Y.encodeStateAsUpdate(activeDoc);
    await act(async () => { root.unmount(); });
    root = createRoot(target);
    await act(async () => { root.render(editor("Restored historical content")); });
    assert.equal(target.textContent, "Existing collaborative content");
    console.log(JSON.stringify({ before: "Existing collaborative content", after: target.textContent }));
  } finally {
    await act(async () => { root.unmount(); });
    for (const item of live) { item.awareness.destroy(); item.doc.destroy(); }
    dom.window.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
