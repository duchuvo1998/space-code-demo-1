import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "courses/canva-gemini/manifest.json");
const BRIDGE_PATH = path.join(ROOT, "assets/course/iframe-bridge.js");

test("all manifest lessons exist, sync notes before completion, and include prompt blocks", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(manifest.lessons.length, 56);

  for (const lesson of manifest.lessons) {
    const lessonPath = path.join(ROOT, "courses/canva-gemini", lesson.src);
    assert.equal(fs.existsSync(lessonPath), true, `Missing lesson file: ${lesson.src}`);
    const html = fs.readFileSync(lessonPath, "utf8");

    assert.match(html, new RegExp(`data-lesson-id="${lesson.id}"`));
    for (const checkId of lesson.checklistIds || []) {
      assert.equal(html.includes(`"id":"${checkId}"`), true, `Missing checklist ID ${checkId} in ${lesson.id}`);
    }

    // Ensure typing notes updates current.notes before clicking complete so notes are never wiped.
    assert.equal(html.includes("function syncNotes(){current.notes=notes.value;send();}"), true, `${lesson.id} missing syncNotes`);
    assert.equal(html.includes('notes.addEventListener("input",syncNotes);'), true, `${lesson.id} missing input syncNotes`);
    assert.equal(html.includes('notes.addEventListener("change",syncNotes);'), true, `${lesson.id} missing change syncNotes`);
    assert.equal(html.includes('notes.addEventListener("compositionend",syncNotes);'), true, `${lesson.id} missing compositionend syncNotes`);
    assert.equal(html.includes("complete.addEventListener(\"click\",function(){\n        current.notes=notes.value;"), true, `${lesson.id} missing complete notes sync`);

    // Ensure prompt boxes exist with <pre> elements so iframe-bridge adds copy buttons.
    assert.match(html, /<div class="prompt-box">[\s\S]*?<pre>[\s\S]*?<\/pre>/, `${lesson.id} missing prompt-box <pre>`);
  }
});

