import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing server.
// vi.mock factories are hoisted — do not reference outer variables.
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
  createConfig: vi.fn(),
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

import {
  formatWorkDir,
  sendWs,
  broadcastWs,
  handleAudio,
  handleSend,
  handleCancel,
  handleReset,
  handleSetMode,
  handlePermissionResponse,
  handleUserAnswer,
  connectedClients,
  claudeSession,
} from '../src/server.js';
import { config } from '../src/config.js';
import { transcribeAudio } from '../src/transcription.js';
import { cleanupText } from '../src/text-cleanup.js';

function createMockWs(readyState = 1) {
  return {
    readyState,
    OPEN: 1,
    send: vi.fn(),
  };
}

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
    const ws = createMockWs(1);

    sendWs(ws, 'status', { message: 'hello' });

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('status');
    expect(sent.message).toBe('hello');
  });

  it('does not send when socket is not open', () => {
    const ws = createMockWs(3);

    sendWs(ws, 'status', { message: 'hello' });

    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('broadcastWs', () => {
  afterEach(() => {
    connectedClients.clear();
  });

  it('sends to all connected clients', () => {
    const ws1 = createMockWs(1);
    const ws2 = createMockWs(1);
    connectedClients.add(ws1);
    connectedClients.add(ws2);

    broadcastWs('status', { message: 'hello' });

    expect(ws1.send).toHaveBeenCalledOnce();
    expect(ws2.send).toHaveBeenCalledOnce();
    const sent1 = JSON.parse(ws1.send.mock.calls[0][0]);
    const sent2 = JSON.parse(ws2.send.mock.calls[0][0]);
    expect(sent1).toEqual({ type: 'status', message: 'hello' });
    expect(sent2).toEqual({ type: 'status', message: 'hello' });
  });

  it('skips closed clients', () => {
    const wsOpen = createMockWs(1);
    const wsClosed = createMockWs(3);
    connectedClients.add(wsOpen);
    connectedClients.add(wsClosed);

    broadcastWs('status', { message: 'hello' });

    expect(wsOpen.send).toHaveBeenCalledOnce();
    expect(wsClosed.send).not.toHaveBeenCalled();
  });

  it('sends nothing when no clients connected', () => {
    // Should not throw
    broadcastWs('status', { message: 'hello' });
  });
});

describe('handleAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.cleanupEnabled = false;
  });

  it('returns error when audio data is missing', async () => {
    const ws = createMockWs();

    await handleAudio(ws, {});

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
    expect(sent.message).toContain('No audio data');
  });

  it('returns error when mime_type is missing', async () => {
    const ws = createMockWs();

    await handleAudio(ws, { data: 'base64data' });

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
    expect(sent.message).toContain('mime_type');
  });

  it('sends transcription result on success', async () => {
    const ws = createMockWs();
    transcribeAudio.mockResolvedValue({ text: 'hello', success: true });

    await handleAudio(ws, { data: 'aGVsbG8=', mime_type: 'audio/webm' });

    const messages = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(messages.some((m) => m.type === 'status')).toBe(true);
    expect(messages.some((m) => m.type === 'transcription' && m.text === 'hello')).toBe(true);
  });

  it('runs cleanup when enabled', async () => {
    const ws = createMockWs();
    config.cleanupEnabled = true;
    transcribeAudio.mockResolvedValue({ text: 'um hello', success: true });
    cleanupText.mockResolvedValue({
      text: 'hello',
      original: 'um hello',
      success: true,
    });

    await handleAudio(ws, { data: 'aGVsbG8=', mime_type: 'audio/webm' });

    expect(cleanupText).toHaveBeenCalledWith('um hello');
    const messages = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(messages.some((m) => m.type === 'cleanup' && m.text === 'hello')).toBe(true);
  });

  it('does not run cleanup when transcription fails', async () => {
    const ws = createMockWs();
    config.cleanupEnabled = true;
    transcribeAudio.mockResolvedValue({ text: '', success: false, error: 'failed' });

    await handleAudio(ws, { data: 'aGVsbG8=', mime_type: 'audio/webm' });

    expect(cleanupText).not.toHaveBeenCalled();
  });
});

