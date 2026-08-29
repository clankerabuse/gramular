#!/usr/bin/env node
"use strict";

/**
 * Build a Chromium-compatible extension into dist/chromium/.
 * Shared source files stay at the repo root; Firefox keeps manifest.json as-is.
 *
 * Usage: node scripts/build-chromium.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "chromium");

const COPY_FILES = [
  "content.js",
  "content.css",
  "popup.js",
  "popup.css",
  "logo.svg",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(relPath) {
  const src = path.join(root, relPath);
  const dest = path.join(outDir, relPath);
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function readRootFile(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function writeOutFile(relPath, content) {
  const dest = path.join(outDir, relPath);
  mkdirp(path.dirname(dest));
  fs.writeFileSync(dest, content);
}

const firefoxManifest = JSON.parse(readRootFile("manifest.json"));

const chromiumManifest = {
  manifest_version: 3,
  name: firefoxManifest.name,
  version: firefoxManifest.version,
  description: firefoxManifest.description,
  permissions: firefoxManifest.permissions,
  host_permissions: firefoxManifest.host_permissions,
  action: firefoxManifest.action,
  background: {
    service_worker: "background.js",
  },
  icons: firefoxManifest.icons,
  content_scripts: firefoxManifest.content_scripts.map((entry) => ({
    ...entry,
    js: ["browser-shim.js", ...entry.js],
  })),
  commands: firefoxManifest.commands,
};

mkdirp(outDir);

for (const relPath of COPY_FILES) {
  copyFile(relPath);
}

writeOutFile("browser-shim.js", readRootFile("lib/browser-shim.js"));

const background = readRootFile("background.js");
writeOutFile("background.js", `importScripts("browser-shim.js");\n${background}`);

const popupHtml = readRootFile("popup.html").replace(
  "<script src=\"popup.js\"></script>",
  "<script src=\"browser-shim.js\"></script>\n    <script src=\"popup.js\"></script>",
);

writeOutFile("popup.html", popupHtml);

writeOutFile("manifest.json", `${JSON.stringify(chromiumManifest, null, 2)}\n`);

console.log(`Chromium build written to ${outDir}`);