test("iframe-bridge adds prompt copy buttons, notes status, height shrinking, and ready handshake", async () => {
  const bridgeSource = fs.readFileSync(BRIDGE_PATH, "utf8");
  const postedMessages = [];
  const windowListeners = new Map();
  const docListeners = new Map();
  let clipboardText = "";

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.className = "";
      this.id = "";
      this.textContent = "";
      this.innerHTML = "";
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
      this._rect = { bottom: 600, height: 600, width: 800 };
      this.classList = {
        add: (...names) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          names.forEach(name => set.add(name));
          this.className = [...set].join(" ");
        },
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          const shouldHave = force === undefined ? !set.has(name) : Boolean(force);
          if (shouldHave) set.add(name);
          else set.delete(name);
          this.className = [...set].join(" ");
          return shouldHave;
        }
      };
    }

    get firstElementChild() {
      return this.children[0] || null;
    }

    get previousElementSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.children.indexOf(this);
      return idx > 0 ? this.parentNode.children[idx - 1] : null;
    }

    appendChild(child) {
      if (child.parentNode) {
        const idx = child.parentNode.children.indexOf(child);
        if (idx >= 0) child.parentNode.children.splice(idx, 1);
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    insertBefore(newChild, refChild) {
      if (newChild.parentNode) {
        const oldIdx = newChild.parentNode.children.indexOf(newChild);
        if (oldIdx >= 0) newChild.parentNode.children.splice(oldIdx, 1);
      }
      newChild.parentNode = this;
      const idx = this.children.indexOf(refChild);
      if (idx < 0) this.children.push(newChild);
      else this.children.splice(idx, 0, newChild);
      return newChild;
    }

    remove() {
      if (!this.parentNode) return;
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }

    async trigger(type, event = {}) {
      for (const fn of this.listeners.get(type) || []) {
        await fn(event);
      }
    }

    getBoundingClientRect() {
      return this._rect;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const results = [];
      const matches = el => {
        if (selector.startsWith(".")) return el.classList.contains(selector.slice(1));
        if (selector.startsWith("#")) return el.id === selector.slice(1);
        return el.tagName === selector.toUpperCase();
      };
      const walk = node => {
        for (const child of node.children) {
          if (matches(child)) results.push(child);
          walk(child);
        }
      };
      walk(this);
      return results;
    }
  }

  const body = new FakeElement("body");
  body._rect = { bottom: 1200, height: 1200, width: 900 };
  const promptCard = new FakeElement("section");
  promptCard._rect = { bottom: 1180, height: 400, width: 880 };
  const promptBox = new FakeElement("div");
  promptBox.className = "prompt-box";
  const promptTitle = new FakeElement("strong");
  promptTitle.textContent = "Prompt 1";
  const promptPre = new FakeElement("pre");
  promptPre.textContent = "Viết Creative Brief 3 lớp chữ cho poster 1080x1080";
  promptBox.appendChild(promptTitle);
  promptBox.appendChild(promptPre);
  promptCard.appendChild(promptBox);

  const notesCard = new FakeElement("section");
  notesCard._rect = { bottom: 1190, height: 300, width: 880 };
  const notesHeading = new FakeElement("h3");
  notesHeading.textContent = "Ghi chú cá nhân";
  const notesArea = new FakeElement("textarea");
  notesArea.id = "lessonNotes";
  notesCard.appendChild(notesHeading);
  notesCard.appendChild(notesArea);

  body.appendChild(promptCard);
  body.appendChild(notesCard);

  const documentMock = {
    readyState: "complete",
    documentElement: { dataset: { lessonId: "w1-d1" } },
    body,
    createElement: tag => new FakeElement(tag),
    getElementById: id => body.querySelector(`#${id}`),
    querySelectorAll: sel => body.querySelectorAll(sel),
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    }
  };

  const parentWindow = {
    postMessage: (msg, origin) => postedMessages.push({ msg, origin })
  };

  const windowMock = {
    parent: parentWindow,
    location: { origin: "http://localhost:4173" },
    scrollY: 0,
    getComputedStyle: () => ({ paddingBottom: "18", marginTop: "0", marginBottom: "0" }),
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    dispatchEvent: event => {
      for (const fn of windowListeners.get(event.type) || []) fn(event);
    }
  };

  const context = vm.createContext({
    window: windowMock,
    document: documentMock,
    navigator: {
      clipboard: {
        writeText: async text => { clipboardText = text; }
      }
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    requestAnimationFrame: fn => fn(),
    setTimeout: fn => { fn(); return 1; },
    clearTimeout: () => {}
  });

  vm.runInContext(bridgeSource, context);

  // 1. Copy button added to prompt box and copies exact prompt text.
  const copyBtn = promptBox.querySelector(".prompt-copy-btn");
  assert.ok(copyBtn, "Expected copy button inside .prompt-box");
  await copyBtn.trigger("click");
  assert.equal(clipboardText, "Viết Creative Brief 3 lớp chữ cho poster 1080x1080");
  assert.equal(
    postedMessages.some(entry => entry.msg.type === "LESSON_COPY_PROMPT" && entry.msg.copied === true),
    true
  );

  // 2. Notes status header added and responds to save status messages.
  const notesStatus = documentMock.getElementById("lessonNotesStatus");
  assert.ok(notesStatus, "Expected inline notes status indicator");
  windowMock.IframeProgressBridge.sendProgress({ notes: "My saved note" });
  assert.equal(notesStatus.dataset.state, "saving");

  for (const fn of windowListeners.get("message") || []) {
    fn({
      source: parentWindow,
      origin: "http://localhost:4173",
      data: { type: "LESSON_SAVE_STATUS", lessonId: "w1-d1", status: "saved" }
    });
  }
  assert.equal(notesStatus.dataset.state, "saved");

  // 3. LESSON_READY handshake was emitted.
  assert.equal(
    postedMessages.some(entry => entry.msg.type === "LESSON_READY" && entry.msg.lessonId === "w1-d1"),
    true
  );

  // 4. Height measurement shrinks cleanly when window expands to full screen.
  const resizeMessages = () => postedMessages.filter(entry => entry.msg.type === "LESSON_RESIZE");
  const initialHeight = resizeMessages().at(-1).msg.height;
  body._rect = { bottom: 800, height: 800, width: 1440 };
  promptCard._rect = { bottom: 500, height: 300, width: 880 };
  notesCard._rect = { bottom: 780, height: 220, width: 880 };
  windowMock.IframeProgressBridge.reportHeight();
  const shrunkHeight = resizeMessages().at(-1).msg.height;
  assert.ok(shrunkHeight < initialHeight, `Expected shrunk height (${shrunkHeight}) < initial (${initialHeight})`);
});