describe('handleSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectedClients.clear();
  });

  afterEach(() => {
    connectedClients.clear();
  });

  it('returns error for empty text', async () => {
    const ws = createMockWs();

    await handleSend(ws, { text: '' });

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
    expect(sent.message).toContain('Empty command');
  });

  it('returns error for non-string text', async () => {
    const ws = createMockWs();

    await handleSend(ws, { text: 123 });

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
  });

  it('calls claudeSession.execute with trimmed text', async () => {
    const ws = createMockWs();
    connectedClients.add(ws);
    claudeSession.execute.mockResolvedValue({ success: true, output: 'done' });

    await handleSend(ws, { text: '  hello  ' });

    expect(claudeSession.execute).toHaveBeenCalledOnce();
    const [prompt] = claudeSession.execute.mock.calls[0];
    expect(prompt).toBe('hello');
  });

  it('broadcasts chunks to all connected clients', async () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    connectedClients.add(ws1);
    connectedClients.add(ws2);

    claudeSession.execute.mockImplementation(async (text, { onChunk }) => {
      onChunk('Hello');
      return { success: true, output: 'Hello' };
    });

    await handleSend(ws1, { text: 'test' });

    const msgs1 = ws1.send.mock.calls.map((c) => JSON.parse(c[0]));
    const msgs2 = ws2.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs1.some((m) => m.type === 'claude_chunk' && m.text === 'Hello')).toBe(true);
    expect(msgs2.some((m) => m.type === 'claude_chunk' && m.text === 'Hello')).toBe(true);
  });

  it('broadcasts claude_done to all connected clients', async () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    connectedClients.add(ws1);
    connectedClients.add(ws2);

    claudeSession.execute.mockResolvedValue({ success: true, output: 'done' });

    await handleSend(ws1, { text: 'test' });

    const msgs1 = ws1.send.mock.calls.map((c) => JSON.parse(c[0]));
    const msgs2 = ws2.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs1.some((m) => m.type === 'claude_done' && m.success === true)).toBe(true);
    expect(msgs2.some((m) => m.type === 'claude_done' && m.success === true)).toBe(true);
  });
});

describe('handleCancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectedClients.clear();
  });

  afterEach(() => {
    connectedClients.clear();
  });

  it('broadcasts cancel status when command was running', () => {
    const ws = createMockWs();
    connectedClients.add(ws);
    claudeSession.cancel.mockReturnValue(true);

    handleCancel(ws);

    const msgs = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs.some((m) => m.type === 'status' && m.message.includes('cancelled'))).toBe(true);
  });

  it('sends nothing-to-cancel only to requesting client', () => {
    const ws = createMockWs();
    const ws2 = createMockWs();
    connectedClients.add(ws);
    connectedClients.add(ws2);
    claudeSession.cancel.mockReturnValue(false);

    handleCancel(ws);

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('status');
    expect(sent.message).toContain('Nothing to cancel');
    expect(ws2.send).not.toHaveBeenCalled();
  });
});

describe('handleReset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectedClients.clear();
  });

  afterEach(() => {
    connectedClients.clear();
  });

  it('calls claudeSession.reset', () => {
    const ws = createMockWs();
    connectedClients.add(ws);

    handleReset(ws);

    expect(claudeSession.reset).toHaveBeenCalledOnce();
  });

  it('broadcasts reset status to all clients', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    connectedClients.add(ws1);
    connectedClients.add(ws2);

    handleReset(ws1);

    const msgs1 = ws1.send.mock.calls.map((c) => JSON.parse(c[0]));
    const msgs2 = ws2.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs1.some((m) => m.type === 'status' && m.message.includes('reset'))).toBe(true);
    expect(msgs2.some((m) => m.type === 'status' && m.message.includes('reset'))).toBe(true);
  });
});

