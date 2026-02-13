import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config
vi.mock('../src/config.js', () => ({
  config: {
    cleanupEnabled: false,
    cleanupProvider: 'anthropic',
    anthropicApiKey: 'test-anthropic-key',
    openaiApiKey: 'test-openai-key',
    cleanupModel: 'claude-sonnet-4-20250514',
  },
}));

import { cleanupText } from '../src/text-cleanup.js';
import { config } from '../src/config.js';

describe('cleanupText', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    config.cleanupEnabled = false;
    config.cleanupProvider = 'anthropic';
    config.anthropicApiKey = 'test-anthropic-key';
    config.openaiApiKey = 'test-openai-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when disabled', () => {
    it('returns original text', async () => {
      const result = await cleanupText('hello world');
      expect(result.text).toBe('hello world');
    });

    it('returns original in original field', async () => {
      const result = await cleanupText('some text');
      expect(result.original).toBe('some text');
    });

    it('reports success', async () => {
      const result = await cleanupText('test input');
      expect(result.success).toBe(true);
    });

    it('reports skipped', async () => {
      const result = await cleanupText('test input');
      expect(result.skipped).toBe(true);
    });

    it('handles empty string', async () => {
      const result = await cleanupText('');
      expect(result.text).toBe('');
      expect(result.success).toBe(true);
    });
  });

  describe('anthropic cleanup', () => {
    beforeEach(() => {
      config.cleanupEnabled = true;
      config.cleanupProvider = 'anthropic';
    });

    it('calls anthropic API on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: 'cleaned text' }],
        }),
      });

      const result = await cleanupText('um so like hello');

      expect(result.success).toBe(true);
      expect(result.text).toBe('cleaned text');
      expect(result.original).toBe('um so like hello');
    });

    it('returns error when API key missing', async () => {
      config.anthropicApiKey = '';

      const result = await cleanupText('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('ANTHROPIC_API_KEY');
      expect(result.text).toBe('test');
    });

    it('returns original text on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const result = await cleanupText('hello');

      expect(result.success).toBe(false);
      expect(result.text).toBe('hello');
    });
  });

  describe('openai cleanup', () => {
    beforeEach(() => {
      config.cleanupEnabled = true;
      config.cleanupProvider = 'openai';
    });

    it('calls openai API on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'cleaned text' } }],
        }),
      });

      const result = await cleanupText('um hello');

      expect(result.success).toBe(true);
      expect(result.text).toBe('cleaned text');
    });

    it('returns error when API key missing', async () => {
      config.openaiApiKey = '';

      const result = await cleanupText('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('OPENAI_API_KEY');
    });
  });

  describe('unknown provider', () => {
    it('returns error for unknown provider', async () => {
      config.cleanupEnabled = true;
      config.cleanupProvider = 'unknown';

      const result = await cleanupText('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown cleanup provider');
    });
  });
});