test("lesson inline script preserves typed notes when toggling lesson completion", () => {
  const html = fs.readFileSync(path.join(ROOT, "courses/canva-gemini/lessons/w1-d1.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 2);

  const sentPayloads = [];
  const checklistEl = {
    innerHTML: "",
    listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    querySelectorAll: () => []
  };
  const notesEl = {
    value: "",
    listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); }
  };
  const completeEl = {
    textContent: "",
    className: "",
    listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); }
  };
  const windowListeners = new Map();
  const windowMock = {
    IframeProgressBridge: {
      sendProgress: payload => sentPayloads.push(payload)
    },
    addEventListener(type, fn) {
      windowListeners.set(type, fn);
    }
  };
  const documentMock = {
    getElementById(id) {
      if (id === "checklist") return checklistEl;
      if (id === "lessonNotes") return notesEl;
      if (id === "completeLesson") return completeEl;
      return null;
    }
  };

  const context = vm.createContext({
    window: windowMock,
    document: documentMock,
    Date
  });
  vm.runInContext(scripts[0] + "\n" + scripts[1], context);

  // Simulate user typing notes, then clicking "Hoàn thành bài học".
  notesEl.value = "Ghi chú quan trọng cho bài 1";
  notesEl.listeners.get("input")();
  assert.equal(sentPayloads.at(-1).notes, "Ghi chú quan trọng cho bài 1");

  completeEl.listeners.get("click")();
  assert.equal(notesEl.value, "Ghi chú quan trọng cho bài 1");
  assert.equal(sentPayloads.at(-1).notes, "Ghi chú quan trọng cho bài 1");
  assert.equal(sentPayloads.at(-1).completed, true);

  // Simulate reload hydration via lesson-progress-load.
  notesEl.value = "";
  windowListeners.get("lesson-progress-load")({
    detail: { checklist: {}, notes: "Ghi chú quan trọng cho bài 1", completed: true, date: "2026-11-27" }
  });
  assert.equal(notesEl.value, "Ghi chú quan trọng cho bài 1");
});

test("course-views scrolls to top on lesson navigation and keeps sandbox + clipboard allow", async () => {
  const { createCourseViews } = await import("../assets/course/course-views.mjs");

  const scrollCalls = [];
  const frameMessages = [];
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalFetch = globalThis.fetch;
  const originalRAF = globalThis.requestAnimationFrame;

  const makeEl = () => ({
    innerHTML: "",
    className: "",
    title: "",
    dataset: {},
    style: {},
    attributes: new Map(),
    listeners: new Map(),
    children: [],
    setAttribute(k, v) { this.attributes.set(k, v); },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    querySelector(selector) {
      if (selector === ".lesson-shell" || selector === ".lesson-frame-wrap") return this;
      return null;
    },
    querySelectorAll: () => []
  });

  const appEl = makeEl();
  const sidebarEl = makeEl();
  const createdFrames = [];

  globalThis.location = { hash: "#course/canva-gemini/lesson/w1-d2", origin: "http://localhost:4173" };
  globalThis.requestAnimationFrame = fn => fn();
  globalThis.fetch = async () => ({ ok: true });
  globalThis.window = {
    scrollY: 1800,
    location: globalThis.location,
    scrollTo: opts => {
      scrollCalls.push(opts);
      globalThis.window.scrollY = opts?.top ?? 0;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false })
  };
  globalThis.document = {
    baseURI: "http://localhost:4173/",
    documentElement: { scrollTop: 1800, dataset: { theme: "light" } },
    body: { scrollTop: 1800 },
    getElementById: () => null,
    createElement: tag => {
      const el = makeEl();
      if (tag === "iframe") {
        el.contentWindow = {
          postMessage: (msg, origin) => frameMessages.push({ msg, origin }),
          getComputedStyle: () => ({ paddingBottom: "18", marginTop: "0", marginBottom: "0" }),
          scrollY: 0
        };
        el.contentDocument = {
          documentElement: { dataset: {} },
          body: {
            getBoundingClientRect: () => ({ height: 1400 }),
            children: []
          }
        };
        createdFrames.push(el);
      }
      return el;
    }
  };

  try {
    const manifest = {
      course: { id: "canva-gemini", title: "Course" },
      lessons: [
        { id: "w1-d1", weekNumber: 1, title: "Day 1", src: "./lessons/w1-d1.html", checklistIds: ["w1-d1-c1"] },
        { id: "w1-d2", weekNumber: 1, title: "Day 2", src: "./lessons/w1-d2.html", checklistIds: ["w1-d2-c1"] }
      ]
    };
    const progress = {
      checklist: { "w1-d2-c1": true },
      lessonsDone: {},
      completedLessons: [],
      notes: { "w1-d2": "Saved note for day 2" },
      theme: "light",
      portfolio: []
    };

    const views = createCourseViews({
      app: appEl,
      sidebar: sidebarEl,
      getManifest: () => manifest,
      getProgress: () => progress,
      escapeHtml: v => String(v),
      t: key => key,
      closeMobileMenu: () => {},
      openPortfolioModal: () => {},
      deletePortfolio: () => {}
    });

    views.route();
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(globalThis.window.scrollY, 0);
    assert.ok(scrollCalls.length >= 1, "Expected scrollTo(0, 0) on route change");
    assert.equal(createdFrames.length, 1);
    assert.equal(createdFrames[0].sandbox, "allow-scripts allow-same-origin");
    assert.equal(createdFrames[0].allow, "clipboard-write");

    // Fire load event on iframe and confirm saved note is delivered.
    for (const fn of createdFrames[0].listeners.get("load") || []) fn();
    const loadMsg = frameMessages.find(entry => entry.msg.type === "LOAD_LESSON_PROGRESS");
    assert.ok(loadMsg, "Expected LOAD_LESSON_PROGRESS message on iframe load");
    assert.equal(loadMsg.msg.data.notes, "Saved note for day 2");
    assert.equal(loadMsg.msg.labels.copyPrompt, "copyPrompt");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalRAF;
  }
});

