"use strict";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const XAI_BASE = "https://api.x.ai/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

const DEFAULT_PROVIDER = "xai";

const PROVIDER_DEFAULTS = {
  anthropic: { defaultModel: "claude-haiku-4-5-20251001", keyField: "apiKey" },
  xai: { defaultModel: "grok-4.3", keyField: "xaiApiKey" },
  openai: { defaultModel: "gpt-4o", keyField: "openaiApiKey" },
};

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
const FALLBACK_OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-5-codex",
  "gpt-5.1-codex",
  "o4-mini",
  "o3",
];

const el = {
  provider: document.getElementById("provider"),
  apiKey: document.getElementById("apiKey"),
  xaiApiKey: document.getElementById("xaiApiKey"),
  openaiApiKey: document.getElementById("openaiApiKey"),
  anthropicKeyGroup: document.getElementById("anthropicKeyGroup"),
  xaiKeyGroup: document.getElementById("xaiKeyGroup"),
  openaiKeyGroup: document.getElementById("openaiKeyGroup"),
  modelSelect: document.getElementById("modelSelect"),
  enabledToggle: document.getElementById("enabledToggle"),
  skipConfirmToggle: document.getElementById("skipConfirmToggle"),
  saveSettings: document.getElementById("saveSettings"),
  settingsStatus: document.getElementById("settingsStatus"),
};

function getSettings() {
  return browser.storage.local
    .get(["provider", "apiKey", "xaiApiKey", "openaiApiKey", "model", "enabled", "skipConfirm"])
    .then((data) => data || {});
}

function saveSettings(values) {
  return browser.storage.local.set(values);
}

function setStatus(msg, type) {
  el.settingsStatus.textContent = msg;
  el.settingsStatus.className = "status" + (type ? " " + type : "");
}

function providerConfig(provider) {
  return PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.anthropic;
}

function fallbackModels(provider) {
  if (provider === "xai") return FALLBACK_XAI_MODELS;
  if (provider === "openai") return FALLBACK_OPENAI_MODELS;
  return FALLBACK_MODELS;
}

function updateApiKeyVisibility(provider) {
  if (el.anthropicKeyGroup) el.anthropicKeyGroup.style.display = provider === "anthropic" ? "" : "none";
  if (el.xaiKeyGroup) el.xaiKeyGroup.style.display = provider === "xai" ? "" : "none";
  if (el.openaiKeyGroup) el.openaiKeyGroup.style.display = provider === "openai" ? "" : "none";
}

function missingKeyMessage(provider) {
  if (provider === "xai") return "Add your xAI API key to get started.";
  if (provider === "openai") return "Add your OpenAI API key to get started.";
  return "Add your Anthropic API key to get started.";
}

