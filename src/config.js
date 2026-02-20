/**
 * Configuration for Claude Line.
 *
 * Reads environment variables (with dotenv support) and exports
 * a config object with all settings.
 */

import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config();

/**
 * Create a configuration object from an environment map.
 *
 * @param {Record<string, string|undefined>} env - Environment variables (defaults to process.env).
 * @returns {object} Configuration object with all settings.
 */
export function createConfig(env = process.env) {
  const port = parseInt(env.PORT || '8765', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${env.PORT}". Must be a number between 1 and 65535.`);
  }

  return {
    // Server
    host: env.HOST || '0.0.0.0',
    port,

    // Transcription
    transcriptionProvider: env.TRANSCRIPTION_PROVIDER || 'groq',
    groqApiKey: env.GROQ_API_KEY || '',
    openaiApiKey: env.OPENAI_API_KEY || '',
    whisperModel: env.WHISPER_MODEL || 'whisper-large-v3-turbo',

    // Claude Code
    claudeWorkDir: resolve(env.CLAUDE_WORK_DIR || '.'),

    // SSL
    sslCertfile: env.SSL_CERTFILE || '',
    sslKeyfile: env.SSL_KEYFILE || '',

    // Text cleanup
    cleanupEnabled: env.CLEANUP_ENABLED === 'true',
    cleanupProvider: env.CLEANUP_PROVIDER || 'anthropic',
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    cleanupModel: env.CLEANUP_MODEL || 'claude-sonnet-4-20250514',

    get sslEnabled() {
      return Boolean(this.sslCertfile && this.sslKeyfile);
    },

    get transcriptionApiKey() {
      if (this.transcriptionProvider === 'groq') {
        return this.groqApiKey;
      }
      return this.openaiApiKey;
    },

    get transcriptionApiUrl() {
      if (this.transcriptionProvider === 'groq') {
        return 'https://api.groq.com/openai/v1/audio/transcriptions';
      }
      return 'https://api.openai.com/v1/audio/transcriptions';
    },
  };
}

export const config = createConfig();