test("locales maintain matching keys and shell accessibility/responsive rules stay intact", async () => {
  const { default: viLocale } = await import("../assets/localization/locales/vi.mjs");
  const { default: enLocale } = await import("../assets/localization/locales/en.mjs");
  assert.deepEqual(Object.keys(viLocale).sort(), Object.keys(enLocale).sort());
  assert.ok(viLocale.brandHomeAria && enLocale.brandHomeAria);

  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(indexHtml, /id="brandButton"[^>]*data-i18n-aria-label="brandHomeAria"/);
  assert.match(indexHtml, /class="brand-home-badge"/);
  assert.match(indexHtml, /id="portfolioModal"[^>]*tabindex="-1"/);
  assert.match(indexHtml, /id="resetModal"[^>]*tabindex="-1"/);
  assert.match(indexHtml, /id="syncConflictModal"[^>]*tabindex="-1"/);
  assert.match(indexHtml, /id="signOutModal"[^>]*tabindex="-1"/);
  assert.match(indexHtml, /id="syncStatus"[^>]*aria-live="polite"/);
  assert.match(indexHtml, /id="accountMenuPanel"[^>]*role="menu"/);
  assert.match(indexHtml, /id="accountMenuStats"/);
  assert.match(indexHtml, /id="signInMenuButton"[^>]*role="menuitem"/);

  const css = fs.readFileSync(path.join(ROOT, "assets/style.css"), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(css, /\.topbar-actions\s+\.topbar-tools\s*>\s*summary\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.sync-status\[data-state="error"\]/);
  assert.match(css, /\.btn:disabled/);
  assert.match(css, /\.topbar-actions\s+\.account-trigger\s*\{[^}]*min-width:\s*44px;/);
  assert.match(css, /\.search-results\s*\{[^}]*position:\s*fixed;/);
  assert.match(css, /body\.lesson-page\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /summary:focus-visible/);
  assert.match(css, /\.form-field\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.portfolio-item\s*>\s*div:first-child\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /#pfWeekFilter,\s*#pfLessonFilter\s*\{[^}]*min-width:\s*0;\s*max-width:\s*100%;/);
  assert.match(css, /\.lesson-toolbar\s+\.btn\s*\{[^}]*white-space:\s*normal;/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*520px\)[\s\S]*?\.lesson-toolbar\s+\.btn\s*\{[^}]*white-space:\s*nowrap;/);
  assert.match(css, /\.lesson-jump-menu\s*>\s*summary\s*\{[^}]*white-space:\s*nowrap;/);
});

test("iframe-bridge preserves .is-copied state across UPDATE_LESSON_UI locale switches", async () => {
  const bridgeSource = fs.readFileSync(BRIDGE_PATH, "utf8");
  const windowListeners = new Map();
  const scheduledTimers = [];

  class MiniElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.className = "";
      this.id = "";
      this.textContent = "";
      this.innerHTML = "";
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this._rect = { bottom: 400, height: 400, width: 800 };
      this.classList = {
        add: (...names) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          names.forEach(name => set.add(name));
          this.className = [...set].join(" ");
        },
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          const shouldHave = force === undefined ? !set.has(name) : Boolean(force);
          if (shouldHave) set.add(name);
          else set.delete(name);
          this.className = [...set].join(" ");
          return shouldHave;
        }
      };
    }
    get firstElementChild() { return this.children[0] || null; }
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.children.indexOf(this);
      return idx > 0 ? this.parentNode.children[idx - 1] : null;
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    insertBefore(newChild, refChild) {
      newChild.parentNode = this;
      const idx = this.children.indexOf(refChild);
      if (idx < 0) this.children.push(newChild);
      else this.children.splice(idx, 0, newChild);
      return newChild;
    }
    remove() {}
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    async trigger(type, event = {}) {
      for (const fn of this.listeners.get(type) || []) await fn(event);
    }
    getBoundingClientRect() { return this._rect; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      const results = [];
      const walk = node => {
        for (const child of node.children) {
          if (selector.startsWith(".") ? child.classList.contains(selector.slice(1)) : selector.startsWith("#") ? child.id === selector.slice(1) : child.tagName === selector.toUpperCase()) {
            results.push(child);
          }
          walk(child);
        }
      };
      walk(this);
      return results;
    }
  }

  const body = new MiniElement("body");
  const promptBox = new MiniElement("div");
  promptBox.className = "prompt-box";
  const pre = new MiniElement("pre");
  pre.textContent = "Prompt text";
  promptBox.appendChild(pre);
  body.appendChild(promptBox);

  const parentWindow = { postMessage: () => {} };
  const context = vm.createContext({
    window: {
      parent: parentWindow,
      location: { origin: "http://localhost:4173" },
      scrollY: 0,
      getComputedStyle: () => ({ paddingBottom: "18", marginTop: "0", marginBottom: "0" }),
      addEventListener: (type, fn) => {
        if (!windowListeners.has(type)) windowListeners.set(type, []);
        windowListeners.get(type).push(fn);
      }
    },
    document: {
      readyState: "complete",
      documentElement: { dataset: { lessonId: "w3-d6" } },
      body,
      createElement: tag => new MiniElement(tag),
      getElementById: id => body.querySelector(`#${id}`),
      querySelectorAll: sel => body.querySelectorAll(sel),
      addEventListener: () => {}
    },
    navigator: { clipboard: { writeText: async () => {} } },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    requestAnimationFrame: fn => fn(),
    setTimeout: (fn, delay) => {
      if (delay === 0) fn();
      else scheduledTimers.push(fn);
      return scheduledTimers.length;
    },
    clearTimeout: () => {}
  });

  vm.runInContext(bridgeSource, context);
  const copyBtn = promptBox.querySelector(".prompt-copy-btn");
  await copyBtn.trigger("click");
  assert.equal(copyBtn.classList.contains("is-copied"), true);

  for (const fn of windowListeners.get("message") || []) {
    fn({
      source: parentWindow,
      origin: "http://localhost:4173",
      data: {
        type: "UPDATE_LESSON_UI",
        lessonId: "w3-d6",
        labels: { copyPrompt: "Copy", copyPromptAria: "Copy prompt", copiedPrompt: "Copied" }
      }
    });
  }

  assert.equal(copyBtn.classList.contains("is-copied"), true);
  assert.equal(copyBtn.innerHTML.includes("Copied"), true);
});

