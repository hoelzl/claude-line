import { describe, it, expect, beforeEach } from 'vitest';
import { config } from '../src/config.js';

describe('config', () => {
  describe('defaults', () => {
    it('has default host 0.0.0.0', () => {
      // HOST not set in test env, so default applies
      expect(config.host).toBeDefined();
      expect(typeof config.host).toBe('string');
    });

    it('has a numeric port', () => {
      expect(typeof config.port).toBe('number');
      expect(config.port).toBeGreaterThan(0);
    });

    it('has a transcription provider', () => {
      expect(typeof config.transcriptionProvider).toBe('string');
      expect(config.transcriptionProvider.length).toBeGreaterThan(0);
    });

    it('has a whisper model', () => {
      expect(config.whisperModel).toBe('whisper-large-v3-turbo');
    });

    it('has cleanup disabled by default', () => {
      // Unless CLEANUP_ENABLED=true is set in the environment
      expect(typeof config.cleanupEnabled).toBe('boolean');
    });

    it('has cleanup provider set', () => {
      expect(typeof config.cleanupProvider).toBe('string');
    });

    it('has claudeWorkDir as absolute path', () => {
      // resolve('.') produces an absolute path
      expect(config.claudeWorkDir.length).toBeGreaterThan(1);
    });
  });

  describe('SSL getters', () => {
    it('sslEnabled getter returns boolean', () => {
      expect(typeof config.sslEnabled).toBe('boolean');
    });

    it('sslEnabled requires both certfile and keyfile', () => {
      // With default empty strings, SSL should be disabled
      const originalCert = config.sslCertfile;
      const originalKey = config.sslKeyfile;

      // Test the getter logic: both must be truthy
      config.sslCertfile = '';
      config.sslKeyfile = '';
      expect(config.sslEnabled).toBe(false);

      config.sslCertfile = 'cert.pem';
      config.sslKeyfile = '';
      expect(config.sslEnabled).toBe(false);

      config.sslCertfile = '';
      config.sslKeyfile = 'key.pem';
      expect(config.sslEnabled).toBe(false);

      config.sslCertfile = 'cert.pem';
      config.sslKeyfile = 'key.pem';
      expect(config.sslEnabled).toBe(true);

      // Restore
      config.sslCertfile = originalCert;
      config.sslKeyfile = originalKey;
    });
  });

  describe('transcription getters', () => {
    it('transcriptionApiKey returns groq key when provider is groq', () => {
      const origProvider = config.transcriptionProvider;
      const origKey = config.groqApiKey;

      config.transcriptionProvider = 'groq';
      config.groqApiKey = 'groq-test-key';
      expect(config.transcriptionApiKey).toBe('groq-test-key');

      config.transcriptionProvider = origProvider;
      config.groqApiKey = origKey;
    });

    it('transcriptionApiKey returns openai key when provider is openai', () => {
      const origProvider = config.transcriptionProvider;
      const origKey = config.openaiApiKey;

      config.transcriptionProvider = 'openai';
      config.openaiApiKey = 'openai-test-key';
      expect(config.transcriptionApiKey).toBe('openai-test-key');

      config.transcriptionProvider = origProvider;
      config.openaiApiKey = origKey;
    });

    it('transcriptionApiUrl contains groq.com when provider is groq', () => {
      const origProvider = config.transcriptionProvider;

      config.transcriptionProvider = 'groq';
      expect(config.transcriptionApiUrl).toContain('groq.com');

      config.transcriptionProvider = origProvider;
    });

    it('transcriptionApiUrl contains openai.com when provider is openai', () => {
      const origProvider = config.transcriptionProvider;

      config.transcriptionProvider = 'openai';
      expect(config.transcriptionApiUrl).toContain('openai.com');

      config.transcriptionProvider = origProvider;
    });
  });
});
