#!/usr/bin/env node
"use strict";

/**
 * Validates Gramular provider helpers and optionally smoke-tests live APIs.
 * Usage:
 *   node scripts/test-providers.mjs           # unit tests only
 *   OPENAI_API_KEY=sk-... node scripts/test-providers.mjs --live openai
 */

const OPENAI_BASE = "https://api.openai.com/v1";
const MAX_TOKENS = 4096;

function extractChatCompletionText(json) {
  if (json && json.choices && json.choices[0] && json.choices[0].message) {
    return (json.choices[0].message.content || "").trim();
  }
  return "";
}

function extractOpenAIResponsesText(json) {
  if (json && typeof json.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }
  if (json && Array.isArray(json.output)) {
    let text = "";
    for (const item of json.output) {
      if (item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part.type === "output_text" && part.text) text += part.text;
      }
    }
    return text.trim();
  }
  return "";
}

function usesOpenAIResponses(model) {
  return /codex/i.test(model);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runUnitTests() {
  assert(
    extractChatCompletionText({
      choices: [{ message: { content: "  hello world  " } }],
    }) === "hello world",
    "chat completion text extraction",
  );

  assert(
    extractOpenAIResponsesText({ output_text: "  codex reply  " }) === "codex reply",
    "responses output_text extraction",
  );

  assert(
    extractOpenAIResponsesText({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Part one. " }, { type: "output_text", text: "Part two." }],
        },
      ],
    }) === "Part one. Part two.",
    "responses output array extraction",
  );

  assert(usesOpenAIResponses("gpt-5-codex"), "codex model uses responses API");
  assert(!usesOpenAIResponses("gpt-4o"), "gpt-4o uses chat completions");
  assert(!usesOpenAIResponses("grok-4.3"), "non-openai models unaffected");

  const filtered = filterOpenAIModels([
    "gpt-4o",
    "text-embedding-3-small",
    "gpt-5-codex",
    "whisper-1",
    "davinci-002",
  ]);
  assert(filtered.join(",") === "gpt-4o,gpt-5-codex", "OpenAI model filter");

  console.log("All unit tests passed.");
}

async function parseApiError(res) {
  let detail = `HTTP ${res.status}`;
  try {
    const errJson = await res.json();
    if (errJson.error) {
      detail += `: ${errJson.error.message || JSON.stringify(errJson.error)}`;
    }
  } catch (_) {
    /* ignore */
  }
  return detail;
}

async function callChatCompletions({ apiKey, model, systemPrompt, userContent }) {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  const json = await res.json();
  const text = extractChatCompletionText(json);
  if (!text) throw new Error("empty chat completion response");
  return text;
}

async function callOpenAIResponses({ apiKey, model, systemPrompt, userContent }) {
  const res = await fetch(`${OPENAI_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: systemPrompt,
      input: userContent,
      max_output_tokens: MAX_TOKENS,
    }),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  const json = await res.json();
  const text = extractOpenAIResponsesText(json);
  if (!text) throw new Error("empty responses API result");
  return text;
}

async function liveOpenAITest(apiKey) {
  const systemPrompt = "Return only the corrected text.";
  const userContent = "fix this sentance: teh cat sat on teh mat.";

  console.log("Live test: OpenAI chat/completions (gpt-4o-mini)…");
  const chatText = await callChatCompletions({
    apiKey,
    model: "gpt-4o-mini",
    systemPrompt,
    userContent,
  });
  assert(chatText.length > 0, "chat completion returned text");
  console.log("  OK:", chatText.slice(0, 80));

  console.log("Live test: OpenAI Responses API routing for codex models…");
  assert(usesOpenAIResponses("gpt-5-codex"), "codex routing flag");

  try {
    const codexText = await callOpenAIResponses({
      apiKey,
      model: "gpt-5-codex",
      systemPrompt,
      userContent,
    });
    assert(codexText.length > 0, "codex responses returned text");
    console.log("  OK (gpt-5-codex):", codexText.slice(0, 80));
  } catch (err) {
    if (/404|model|not found|does not exist|access/i.test(String(err.message))) {
      console.log("  Skipped gpt-5-codex (model unavailable on this key):", err.message);
    } else {
      throw err;
    }
  }

  console.log("Live OpenAI tests passed.");
}

async function main() {
  runUnitTests();

  const args = process.argv.slice(2);
  if (args.includes("--live") && args.includes("openai")) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Set OPENAI_API_KEY to run live OpenAI tests.");
      process.exit(1);
    }
    await liveOpenAITest(apiKey);
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
