import { describe, it, expect } from 'vitest';
import { isAbsolute } from 'path';
import { createConfig } from '../src/config.js';

describe('createConfig', () => {
  describe('defaults', () => {
    const cfg = createConfig({});

    it('has default host 0.0.0.0', () => {
      expect(cfg.host).toBe('0.0.0.0');
    });

    it('has default port 8765', () => {
      expect(cfg.port).toBe(8765);
    });

    it('has default transcription provider groq', () => {
      expect(cfg.transcriptionProvider).toBe('groq');
    });

    it('has default whisper model', () => {
      expect(cfg.whisperModel).toBe('whisper-large-v3-turbo');
    });

    it('has cleanup disabled by default', () => {
      expect(cfg.cleanupEnabled).toBe(false);
    });

    it('has default cleanup provider anthropic', () => {
      expect(cfg.cleanupProvider).toBe('anthropic');
    });

    it('has claudeWorkDir as absolute path', () => {
      expect(isAbsolute(cfg.claudeWorkDir)).toBe(true);
    });

    it('has default cleanup model', () => {
      expect(cfg.cleanupModel).toBe('claude-sonnet-4-20250514');
    });

    it('has empty API keys by default', () => {
      expect(cfg.groqApiKey).toBe('');
      expect(cfg.openaiApiKey).toBe('');
      expect(cfg.anthropicApiKey).toBe('');
    });

    it('has empty SSL paths by default', () => {
      expect(cfg.sslCertfile).toBe('');
      expect(cfg.sslKeyfile).toBe('');
    });
  });

  describe('custom values', () => {
    it('reads HOST from env', () => {
      const cfg = createConfig({ HOST: '127.0.0.1' });
      expect(cfg.host).toBe('127.0.0.1');
    });

    it('reads PORT from env', () => {
      const cfg = createConfig({ PORT: '3000' });
      expect(cfg.port).toBe(3000);
    });

    it('reads TRANSCRIPTION_PROVIDER from env', () => {
      const cfg = createConfig({ TRANSCRIPTION_PROVIDER: 'openai' });
      expect(cfg.transcriptionProvider).toBe('openai');
    });

    it('reads WHISPER_MODEL from env', () => {
      const cfg = createConfig({ WHISPER_MODEL: 'whisper-1' });
      expect(cfg.whisperModel).toBe('whisper-1');
    });

    it('reads CLEANUP_ENABLED from env', () => {
      const cfg = createConfig({ CLEANUP_ENABLED: 'true' });
      expect(cfg.cleanupEnabled).toBe(true);
    });

    it('CLEANUP_ENABLED requires exact string true', () => {
      const cfg = createConfig({ CLEANUP_ENABLED: 'yes' });
      expect(cfg.cleanupEnabled).toBe(false);
    });

    it('reads API keys from env', () => {
      const cfg = createConfig({
        GROQ_API_KEY: 'gk',
        OPENAI_API_KEY: 'ok',
        ANTHROPIC_API_KEY: 'ak',
      });
      expect(cfg.groqApiKey).toBe('gk');
      expect(cfg.openaiApiKey).toBe('ok');
      expect(cfg.anthropicApiKey).toBe('ak');
    });
  });

  describe('port validation', () => {
    it('throws on non-numeric port', () => {
      expect(() => createConfig({ PORT: 'abc' })).toThrow('Invalid PORT');
    });

    it('throws on port 0', () => {
      expect(() => createConfig({ PORT: '0' })).toThrow('Invalid PORT');
    });

    it('throws on port above 65535', () => {
      expect(() => createConfig({ PORT: '99999' })).toThrow('Invalid PORT');
    });

    it('throws on negative port', () => {
      expect(() => createConfig({ PORT: '-1' })).toThrow('Invalid PORT');
    });
  });

  describe('SSL getters', () => {
    it('sslEnabled is false when no certs configured', () => {
      const cfg = createConfig({});
      expect(cfg.sslEnabled).toBe(false);
    });

    it('sslEnabled is false when only certfile set', () => {
      const cfg = createConfig({ SSL_CERTFILE: 'cert.pem' });
      expect(cfg.sslEnabled).toBe(false);
    });

    it('sslEnabled is false when only keyfile set', () => {
      const cfg = createConfig({ SSL_KEYFILE: 'key.pem' });
      expect(cfg.sslEnabled).toBe(false);
    });

    it('sslEnabled is true when both certfile and keyfile set', () => {
      const cfg = createConfig({ SSL_CERTFILE: 'cert.pem', SSL_KEYFILE: 'key.pem' });
      expect(cfg.sslEnabled).toBe(true);
    });
  });

  describe('transcription getters', () => {
    it('transcriptionApiKey returns groq key when provider is groq', () => {
      const cfg = createConfig({
        TRANSCRIPTION_PROVIDER: 'groq',
        GROQ_API_KEY: 'groq-key',
      });
      expect(cfg.transcriptionApiKey).toBe('groq-key');
    });

    it('transcriptionApiKey returns openai key when provider is openai', () => {
      const cfg = createConfig({
        TRANSCRIPTION_PROVIDER: 'openai',
        OPENAI_API_KEY: 'openai-key',
      });
      expect(cfg.transcriptionApiKey).toBe('openai-key');
    });

    it('transcriptionApiUrl contains groq.com when provider is groq', () => {
      const cfg = createConfig({ TRANSCRIPTION_PROVIDER: 'groq' });
      expect(cfg.transcriptionApiUrl).toContain('groq.com');
    });

    it('transcriptionApiUrl contains openai.com when provider is openai', () => {
      const cfg = createConfig({ TRANSCRIPTION_PROVIDER: 'openai' });
      expect(cfg.transcriptionApiUrl).toContain('openai.com');
    });
  });
});