test("course-views handles same-hash search removal, w8-d7 single-arrow end card, and in-place locale refresh", async () => {
  const { createCourseViews } = await import("../assets/course/course-views.mjs");

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalFetch = globalThis.fetch;
  const originalRAF = globalThis.requestAnimationFrame;

  const frameMessages = [];
  const createdFrames = [];
  let searchRemoved = false;
  let mobileClosed = false;
  let currentLocale = "vi";

  const makeMockEl = (tag = "div") => ({
    tagName: tag.toUpperCase(),
    innerHTML: "",
    textContent: "",
    className: "",
    title: "",
    dataset: {},
    style: {},
    attributes: new Map(),
    listeners: new Map(),
    children: [],
    setAttribute(k, v) { this.attributes.set(k, v); },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    querySelector: () => null,
    querySelectorAll: () => []
  });

  const toolbarEl = makeMockEl("div");
  toolbarEl.className = "lesson-toolbar";
  const loadingLabelEl = makeMockEl("span");
  const frameWrapEl = makeMockEl("div");
  frameWrapEl.className = "lesson-frame-wrap";
  const endCardEl = makeMockEl("section");
  endCardEl.className = "card lesson-end-card";
  const lessonShellEl = {
    ...makeMockEl("div"),
    appendChild(child) {
      if (child.className.includes("lesson-end-card")) {
        endCardEl.innerHTML = child.innerHTML;
      }
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector === ".lesson-frame-wrap") return frameWrapEl;
      return null;
    }
  };

  const appEl = {
    ...makeMockEl("div"),
    querySelector(selector) {
      if (selector === ".lesson-shell") return lessonShellEl;
      if (selector === ".lesson-frame-wrap") return frameWrapEl;
      if (selector === ".lesson-toolbar") return toolbarEl;
      if (selector === ".lesson-end-card") return endCardEl;
      if (selector === ".lesson-frame-loading > span:last-child") return loadingLabelEl;
      return null;
    }
  };
  const sidebarEl = makeMockEl("aside");

  globalThis.location = { hash: "#course/canva-gemini/lesson/w8-d7", origin: "http://localhost:4173" };
  globalThis.requestAnimationFrame = fn => fn();
  globalThis.fetch = async () => ({ ok: true });
  globalThis.window = {
    scrollY: 2000,
    location: globalThis.location,
    scrollTo: opts => { globalThis.window.scrollY = opts?.top ?? 0; },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false })
  };
  globalThis.document = {
    baseURI: "http://localhost:4173/",
    documentElement: { scrollTop: 2000, dataset: { theme: "light" } },
    body: { scrollTop: 2000 },
    getElementById: id => (id === "searchResults" ? { remove() { searchRemoved = true; } } : null),
    createElement: tag => {
      const el = makeMockEl(tag);
      if (tag === "iframe") {
        el.contentWindow = {
          postMessage: (msg, origin) => frameMessages.push({ msg, origin }),
          getComputedStyle: () => ({ paddingBottom: "18", marginTop: "0", marginBottom: "0" }),
          scrollY: 0
        };
        el.contentDocument = {
          documentElement: { dataset: {} },
          body: { getBoundingClientRect: () => ({ height: 1000 }), children: [] }
        };
        createdFrames.push(el);
      }
      return el;
    }
  };

  try {
    const manifest = {
      course: { id: "canva-gemini", title: "Course" },
      lessons: [
        { id: "w8-d6", weekNumber: 8, title: "Day 6", src: "./lessons/w8-d6.html", checklistIds: [] },
        { id: "w8-d7", weekNumber: 8, title: "Day 7", src: "./lessons/w8-d7.html", checklistIds: [] }
      ]
    };
    const progress = { checklist: {}, lessonsDone: {}, completedLessons: [], notes: {}, theme: "light", portfolio: [] };

    const views = createCourseViews({
      app: appEl,
      sidebar: sidebarEl,
      getManifest: () => manifest,
      getProgress: () => progress,
      escapeHtml: v => String(v),
      t: key => (key === "backToRoadmap" ? `${currentLocale}:← Về Lộ trình` : `${currentLocale}:${key}`),
      closeMobileMenu: () => { mobileClosed = true; },
      openPortfolioModal: () => {},
      deletePortfolio: () => {}
    });

    // 1. Last lesson (w8-d7) end-card renders single arrow without trailing "→".
    views.route();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(endCardEl.innerHTML.includes("vi:← Về Lộ trình"), true);
    assert.equal(/←[^<]*→/.test(endCardEl.innerHTML), false);
    assert.equal(endCardEl.innerHTML.includes("→"), false);

    // 2. Bug 2: Same-hash route click removes #searchResults and scrolls to top.
    globalThis.window.scrollY = 2000;
    searchRemoved = false;
    mobileClosed = false;
    views.handleRoute({ currentTarget: { dataset: { route: "lesson", id: "w8-d7" } } });
    assert.equal(searchRemoved, true);
    assert.equal(mobileClosed, true);
    assert.equal(globalThis.window.scrollY, 0);
    assert.equal(globalThis.location.hash, "#course/canva-gemini/lesson/w8-d7");

    // 3. Bug 3: refreshActiveLessonLocale preserves iframe instance and updates UI in place.
    const initialFrame = views.getLessonFrame();
    currentLocale = "en";
    const refreshed = views.refreshActiveLessonLocale();
    assert.equal(refreshed, true);
    assert.equal(createdFrames.length, 1);
    assert.equal(views.getLessonFrame(), initialFrame);
    assert.equal(toolbarEl.innerHTML.includes("en:lessonSections"), true);
    assert.equal(endCardEl.innerHTML.includes("en:← Về Lộ trình"), true);
    assert.equal(loadingLabelEl.textContent, "en:loadingLessonContent");
    assert.equal(sidebarEl.innerHTML.includes("en:courseRoadmap"), true);
    const updateMsg = frameMessages.find(entry => entry.msg.type === "UPDATE_LESSON_UI");
    assert.ok(updateMsg, "Expected UPDATE_LESSON_UI postMessage");
    assert.equal(updateMsg.msg.labels.copyPrompt, "en:copyPrompt");

    // Returns false when not on an active lesson route.
    globalThis.location.hash = "#course/canva-gemini/dashboard";
    assert.equal(views.refreshActiveLessonLocale(), false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalRAF;
  }
});

