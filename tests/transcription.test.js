import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config before importing transcription
vi.mock('../src/config.js', () => ({
  config: {
    transcriptionProvider: 'groq',
    groqApiKey: 'test-groq-key',
    openaiApiKey: 'test-openai-key',
    whisperModel: 'whisper-large-v3-turbo',
    get transcriptionApiKey() {
      return this.transcriptionProvider === 'groq' ? this.groqApiKey : this.openaiApiKey;
    },
    get transcriptionApiUrl() {
      return this.transcriptionProvider === 'groq'
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';
    },
  },
}));

import { transcribeAudio } from '../src/transcription.js';
import { config } from '../src/config.js';

describe('transcribeAudio', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    config.groqApiKey = 'test-groq-key';
    config.openaiApiKey = 'test-openai-key';
    config.transcriptionProvider = 'groq';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error when no API key is set', async () => {
    config.groqApiKey = '';

    const result = await transcribeAudio(Buffer.from('audio'), 'audio/webm');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No API key');
    expect(result.error).toContain('GROQ_API_KEY');
  });

  it('returns error with OPENAI_API_KEY hint when provider is openai', async () => {
    config.transcriptionProvider = 'openai';
    config.openaiApiKey = '';

    const result = await transcribeAudio(Buffer.from('audio'), 'audio/webm');

    expect(result.success).toBe(false);
    expect(result.error).toContain('OPENAI_API_KEY');
  });

  it('calls groq API with correct URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello world' }),
    });

    await transcribeAudio(Buffer.from('audio'), 'audio/webm');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('groq.com');
  });

  it('calls openai API when provider is openai', async () => {
    config.transcriptionProvider = 'openai';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello world' }),
    });

    await transcribeAudio(Buffer.from('audio'), 'audio/webm');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('openai.com');
  });

  it('returns transcribed text on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: '  hello world  ' }),
    });

    const result = await transcribeAudio(Buffer.from('audio'), 'audio/webm');

    expect(result.success).toBe(true);
    expect(result.text).toBe('hello world');
  });

  it('returns error on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const result = await transcribeAudio(Buffer.from('audio'), 'audio/webm');

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('Unauthorized');
  });

  it('returns error on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await transcribeAudio(Buffer.from('audio'), 'audio/webm');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('sends Authorization header with API key', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'test' }),
    });

    await transcribeAudio(Buffer.from('audio'), 'audio/webm');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer test-groq-key');
  });
});
