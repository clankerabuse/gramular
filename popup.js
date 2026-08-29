"use strict";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const XAI_BASE = "https://api.x.ai/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

const DEFAULT_PROVIDER = "xai";

const PROVIDER_DEFAULTS = {
  anthropic: { keyField: "apiKey" },
  xai: { keyField: "xaiApiKey" },
  openai: { keyField: "openaiApiKey" },
};

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

function updateApiKeyVisibility(provider) {
  if (el.anthropicKeyGroup) el.anthropicKeyGroup.style.display = provider === "anthropic" ? "" : "none";
  if (el.xaiKeyGroup) el.xaiKeyGroup.style.display = provider === "xai" ? "" : "none";
  if (el.openaiKeyGroup) el.openaiKeyGroup.style.display = provider === "openai" ? "" : "none";
}

function missingKeyMessage(provider) {
  if (provider === "xai") return "Add your xAI API key to load models.";
  if (provider === "openai") return "Add your OpenAI API key to load models.";
  return "Add your Anthropic API key to load models.";
}

function anthropicHeaders(apiKey) {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

function currentApiKey(provider, settings) {
  return (settings[providerConfig(provider).keyField] || "").trim();
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

function isXaiChatModel(id, outputModalities) {
  if (!id) return false;
  const n = String(id).toLowerCase();
  if (
    n.includes("image") ||
    n.includes("imagine") ||
    n.includes("video") ||
    n.includes("tts") ||
    n.includes("whisper") ||
    n.includes("embed") ||
    n.includes("audio")
  ) {
    return false;
  }
  if (Array.isArray(outputModalities) && outputModalities.length && !outputModalities.includes("text")) {
    return false;
  }
  return true;
}

function sortModelsByCreated(rows) {
  return rows.slice().sort((a, b) => (b.created || 0) - (a.created || 0));
}

function setModelSelectPlaceholder(text) {
  el.modelSelect.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = text;
  el.modelSelect.appendChild(opt);
  el.modelSelect.disabled = true;
}

async function fetchAnthropicModels(apiKey) {
  const res = await fetch(`${ANTHROPIC_BASE}/models?limit=100`, {
    headers: anthropicHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data : [];
  return sortModelsByCreated(rows).map((m) => m.id).filter(Boolean);
}

async function fetchXaiModels(xaiApiKey) {
  const headers = { Authorization: `Bearer ${xaiApiKey}` };
  const langRes = await fetch(`${XAI_BASE}/language-models`, { headers });
  if (langRes.ok) {
    const json = await langRes.json();
    const rows = Array.isArray(json.models) ? json.models : [];
    return sortModelsByCreated(rows)
      .filter((m) => isXaiChatModel(m && m.id, m && m.output_modalities))
      .map((m) => m.id);
  }

  const res = await fetch(`${XAI_BASE}/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data : [];
  return sortModelsByCreated(rows)
    .filter((m) => isXaiChatModel(m && m.id, m && m.output_modalities))
    .map((m) => m.id);
}

async function fetchOpenAIModels(openaiApiKey) {
  const res = await fetch(`${OPENAI_BASE}/models`, {
    headers: { Authorization: `Bearer ${openaiApiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data : [];
  return filterOpenAIModels(sortModelsByCreated(rows).map((m) => m.id));
}

function populateModelSelect(models, selected) {
  el.modelSelect.innerHTML = "";
  if (!models.length) {
    setModelSelectPlaceholder("Save API key to load models");
    return "";
  }
  el.modelSelect.disabled = false;
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
  return toSelect || "";
}

let modelFetchId = 0;

async function refreshModels(provider, settings, selectedModel) {
  const fetchId = ++modelFetchId;
  const apiKey = currentApiKey(provider, settings);
  if (!apiKey) {
    setModelSelectPlaceholder("Save API key to load models");
    return [];
  }

  setModelSelectPlaceholder("Loading models…");
  try {
    let models;
    if (provider === "xai") models = await fetchXaiModels(apiKey);
    else if (provider === "openai") models = await fetchOpenAIModels(apiKey);
    else models = await fetchAnthropicModels(apiKey);

    if (fetchId !== modelFetchId) return models;

    if (!models.length) {
      setModelSelectPlaceholder("No chat models returned");
      return [];
    }
    populateModelSelect(models, selectedModel);
    return models;
  } catch (err) {
    if (fetchId !== modelFetchId) return [];
    console.warn("Gramular: model fetch failed.", err);
    setModelSelectPlaceholder("Couldn't load models");
    return [];
  }
}

function formSettings() {
  return {
    provider: el.provider.value || DEFAULT_PROVIDER,
    apiKey: el.apiKey.value.trim(),
    xaiApiKey: el.xaiApiKey.value.trim(),
    openaiApiKey: el.openaiApiKey.value.trim(),
    enabled: el.enabledToggle.checked,
    skipConfirm: el.skipConfirmToggle.checked,
  };
}

async function handleSave() {
  const settings = formSettings();
  setStatus("Saving…", "");
  await refreshModels(settings.provider, settings, el.modelSelect.value);
  const model = el.modelSelect.value;
  await saveSettings({ ...settings, model });
  if (!currentApiKey(settings.provider, settings)) {
    setStatus(missingKeyMessage(settings.provider), "");
    return;
  }
  if (!model) {
    setStatus("Saved, but no models loaded. Check the API key.", "err");
    return;
  }
  setStatus("Settings saved.", "ok");
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
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

  setModelSelectPlaceholder("Save API key to load models");
  const models = await refreshModels(provider, settings, settings.model);
  if (models.length) {
    const selected = el.modelSelect.value;
    if (selected && selected !== settings.model) {
      await saveSettings({ model: selected });
    }
  }

  if (!settings[config.keyField]) {
    setStatus(missingKeyMessage(provider), "");
  }

  el.provider.addEventListener("change", async () => {
    const draft = formSettings();
    updateApiKeyVisibility(draft.provider);
    const stored = await getSettings();
    await refreshModels(draft.provider, { ...stored, ...draft }, stored.model);
    await saveSettings({
      ...stored,
      provider: draft.provider,
      model: el.modelSelect.value,
    });
    setStatus(!currentApiKey(draft.provider, { ...stored, ...draft }) ? missingKeyMessage(draft.provider) : "", "");
  });

  el.modelSelect.addEventListener("change", async () => {
    if (!el.modelSelect.value) return;
    await saveSettings({ model: el.modelSelect.value });
  });

  el.skipConfirmToggle.addEventListener("change", async () => {
    await saveSettings({ skipConfirm: el.skipConfirmToggle.checked });
  });

  const refreshFromKeyField = debounce(async () => {
    const draft = formSettings();
    const stored = await getSettings();
    await refreshModels(draft.provider, draft, stored.model || el.modelSelect.value);
  }, 400);

  [el.apiKey, el.xaiApiKey, el.openaiApiKey].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", refreshFromKeyField);
    input.addEventListener("change", refreshFromKeyField);
  });

  el.saveSettings.addEventListener("click", handleSave);
}

document.addEventListener("DOMContentLoaded", init);
