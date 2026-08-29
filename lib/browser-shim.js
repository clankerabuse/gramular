"use strict";

// Chromium exposes chrome.*; Gramular source uses browser.* (Firefox-style promises).
if (typeof globalThis.browser === "undefined" && typeof globalThis.chrome !== "undefined") {
  globalThis.browser = globalThis.chrome;
}
