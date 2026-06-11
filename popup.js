"use strict";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const XAI_BASE = "https://api.x.ai/v1";

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Fallback lists used if the /models endpoint is unreachable.
const FALLBACK_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];
const FALLBACK_XAI_MODELS = [
  "grok-4.3",
  "grok-3",
  "grok-3-mini",
  "grok-build-0.1",
];

const el = {
  provider: document.getElementById("provider"),
  apiKey: document.getElementById("apiKey"),
  xaiApiKey: document.getElementById("xaiApiKey"),
  anthropicKeyGroup: document.getElementById("anthropicKeyGroup"),
  xaiKeyGroup: document.getElementById("xaiKeyGroup"),
  modelSelect: document.getElementById("modelSelect"),
  enabledToggle: document.getElementById("enabledToggle"),
  saveSettings: document.getElementById("saveSettings"),
  settingsStatus: document.getElementById("settingsStatus"),
};

function getSettings() {
  return browser.storage.local
    .get(["provider", "apiKey", "xaiApiKey", "model", "enabled"])
    .then((data) => data || {});
}

function saveSettings(values) {
  return browser.storage.local.set(values);
}

function setStatus(msg, type) {
  el.settingsStatus.textContent = msg;
  el.settingsStatus.className = "status" + (type ? " " + type : "");
}

function updateApiKeyVisibility(provider) {
  const isXai = provider === "xai";
  if (el.anthropicKeyGroup) el.anthropicKeyGroup.style.display = isXai ? "none" : "";
  if (el.xaiKeyGroup) el.xaiKeyGroup.style.display = isXai ? "" : "none";
}

function anthropicHeaders(apiKey) {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

async function fetchModels(apiKey) {
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/models?limit=100`, {
      headers: anthropicHeaders(apiKey),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data)
      ? json.data.map((m) => m.id).filter(Boolean)
      : [];
    return list.length ? list : FALLBACK_MODELS;
  } catch (err) {
    console.warn("Gramular: model fetch failed, using fallback list.", err);
    return FALLBACK_MODELS;
  }
}

async function fetchXaiModels(xaiApiKey) {
  try {
    const res = await fetch(`${XAI_BASE}/models`, {
      headers: { Authorization: `Bearer ${xaiApiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data)
      ? json.data.map((m) => m.id).filter(Boolean)
      : [];
    return list.length ? list : FALLBACK_XAI_MODELS;
  } catch (err) {
    console.warn("Gramular: xAI model fetch failed, using fallback list.", err);
    return FALLBACK_XAI_MODELS;
  }
}

function populateModelSelect(models, selected) {
  el.modelSelect.innerHTML = "";
  models.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    el.modelSelect.appendChild(opt);
  });
  let toSelect = models.find((id) => id === selected);
  if (!toSelect && selected) {
    toSelect = models.find(
      (id) => id.startsWith(selected) || selected.startsWith(id),
    );
  }
  if (!toSelect) toSelect = models[0];
  if (toSelect) el.modelSelect.value = toSelect;
}

async function refreshModels(provider, apiKey, xaiApiKey, selectedModel) {
  let models;
  if (provider === "xai") {
    models = xaiApiKey ? await fetchXaiModels(xaiApiKey) : FALLBACK_XAI_MODELS;
  } else {
    models = apiKey ? await fetchModels(apiKey) : FALLBACK_MODELS;
  }
  const def = provider === "xai" ? "grok-4.3" : DEFAULT_MODEL;
  populateModelSelect(models, selectedModel || def);
}

async function handleSave() {
  const provider = el.provider.value || DEFAULT_PROVIDER;
  const apiKey = el.apiKey.value.trim();
  const xaiApiKey = el.xaiApiKey.value.trim();
  const enabled = el.enabledToggle.checked;
  const def = provider === "xai" ? "grok-4.3" : DEFAULT_MODEL;
  const model = el.modelSelect.value || def;

  setStatus("Saving…", "");
  await saveSettings({ provider, apiKey, xaiApiKey, enabled, model });
  await refreshModels(provider, apiKey, xaiApiKey, model);
  setStatus("Settings saved.", "ok");
}

async function init() {
  const {
    provider = DEFAULT_PROVIDER,
    apiKey,
    xaiApiKey,
    model,
    enabled,
  } = await getSettings();

  el.provider.value = provider;
  updateApiKeyVisibility(provider);
  if (apiKey) el.apiKey.value = apiKey;
  if (xaiApiKey) el.xaiApiKey.value = xaiApiKey;
  el.enabledToggle.checked = enabled !== false;

  const initialFallback = provider === "xai" ? FALLBACK_XAI_MODELS : FALLBACK_MODELS;
  const initialDef = provider === "xai" ? "grok-4.3" : DEFAULT_MODEL;
  populateModelSelect(initialFallback, model || initialDef);
  await refreshModels(provider, apiKey, xaiApiKey, model);

  if (provider === "xai") {
    if (!xaiApiKey) setStatus("Add your xAI API key to get started.", "");
  } else {
    if (!apiKey) setStatus("Add your Anthropic API key to get started.", "");
  }

  el.provider.addEventListener("change", async () => {
    const p = el.provider.value;
    updateApiKeyVisibility(p);
    const current = await getSettings();
    const newFallback = p === "xai" ? FALLBACK_XAI_MODELS : FALLBACK_MODELS;
    const newDef = p === "xai" ? "grok-4.3" : DEFAULT_MODEL;
    populateModelSelect(newFallback, newDef);
    await refreshModels(p, current.apiKey, current.xaiApiKey, newDef);
    await saveSettings({
      provider: p,
      apiKey: current.apiKey || "",
      xaiApiKey: current.xaiApiKey || "",
      enabled: current.enabled !== false,
      model: el.modelSelect.value,
    });
    if (p === "xai") {
      setStatus(!current.xaiApiKey ? "Add your xAI API key to get started." : "", "");
    } else {
      setStatus(!current.apiKey ? "Add your Anthropic API key to get started." : "", "");
    }
  });

  el.modelSelect.addEventListener("change", async () => {
    const current = await getSettings();
    await saveSettings({
      provider: current.provider || DEFAULT_PROVIDER,
      apiKey: current.apiKey || "",
      xaiApiKey: current.xaiApiKey || "",
      enabled: current.enabled !== false,
      model: el.modelSelect.value,
    });
  });

  el.saveSettings.addEventListener("click", handleSave);
}

document.addEventListener("DOMContentLoaded", init);
