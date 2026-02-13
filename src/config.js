/**
 * Configuration for Claude Line.
 *
 * Reads environment variables (with dotenv support) and exports
 * a config object with all settings.
 */

import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config();

export const config = {
  // Server
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '8765', 10),

  // Transcription
  transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER || 'groq',
  groqApiKey: process.env.GROQ_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  whisperModel: process.env.WHISPER_MODEL || 'whisper-large-v3-turbo',

  // Claude Code
  claudeWorkDir: resolve(process.env.CLAUDE_WORK_DIR || '.'),

  // SSL
  sslCertfile: process.env.SSL_CERTFILE || '',
  sslKeyfile: process.env.SSL_KEYFILE || '',

  // Text cleanup
  cleanupEnabled: process.env.CLEANUP_ENABLED === 'true',
  cleanupProvider: process.env.CLEANUP_PROVIDER || 'anthropic',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  cleanupModel: process.env.CLEANUP_MODEL || 'claude-sonnet-4-20250514',

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