function anthropicHeaders(apiKey) {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

function filterOpenAIModels(ids) {
  return ids.filter((id) => {
    if (!id) return false;
    if (
      id.includes("embed") ||
      id.includes("tts") ||
      id.includes("whisper") ||
      id.includes("dall-e") ||
      id.includes("realtime") ||
      id.includes("audio") ||
      id.includes("transcribe") ||
      id.includes("moderation")
    ) {
      return false;
    }
    if (id.startsWith("ft:") || id.startsWith("davinci") || id.startsWith("babbage")) {
      return false;
    }
    return true;
  });
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

async function fetchOpenAIModels(openaiApiKey) {
  try {
    const res = await fetch(`${OPENAI_BASE}/models`, {
      headers: { Authorization: `Bearer ${openaiApiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.data)
      ? filterOpenAIModels(json.data.map((m) => m.id))
      : [];
    return list.length ? list : FALLBACK_OPENAI_MODELS;
  } catch (err) {
    console.warn("Gramular: OpenAI model fetch failed, using fallback list.", err);
    return FALLBACK_OPENAI_MODELS;
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

async function refreshModels(provider, settings, selectedModel) {
  const config = providerConfig(provider);
  let models;
  if (provider === "xai") {
    models = settings.xaiApiKey ? await fetchXaiModels(settings.xaiApiKey) : FALLBACK_XAI_MODELS;
  } else if (provider === "openai") {
    models = settings.openaiApiKey
      ? await fetchOpenAIModels(settings.openaiApiKey)
      : FALLBACK_OPENAI_MODELS;
  } else {
    models = settings.apiKey ? await fetchModels(settings.apiKey) : FALLBACK_MODELS;
  }
  populateModelSelect(models, selectedModel || config.defaultModel);
}

async function handleSave() {
  const provider = el.provider.value || DEFAULT_PROVIDER;
  const apiKey = el.apiKey.value.trim();
  const xaiApiKey = el.xaiApiKey.value.trim();
  const openaiApiKey = el.openaiApiKey.value.trim();
  const enabled = el.enabledToggle.checked;
  const skipConfirm = el.skipConfirmToggle.checked;
  const config = providerConfig(provider);
  const model = el.modelSelect.value || config.defaultModel;

  setStatus("Saving…", "");
  const settings = { provider, apiKey, xaiApiKey, openaiApiKey, enabled, skipConfirm, model };
  await saveSettings(settings);
  await refreshModels(provider, settings, model);
  setStatus("Settings saved.", "ok");
}

async function init() {
  const settings = await getSettings();
  const provider = settings.provider || DEFAULT_PROVIDER;
  const config = providerConfig(provider);

  el.provider.value = provider;
  updateApiKeyVisibility(provider);
  if (settings.apiKey) el.apiKey.value = settings.apiKey;
  if (settings.xaiApiKey) el.xaiApiKey.value = settings.xaiApiKey;
  if (settings.openaiApiKey) el.openaiApiKey.value = settings.openaiApiKey;
  el.enabledToggle.checked = settings.enabled !== false;
  el.skipConfirmToggle.checked = settings.skipConfirm === true;

  populateModelSelect(fallbackModels(provider), settings.model || config.defaultModel);
  await refreshModels(provider, settings, settings.model);

  if (!settings[config.keyField]) {
    setStatus(missingKeyMessage(provider), "");
  }

  el.provider.addEventListener("change", async () => {
    const p = el.provider.value;
    updateApiKeyVisibility(p);
    const current = await getSettings();
    const newConfig = providerConfig(p);
    populateModelSelect(fallbackModels(p), newConfig.defaultModel);
    await refreshModels(p, current, newConfig.defaultModel);
    await saveSettings({
      provider: p,
      apiKey: current.apiKey || "",
      xaiApiKey: current.xaiApiKey || "",
      openaiApiKey: current.openaiApiKey || "",
      enabled: current.enabled !== false,
      skipConfirm: current.skipConfirm === true,
      model: el.modelSelect.value,
    });
    setStatus(!current[newConfig.keyField] ? missingKeyMessage(p) : "", "");
  });

  el.modelSelect.addEventListener("change", async () => {
    const current = await getSettings();
    await saveSettings({
      provider: current.provider || DEFAULT_PROVIDER,
      apiKey: current.apiKey || "",
      xaiApiKey: current.xaiApiKey || "",
      openaiApiKey: current.openaiApiKey || "",
      enabled: current.enabled !== false,
      skipConfirm: current.skipConfirm === true,
      model: el.modelSelect.value,
    });
  });

  el.skipConfirmToggle.addEventListener("change", async () => {
    const current = await getSettings();
    await saveSettings({
      provider: current.provider || DEFAULT_PROVIDER,
      apiKey: current.apiKey || "",
      xaiApiKey: current.xaiApiKey || "",
      openaiApiKey: current.openaiApiKey || "",
      enabled: current.enabled !== false,
      skipConfirm: el.skipConfirmToggle.checked,
      model: current.model || providerConfig(current.provider || DEFAULT_PROVIDER).defaultModel,
    });
  });

  el.saveSettings.addEventListener("click", handleSave);
}

document.addEventListener("DOMContentLoaded", init);
