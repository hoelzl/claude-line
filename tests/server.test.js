import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing server
vi.mock('../src/config.js', () => ({
  config: {
    host: '0.0.0.0',
    port: 8765,
    transcriptionProvider: 'groq',
    cleanupEnabled: false,
    claudeWorkDir: '/home/user/projects/my-app',
    sslEnabled: false,
    sslCertfile: '',
    sslKeyfile: '',
  },
}));

vi.mock('../src/transcription.js', () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock('../src/text-cleanup.js', () => ({
  cleanupText: vi.fn(),
}));

vi.mock('../src/claude-session.js', () => {
  const ClaudeSession = vi.fn().mockImplementation(() => ({
    workDir: '/home/user/projects/my-app',
    sessionId: null,
    isRunning: false,
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    execute: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    resolvePermission: vi.fn(),
    resolveUserAnswer: vi.fn(),
  }));
  return { ClaudeSession };
});

import { formatWorkDir, sendWs } from '../src/server.js';

describe('formatWorkDir', () => {
  it('returns short path as-is', () => {
    expect(formatWorkDir('/home')).toBe('/home');
  });

  it('shows last two components for long path', () => {
    const result = formatWorkDir('/home/user/projects/my-app');
    expect(result).toBe('.../projects/my-app');
  });

  it('shows last two components for three-part path', () => {
    const result = formatWorkDir('/home/user/code');
    expect(result).toBe('.../user/code');
  });

  it('returns root path as-is', () => {
    expect(formatWorkDir('/')).toBe('/');
  });

  it('handles Windows-style paths', () => {
    const result = formatWorkDir('C:\\Users\\tc\\Projects\\my-app');
    expect(result).toBe('.../Projects/my-app');
  });
});

describe('sendWs', () => {
  it('sends JSON message when socket is open', () => {
    const ws = {
      readyState: 1, // WebSocket.OPEN
      OPEN: 1,
      send: vi.fn(),
    };

    sendWs(ws, 'status', { message: 'hello' });

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('status');
    expect(sent.message).toBe('hello');
  });

  it('does not send when socket is not open', () => {
    const ws = {
      readyState: 3, // WebSocket.CLOSED
      OPEN: 1,
      send: vi.fn(),
    };

    sendWs(ws, 'status', { message: 'hello' });

    expect(ws.send).not.toHaveBeenCalled();
  });
});