test("import validation rejects missing portfolio ids and non-array completedLessons cleanly without leaking legacy keys", async () => {
  const { validateImportedData, mergeImportedProgress } = await import("../assets/progress/progress-import.mjs");
  const { createDefaultProgress } = await import("../assets/progress/progress-storage.mjs");

  const manifest = {
    lessons: [{ id: "w1-d1", weekNumber: 1, title: "Day 1", checklistIds: ["w1-d1-c1"] }]
  };

  // Malformed cases must return false without throwing TypeError.
  assert.equal(validateImportedData({ portfolio: [{ title: "No ID", lessonId: "w1-d1" }] }, manifest), false);
  assert.equal(validateImportedData({ portfolio: [{ id: "   ", title: "Blank ID", lessonId: "w1-d1" }] }, manifest), false);
  assert.equal(validateImportedData({ completedLessons: 123 }, manifest), false);
  assert.equal(validateImportedData({ lessonsDone: 123 }, manifest), false);
  assert.equal(validateImportedData({ checklist: { "w1-d1-c1": "yes" } }, manifest), false);
  assert.equal(validateImportedData({ notes: { "w1-d1": 42 } }, manifest), false);
  assert.equal(validateImportedData({ portfolio: [{ id: "pf-1", link: "javascript:alert(1)" }] }, manifest), false);

  // Valid legacy format does not spread top-level keys onto root state.
  const legacyPayload = {
    checklist: { "w1-d1-c1": true },
    notes: { "w1-d1": "Ghi chú" },
    lessonsDone: { "w1-d1": "2026-11-27" },
    portfolio: [{ id: "pf-1", lessonId: "w1-d1", title: "Poster", link: "https://canva.com/x" }],
    theme: "dark"
  };
  assert.equal(validateImportedData(legacyPayload, manifest), true);
  const merged = mergeImportedProgress(legacyPayload, createDefaultProgress());
  assert.equal(merged.schemaVersion, 1);
  assert.equal("checklist" in merged, false);
  assert.equal("notes" in merged, false);
  assert.equal("theme" in merged, false);
  assert.deepEqual(merged.progress.completedLessons, ["w1-d1"]);
  assert.equal(merged.progress.theme, "dark");
  assert.equal(merged.progress.portfolio[0].id, "pf-1");

  // Skip-link click handler in app.js prevents hash navigation to #mainContent.
  const appSource = fs.readFileSync(path.join(ROOT, "assets/app/app.js"), "utf8");
  assert.match(appSource, /querySelector\("\.skip-link"\)\?\.addEventListener\("click",\s*event\s*=>\s*\{\s*event\.preventDefault\(\)/);

  // Dialog controller excludes input[type="hidden"] from focusable elements trap.
  const dialogSource = fs.readFileSync(path.join(ROOT, "assets/app/dialog-controller.mjs"), "utf8");
  assert.match(dialogSource, /input:not\(\[type="hidden"\]\)/);
});
