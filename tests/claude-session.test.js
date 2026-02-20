import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { ClaudeSession, formatToolDescription } from '../src/claude-session.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

describe('ClaudeSession', () => {
  let session;

  beforeEach(() => {
    session = new ClaudeSession({ workDir: '/test/dir' });
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('sets workDir', () => {
      expect(session.workDir).toBe('/test/dir');
    });

    it('defaults permissionMode to default', () => {
      expect(session.getPermissionMode()).toBe('default');
    });

    it('starts with no session ID', () => {
      expect(session.sessionId).toBeNull();
    });

    it('starts not running', () => {
      expect(session.isRunning).toBe(false);
    });
  });

  describe('setPermissionMode', () => {
    it('changes the permission mode', () => {
      session.setPermissionMode('plan');
      expect(session.getPermissionMode()).toBe('plan');
    });

    it('clears session-allowed tools on mode change', async () => {
      // Build up a session-allowed tool via allowSession
      query.mockImplementation(({ options }) => {
        return (async function* () {
          await options.canUseTool(
            'Bash',
            { command: 'ls' },
            { signal: new AbortController().signal },
          );
        })();
      });

      const execPromise = session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 10));
      session.resolvePermission({ action: 'allowSession' });
      await execPromise;

      // Now change mode — session-allowed tools should be cleared
      session.setPermissionMode('plan');

      // Verify Bash is no longer auto-approved by running another execution
      let permissionRequested = false;
      query.mockImplementation(({ options }) => {
        return (async function* () {
          await options.canUseTool(
            'Bash',
            { command: 'ls' },
            { signal: new AbortController().signal },
          );
        })();
      });

      const execPromise2 = session.execute('test2', {
        onChunk: vi.fn(),
        onPermissionRequest: () => {
          permissionRequested = true;
        },
        onAskUser: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 10));
      session.resolvePermission({ action: 'allow' });
      await execPromise2;

      expect(permissionRequested).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears session ID after it was set', async () => {
      async function* mockGen() {
        yield { type: 'system', subtype: 'init', session_id: 'some-session' };
      }
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });
      expect(session.sessionId).toBe('some-session');

      session.reset();
      expect(session.sessionId).toBeNull();
    });

    it('clears running state', () => {
      session.reset();
      expect(session.isRunning).toBe(false);
    });

    it('resets permission mode to default', () => {
      session.setPermissionMode('plan');
      session.reset();
      expect(session.getPermissionMode()).toBe('default');
    });
  });

  describe('cancel', () => {
    it('returns false when not running', () => {
      expect(session.cancel()).toBe(false);
    });

    it('returns true when running and aborts', async () => {
      // Use the session's own abort signal so cancel() propagates correctly
      query.mockImplementation(({ options }) => {
        return (async function* () {
          await new Promise((resolve, reject) => {
            options.abortController.signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        })();
      });

      const execPromise = session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(session.isRunning).toBe(true);
      expect(session.cancel()).toBe(true);

      const result = await execPromise;
      expect(result.error).toBe('Cancelled');
    });
  });

  describe('execute', () => {
    it('returns error when already running', async () => {
      let blockResolve;
      query.mockImplementation(() => {
        return (async function* () {
          await new Promise((resolve) => {
            blockResolve = resolve;
          });
        })();
      });

      const firstExec = session.execute('first', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 10));

      const result = await session.execute('second', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already running');

      blockResolve();
      await firstExec;
    });

    it('passes prompt to SDK query', async () => {
      async function* mockGen() {}
      query.mockReturnValue(mockGen());

      await session.execute('hello world', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(query).toHaveBeenCalledOnce();
      const { prompt } = query.mock.calls[0][0];
      expect(prompt).toBe('hello world');
    });

    it('passes permissionMode to SDK options', async () => {
      session.setPermissionMode('plan');
      async function* mockGen() {}
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      const { options } = query.mock.calls[0][0];
      expect(options.permissionMode).toBe('plan');
    });

    it('sets allowDangerouslySkipPermissions in bypass mode', async () => {
      session.setPermissionMode('bypassPermissions');
      async function* mockGen() {}
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      const { options } = query.mock.calls[0][0];
      expect(options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('does not set canUseTool in bypass mode', async () => {
      session.setPermissionMode('bypassPermissions');
      async function* mockGen() {}
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      const { options } = query.mock.calls[0][0];
      expect(options.canUseTool).toBeUndefined();
    });

    it('passes resume session ID when available', async () => {
      // First execution to set session ID
      async function* firstGen() {
        yield { type: 'system', subtype: 'init', session_id: 'prev-session-123' };
      }
      query.mockReturnValue(firstGen());
      await session.execute('first', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      // Second execution should pass resume
      async function* secondGen() {}
      query.mockReturnValue(secondGen());
      await session.execute('second', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      const { options } = query.mock.calls[1][0];
      expect(options.resume).toBe('prev-session-123');
    });

    it('captures session ID from system messages', async () => {
      async function* mockGen() {
        yield { type: 'system', subtype: 'init', session_id: 'new-session-456' };
      }
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(session.sessionId).toBe('new-session-456');
    });

    it('streams text content via onChunk', async () => {
      const chunks = [];
      async function* mockGen() {
        yield {
          type: 'assistant',
          session_id: 'sid',
          message: {
            content: [{ type: 'text', text: 'Hello world' }],
          },
        };
      }
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: (chunk) => chunks.push(chunk),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(chunks).toEqual(['Hello world']);
    });

    it('coalesces consecutive tool use into summary', async () => {
      const chunks = [];
      async function* mockGen() {
        yield {
          type: 'assistant',
          session_id: 'sid',
          message: {
            content: [{ type: 'tool_use', name: 'Read' }],
          },
        };
        yield {
          type: 'assistant',
          session_id: 'sid',
          message: {
            content: [{ type: 'tool_use', name: 'Bash' }],
          },
        };
        yield {
          type: 'assistant',
          session_id: 'sid',
          message: {
            content: [{ type: 'text', text: 'Done!' }],
          },
        };
      }
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: (chunk) => chunks.push(chunk),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(chunks).toEqual(['\n[Tools: Read, Bash]\n', 'Done!']);
    });

    it('uses singular format for single tool', async () => {
      const chunks = [];
      async function* mockGen() {
        yield {
          type: 'assistant',
          session_id: 'sid',
          message: {
            content: [{ type: 'tool_use', name: 'Read' }],
          },
        };
        yield {
          type: 'assistant',
          session_id: 'sid',
          message: {
            content: [{ type: 'text', text: 'Result' }],
          },
        };
      }
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: (chunk) => chunks.push(chunk),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(chunks[0]).toBe('\n[Using tool: Read]\n');
    });

    it('flushes remaining tools at end of stream', async () => {
      const chunks = [];
      async function* mockGen() {
        yield {
          type: 'assistant',
          session_id: 'sid',
          message: {
            content: [{ type: 'tool_use', name: 'Bash' }],
          },
        };
        yield {
          type: 'assistant',
          session_id: 'sid',
          message: {
            content: [{ type: 'tool_use', name: 'Write' }],
          },
        };
      }
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: (chunk) => chunks.push(chunk),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(chunks).toEqual(['\n[Tools: Bash, Write]\n']);
    });

    it('resets isRunning after execution', async () => {
      async function* mockGen() {}
      query.mockReturnValue(mockGen());

      await session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(session.isRunning).toBe(false);
    });

    it('resets isRunning after error', async () => {
      query.mockImplementation(() => {
        throw new Error('SDK failure');
      });

      const result = await session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(session.isRunning).toBe(false);
      expect(result.success).toBe(false);
    });

    it('handles abort error on cancel', async () => {
      const abortErr = new DOMException('Aborted', 'AbortError');
      async function* mockGen() {
        throw abortErr;
      }
      query.mockReturnValue(mockGen());

      const result = await session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cancelled');
    });
  });

  describe('resolvePermission', () => {
    it('does nothing when no pending permission', () => {
      // Should not throw
      session.resolvePermission({ action: 'allow' });
    });

    it('resolves with allow behavior', async () => {
      let toolResult;
      query.mockImplementation(({ options }) => {
        return (async function* () {
          toolResult = await options.canUseTool(
            'Bash',
            { command: 'ls' },
            { signal: new AbortController().signal },
          );
        })();
      });

      const execPromise = session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 10));
      session.resolvePermission({ action: 'allow' });
      await execPromise;

      expect(toolResult.behavior).toBe('allow');
      expect(toolResult.updatedInput).toEqual({ command: 'ls' });
    });

    it('adds tool to session-allowed on allowSession', async () => {
      let firstResult;
      let secondResult;

      // First execution: approve Read with allowSession
      query.mockImplementation(({ options }) => {
        return (async function* () {
          firstResult = await options.canUseTool(
            'Read',
            { file_path: '/test' },
            { signal: new AbortController().signal },
          );
        })();
      });

      const exec1 = session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 10));
      session.resolvePermission({ action: 'allowSession' });
      await exec1;

      expect(firstResult.behavior).toBe('allow');

      // Second execution: Read should auto-approve without permission request
      let permissionRequested = false;
      query.mockImplementation(({ options }) => {
        return (async function* () {
          secondResult = await options.canUseTool(
            'Read',
            { file_path: '/other' },
            { signal: new AbortController().signal },
          );
        })();
      });

      await session.execute('test2', {
        onChunk: vi.fn(),
        onPermissionRequest: () => {
          permissionRequested = true;
        },
        onAskUser: vi.fn(),
      });

      expect(permissionRequested).toBe(false);
      expect(secondResult.behavior).toBe('allow');
    });

    it('resolves with deny behavior and message', async () => {
      let toolResult;
      query.mockImplementation(({ options }) => {
        return (async function* () {
          toolResult = await options.canUseTool(
            'Bash',
            { command: 'rm -rf /' },
            { signal: new AbortController().signal },
          );
        })();
      });

      const execPromise = session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 10));
      session.resolvePermission({ action: 'deny', message: 'Too dangerous' });
      await execPromise;

      expect(toolResult.behavior).toBe('deny');
      expect(toolResult.message).toBe('Too dangerous');
    });
  });

  describe('resolveUserAnswer', () => {
    it('does nothing when no pending answer', () => {
      session.resolveUserAnswer({ 'Q?': 'A' });
    });

    it('resolves with updated input containing answers', async () => {
      let toolResult;
      const originalInput = { questions: [{ question: 'Which?', options: [] }] };

      query.mockImplementation(({ options }) => {
        return (async function* () {
          toolResult = await options.canUseTool('AskUserQuestion', originalInput, {
            signal: new AbortController().signal,
          });
        })();
      });

      const execPromise = session.execute('test', {
        onChunk: vi.fn(),
        onPermissionRequest: vi.fn(),
        onAskUser: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 10));
      session.resolveUserAnswer({ 'Which?': 'Option A' });
      await execPromise;

      expect(toolResult.behavior).toBe('allow');
      expect(toolResult.updatedInput.answers).toEqual({ 'Which?': 'Option A' });
      expect(toolResult.updatedInput.questions).toEqual(originalInput.questions);
    });
  });
});

