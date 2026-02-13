/**
 * Audio transcription via Whisper API (Groq or OpenAI).
 */

import { config } from './config.js';

/** Map browser MIME types to file extensions for the Whisper API. */
const EXT_MAP = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/x-m4a': 'm4a',
};

/**
 * Send audio to Whisper API and return transcription.
 *
 * @param {Buffer} audioBuffer - Raw audio bytes.
 * @param {string} mimeType - Browser MIME type (e.g. "audio/webm").
 * @returns {Promise<{text: string, success: boolean, error?: string}>}
 */
export async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  const apiKey = config.transcriptionApiKey;
  if (!apiKey) {
    const provider = config.transcriptionProvider;
    const envVar = provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY';
    return {
      text: '',
      success: false,
      error: `No API key set for ${provider}. Set ${envVar}.`,
    };
  }

  const ext = EXT_MAP[mimeType] || 'webm';
  const filename = `recording.${ext}`;

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: mimeType }), filename);
  formData.append('model', config.whisperModel);
  formData.append('response_format', 'json');
  formData.append('language', 'en');

  try {
    const response = await fetch(config.transcriptionApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 500);
      return {
        text: '',
        success: false,
        error: `Transcription API error (${response.status}): ${errorBody}`,
      };
    }

    const result = await response.json();
    return {
      text: (result.text || '').trim(),
      success: true,
    };
  } catch (err) {
    return {
      text: '',
      success: false,
      error: `Transcription failed: ${err.message}`,
    };
  }
}
