/**
 * Text cleanup: convert spoken/dictated text into clean written instructions.
 *
 * Handles false starts, corrections, filler words, and restructures speech
 * into the kind of precise text you'd type on a keyboard.
 */

import { config } from './config.js';

const CLEANUP_SYSTEM_PROMPT = `You are a text cleanup assistant. Your job is to take transcribed speech \
— which may contain false starts, self-corrections, filler words, \
repetitions, and conversational artifacts — and convert it into clean, \
precise written text suitable as instructions for a coding assistant \
(Claude Code).

Rules:
- Preserve the user's intent exactly. Do not add, infer, or remove \
instructions.
- Remove filler words (um, uh, like, you know, so, basically, etc.)
- Resolve self-corrections: if the user says "no wait, I mean X", \
keep only X.
- Collapse repetitions into single statements.
- Fix obvious grammar issues that arise from speech patterns.
- Keep technical terms, file paths, variable names, and code references \
exactly as spoken.
- Output ONLY the cleaned text, nothing else. No preamble, no explanation.
- If the input is already clean, return it unchanged.`;

/**
 * Run an LLM cleanup pass on transcribed text.
 *
 * @param {string} rawText - The raw transcribed text.
 * @returns {Promise<{text: string, original: string, success: boolean, error?: string, skipped?: boolean}>}
 */
export async function cleanupText(rawText) {
  if (!config.cleanupEnabled) {
    return {
      text: rawText,
      original: rawText,
      success: true,
      skipped: true,
    };
  }

  if (config.cleanupProvider === 'anthropic') {
    return _cleanupAnthropic(rawText);
  }
  if (config.cleanupProvider === 'openai') {
    return _cleanupOpenai(rawText);
  }

  return {
    text: rawText,
    original: rawText,
    success: false,
    error: `Unknown cleanup provider: ${config.cleanupProvider}`,
  };
}

async function _cleanupAnthropic(rawText) {
  const apiKey = config.anthropicApiKey;
  if (!apiKey) {
    return {
      text: rawText,
      original: rawText,
      success: false,
      error: 'ANTHROPIC_API_KEY not set',
    };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.cleanupModel,
        max_tokens: 2048,
        system: CLEANUP_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: rawText }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 500);
      throw new Error(`API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();
    const cleaned = result.content[0].text.trim();
    return {
      text: cleaned,
      original: rawText,
      success: true,
    };
  } catch (err) {
    return {
      text: rawText,
      original: rawText,
      success: false,
      error: `Cleanup failed: ${err.message}`,
    };
  }
}

async function _cleanupOpenai(rawText) {
  const apiKey = config.openaiApiKey;
  if (!apiKey) {
    return {
      text: rawText,
      original: rawText,
      success: false,
      error: 'OPENAI_API_KEY not set',
    };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: CLEANUP_SYSTEM_PROMPT },
          { role: 'user', content: rawText },
        ],
        max_tokens: 2048,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 500);
      throw new Error(`API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();
    const cleaned = result.choices[0].message.content.trim();
    return {
      text: cleaned,
      original: rawText,
      success: true,
    };
  } catch (err) {
    return {
      text: rawText,
      original: rawText,
      success: false,
      error: `Cleanup failed: ${err.message}`,
    };
  }
}