describe('handleSetMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectedClients.clear();
  });

  afterEach(() => {
    connectedClients.clear();
  });

  it('sets valid mode and broadcasts', () => {
    const ws = createMockWs();
    connectedClients.add(ws);

    handleSetMode(ws, { mode: 'plan' });

    expect(claudeSession.setPermissionMode).toHaveBeenCalledWith('plan');
    const msgs = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs.some((m) => m.type === 'mode_changed' && m.mode === 'plan')).toBe(true);
  });

  it('rejects invalid mode', () => {
    const ws = createMockWs();

    handleSetMode(ws, { mode: 'invalid' });

    expect(claudeSession.setPermissionMode).not.toHaveBeenCalled();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
    expect(sent.message).toContain('Invalid mode');
  });

  it('rejects non-string mode', () => {
    const ws = createMockWs();

    handleSetMode(ws, { mode: 42 });

    expect(claudeSession.setPermissionMode).not.toHaveBeenCalled();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
  });

  it('accepts all valid modes', () => {
    for (const mode of ['default', 'plan', 'bypassPermissions']) {
      const ws = createMockWs();
      connectedClients.add(ws);
      vi.clearAllMocks();

      handleSetMode(ws, { mode });

      expect(claudeSession.setPermissionMode).toHaveBeenCalledWith(mode);
    }
    connectedClients.clear();
  });
});

describe('handlePermissionResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards valid allow action', () => {
    const ws = createMockWs();

    handlePermissionResponse(ws, { action: 'allow' });

    expect(claudeSession.resolvePermission).toHaveBeenCalledWith({
      action: 'allow',
      message: undefined,
    });
  });

  it('forwards deny action with message', () => {
    const ws = createMockWs();

    handlePermissionResponse(ws, { action: 'deny', message: 'too dangerous' });

    expect(claudeSession.resolvePermission).toHaveBeenCalledWith({
      action: 'deny',
      message: 'too dangerous',
    });
  });

  it('forwards allowSession action', () => {
    const ws = createMockWs();

    handlePermissionResponse(ws, { action: 'allowSession' });

    expect(claudeSession.resolvePermission).toHaveBeenCalledWith({
      action: 'allowSession',
      message: undefined,
    });
  });

  it('rejects invalid action', () => {
    const ws = createMockWs();

    handlePermissionResponse(ws, { action: 'invalid' });

    expect(claudeSession.resolvePermission).not.toHaveBeenCalled();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
    expect(sent.message).toContain('Invalid permission action');
  });

  it('rejects missing action', () => {
    const ws = createMockWs();

    handlePermissionResponse(ws, {});

    expect(claudeSession.resolvePermission).not.toHaveBeenCalled();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
  });

  it('ignores non-string message', () => {
    const ws = createMockWs();

    handlePermissionResponse(ws, { action: 'deny', message: 123 });

    expect(claudeSession.resolvePermission).toHaveBeenCalledWith({
      action: 'deny',
      message: undefined,
    });
  });
});

describe('handleUserAnswer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards valid answers object', () => {
    const ws = createMockWs();
    const answers = { 'Which option?': 'Option A' };

    handleUserAnswer(ws, { answers });

    expect(claudeSession.resolveUserAnswer).toHaveBeenCalledWith(answers);
  });

  it('rejects missing answers', () => {
    const ws = createMockWs();

    handleUserAnswer(ws, {});

    expect(claudeSession.resolveUserAnswer).not.toHaveBeenCalled();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
    expect(sent.message).toContain('Invalid answers');
  });

  it('rejects array answers', () => {
    const ws = createMockWs();

    handleUserAnswer(ws, { answers: ['a', 'b'] });

    expect(claudeSession.resolveUserAnswer).not.toHaveBeenCalled();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('error');
  });

  it('rejects null answers', () => {
    const ws = createMockWs();

    handleUserAnswer(ws, { answers: null });

    expect(claudeSession.resolveUserAnswer).not.toHaveBeenCalled();
  });
});