describe('formatToolDescription', () => {
  it('formats Bash commands', () => {
    expect(formatToolDescription('Bash', { command: 'npm test' })).toBe('Run: npm test');
  });

  it('formats Edit tool', () => {
    expect(formatToolDescription('Edit', { file_path: '/src/app.js' })).toBe('Edit /src/app.js');
  });

  it('formats Write tool', () => {
    expect(formatToolDescription('Write', { file_path: '/new.js' })).toBe('Write to /new.js');
  });

  it('formats Read tool', () => {
    expect(formatToolDescription('Read', { file_path: '/readme.md' })).toBe('Read /readme.md');
  });

  it('formats unknown tools', () => {
    expect(formatToolDescription('CustomTool', {})).toBe('Use tool: CustomTool');
  });
});

describe('ClaudeSession mode change detection', () => {
  let session;

  beforeEach(() => {
    session = new ClaudeSession({ workDir: '/test/dir' });
    vi.clearAllMocks();
  });

  it('calls onModeChange when ExitPlanMode is used in plan mode', async () => {
    session.setPermissionMode('plan');
    const onModeChange = vi.fn();

    let toolResult;
    query.mockImplementation(({ options }) => {
      return (async function* () {
        toolResult = await options.canUseTool(
          'ExitPlanMode',
          {},
          { signal: new AbortController().signal },
        );
      })();
    });

    await session.execute('test', {
      onChunk: vi.fn(),
      onPermissionRequest: vi.fn(),
      onAskUser: vi.fn(),
      onModeChange,
    });

    expect(toolResult.behavior).toBe('allow');
    expect(session.getPermissionMode()).toBe('default');
    expect(onModeChange).toHaveBeenCalledWith('default');
  });

  it('does not change mode when ExitPlanMode is used outside plan mode', async () => {
    session.setPermissionMode('default');
    const onModeChange = vi.fn();

    let toolResult;
    query.mockImplementation(({ options }) => {
      return (async function* () {
        toolResult = await options.canUseTool(
          'ExitPlanMode',
          {},
          { signal: new AbortController().signal },
        );
      })();
    });

    await session.execute('test', {
      onChunk: vi.fn(),
      onPermissionRequest: vi.fn(),
      onAskUser: vi.fn(),
      onModeChange,
    });

    expect(toolResult.behavior).toBe('allow');
    expect(session.getPermissionMode()).toBe('default');
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('calls onModeChange when EnterPlanMode is used', async () => {
    session.setPermissionMode('default');
    const onModeChange = vi.fn();

    let toolResult;
    query.mockImplementation(({ options }) => {
      return (async function* () {
        toolResult = await options.canUseTool(
          'EnterPlanMode',
          {},
          { signal: new AbortController().signal },
        );
      })();
    });

    await session.execute('test', {
      onChunk: vi.fn(),
      onPermissionRequest: vi.fn(),
      onAskUser: vi.fn(),
      onModeChange,
    });

    expect(toolResult.behavior).toBe('allow');
    expect(session.getPermissionMode()).toBe('plan');
    expect(onModeChange).toHaveBeenCalledWith('plan');
  });

  it('does not change mode when EnterPlanMode is used in plan mode', async () => {
    session.setPermissionMode('plan');
    const onModeChange = vi.fn();

    let toolResult;
    query.mockImplementation(({ options }) => {
      return (async function* () {
        toolResult = await options.canUseTool(
          'EnterPlanMode',
          {},
          { signal: new AbortController().signal },
        );
      })();
    });

    await session.execute('test', {
      onChunk: vi.fn(),
      onPermissionRequest: vi.fn(),
      onAskUser: vi.fn(),
      onModeChange,
    });

    expect(toolResult.behavior).toBe('allow');
    expect(session.getPermissionMode()).toBe('plan');
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('calls onModeChange when system message has different permissionMode', async () => {
    session.setPermissionMode('plan');
    const onModeChange = vi.fn();

    async function* mockGen() {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        permissionMode: 'default',
      };
    }
    query.mockReturnValue(mockGen());

    await session.execute('test', {
      onChunk: vi.fn(),
      onPermissionRequest: vi.fn(),
      onAskUser: vi.fn(),
      onModeChange,
    });

    expect(session.getPermissionMode()).toBe('default');
    expect(onModeChange).toHaveBeenCalledWith('default');
  });

  it('does not call onModeChange when system message has same permissionMode', async () => {
    session.setPermissionMode('default');
    const onModeChange = vi.fn();

    async function* mockGen() {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        permissionMode: 'default',
      };
    }
    query.mockReturnValue(mockGen());

    await session.execute('test', {
      onChunk: vi.fn(),
      onPermissionRequest: vi.fn(),
      onAskUser: vi.fn(),
      onModeChange,
    });

    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('handles missing onModeChange callback gracefully', async () => {
    session.setPermissionMode('plan');

    let toolResult;
    query.mockImplementation(({ options }) => {
      return (async function* () {
        toolResult = await options.canUseTool(
          'ExitPlanMode',
          {},
          { signal: new AbortController().signal },
        );
      })();
    });

    // Should not throw even without onModeChange callback
    await session.execute('test', {
      onChunk: vi.fn(),
      onPermissionRequest: vi.fn(),
      onAskUser: vi.fn(),
      // No onModeChange callback
    });

    expect(toolResult.behavior).toBe('allow');
    expect(session.getPermissionMode()).toBe('default');
  });
});
