/**
 * Claude Agent SDK wrapper.
 *
 * Manages a Claude Code session with interactive tool approval,
 * AskUserQuestion handling, streaming output, and session resume.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

/**
 * Format a human-readable description of what a tool wants to do.
 *
 * @param {string} toolName
 * @param {object} input
 * @returns {string}
 */
function formatToolDescription(toolName, input) {
  switch (toolName) {
    case 'Bash':
      return `Run: ${input.command || '(no command)'}`;
    case 'Edit':
      return `Edit ${input.file_path || 'file'}`;
    case 'Write':
      return `Write to ${input.file_path || 'file'}`;
    case 'Read':
      return `Read ${input.file_path || 'file'}`;
    case 'Glob':
      return `Search files: ${input.pattern || ''}`;
    case 'Grep':
      return `Search content: ${input.pattern || ''}`;
    case 'WebFetch':
      return `Fetch URL: ${input.url || ''}`;
    case 'WebSearch':
      return `Search web: ${input.query || ''}`;
    case 'NotebookEdit':
      return `Edit notebook: ${input.notebook_path || 'file'}`;
    case 'Task':
      return `Launch agent: ${input.description || ''}`;
    default:
      return `Use tool: ${toolName}`;
  }
}

export class ClaudeSession {
  /**
   * @param {object} options
   * @param {string} options.workDir - Working directory for Claude Code.
   * @param {string} [options.permissionMode='default'] - Initial permission mode.
   */
  constructor({ workDir, permissionMode = 'default' }) {
    this.workDir = workDir;
    this._permissionMode = permissionMode;
    this._sessionId = null;
    this._isRunning = false;
    this._abortController = null;
    this._pendingPermission = null;
    this._pendingUserAnswer = null;
    this._sessionAllowedTools = new Set();

    // Callbacks set per-execution
    this._onPermissionRequest = null;
    this._onAskUser = null;
    this._onModeChange = null;
  }

  get sessionId() {
    return this._sessionId;
  }

  get isRunning() {
    return this._isRunning;
  }

  getPermissionMode() {
    return this._permissionMode;
  }

  setPermissionMode(mode) {
    this._permissionMode = mode;
    // Clear session-level allowed tools when mode changes
    this._sessionAllowedTools.clear();
  }

  /**
   * Execute a prompt via the Claude Agent SDK and stream output.
   *
   * @param {string} prompt - The user's instruction.
   * @param {object} callbacks
   * @param {function(string): void} callbacks.onChunk - Called with each text chunk.
   * @param {function(object): void} callbacks.onPermissionRequest - Called when a tool needs approval.
   * @param {function(object): void} callbacks.onAskUser - Called when Claude asks the user a question.
   * @param {function(string): void} [callbacks.onModeChange] - Called when permission mode changes internally.
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute(prompt, { onChunk, onPermissionRequest, onAskUser, onModeChange }) {
    if (this._isRunning) {
      return {
        success: false,
        output: '',
        error: 'A command is already running. Wait for it to finish or cancel it.',
      };
    }

    this._isRunning = true;
    this._abortController = new AbortController();
    this._onPermissionRequest = onPermissionRequest;
    this._onAskUser = onAskUser;
    this._onModeChange = onModeChange;

    const fullOutput = [];
    const pendingTools = [];

    const flushTools = () => {
      if (pendingTools.length > 0) {
        const summary = this._formatToolsSummary(pendingTools);
        fullOutput.push(summary);
        onChunk(summary);
        pendingTools.length = 0;
      }
    };

    try {
      const options = {
        abortController: this._abortController,
        cwd: this.workDir,
        permissionMode: this._permissionMode,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
        },
        tools: {
          type: 'preset',
          preset: 'claude_code',
        },
        settingSources: ['user', 'project', 'local'],
      };

      if (this._permissionMode === 'bypassPermissions') {
        options.allowDangerouslySkipPermissions = true;
      }

      // Wire up canUseTool for interactive permissions (not in bypass mode)
      if (this._permissionMode !== 'bypassPermissions') {
        options.canUseTool = async (toolName, input, { signal }) => {
          return this._canUseTool(toolName, input, signal);
        };
      }

      if (this._sessionId) {
        options.resume = this._sessionId;
      }

      const conversation = query({ prompt, options });

      for await (const message of conversation) {
        // Capture session ID from system init or result
        if (message.session_id) {
          this._sessionId = message.session_id;
        }

        // Check for permission mode changes in system messages
        if (message.type === 'system' && message.permissionMode) {
          const newMode = message.permissionMode;
          if (newMode !== this._permissionMode) {
            this._permissionMode = newMode;
            if (this._onModeChange) {
              this._onModeChange(newMode);
            }
          }
        }

        if (message.type === 'assistant') {
          const content = message.message?.content;
          if (!content) continue;

          const textParts = [];
          const toolNames = [];

          for (const block of content) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            } else if (block.type === 'tool_use' && block.name) {
              toolNames.push(block.name);
            }
          }

          if (toolNames.length > 0) {
            pendingTools.push(...toolNames);
          }

          if (textParts.length > 0) {
            flushTools();
            const text = textParts.join('');
            fullOutput.push(text);
            onChunk(text);
          }
        }

        if (message.type === 'result') {
          flushTools();
          if (message.result && message.subtype === 'success') {
            // Only emit result text if we haven't already streamed it
            if (fullOutput.length === 0) {
              fullOutput.push(message.result);
              onChunk(message.result);
            }
          }

          if (message.is_error || message.subtype !== 'success') {
            const errors = message.errors || [];
            const errorMsg = errors.join('\n') || `Claude Code error: ${message.subtype}`;
            return {
              success: false,
              output: fullOutput.join(''),
              error: errorMsg,
            };
          }
        }
      }

      // Flush any remaining tools
      flushTools();

      return { success: true, output: fullOutput.join('') };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, output: fullOutput.join(''), error: 'Cancelled' };
      }
      return {
        success: false,
        output: fullOutput.join(''),
        error: `Error running Claude Code: ${err.message}`,
      };
    } finally {
      this._isRunning = false;
      this._abortController = null;
      this._pendingPermission = null;
      this._pendingUserAnswer = null;
      this._onPermissionRequest = null;
      this._onAskUser = null;
      this._onModeChange = null;
    }
  }

  /**
   * Internal canUseTool callback for the SDK.
   *
   * @param {string} toolName
   * @param {object} input
   * @param {AbortSignal} signal
   * @returns {Promise<{behavior: string, updatedInput?: object, message?: string}>}
   */
  async _canUseTool(toolName, input, signal) {
    // Handle AskUserQuestion specially — forward the question to the frontend
    if (toolName === 'AskUserQuestion') {
      return this._handleAskUser(input, signal);
    }

    // Handle ExitPlanMode — update mode and notify frontend
    if (toolName === 'ExitPlanMode') {
      // ExitPlanMode transitions from plan mode to default mode
      if (this._permissionMode === 'plan') {
        this._permissionMode = 'default';
        if (this._onModeChange) {
          this._onModeChange('default');
        }
      }
      // Always allow ExitPlanMode
      return { behavior: 'allow', updatedInput: input };
    }

    // Handle EnterPlanMode — update mode and notify frontend
    if (toolName === 'EnterPlanMode') {
      // EnterPlanMode transitions to plan mode
      if (this._permissionMode !== 'plan') {
        this._permissionMode = 'plan';
        if (this._onModeChange) {
          this._onModeChange('plan');
        }
      }
      // Always allow EnterPlanMode
      return { behavior: 'allow', updatedInput: input };
    }

    // If this tool was session-approved, auto-allow
    if (this._sessionAllowedTools.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }

    const description = formatToolDescription(toolName, input);

    // Send permission request to frontend and wait for response
    return new Promise((resolve, reject) => {
      this._pendingPermission = { resolve, toolName, input };

      // If the signal is already aborted, reject immediately
      if (signal.aborted) {
        this._pendingPermission = null;
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const onAbort = () => {
        this._pendingPermission = null;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      if (this._onPermissionRequest) {
        this._onPermissionRequest({ toolName, input, description });
      }
    });
  }

  /**
   * Handle AskUserQuestion tool — forward to frontend and wait for answer.
   *
   * @param {object} input - The AskUserQuestion input with questions array.
   * @param {AbortSignal} signal
   * @returns {Promise<{behavior: string, updatedInput: object}>}
   */
  async _handleAskUser(input, signal) {
    return new Promise((resolve, reject) => {
      this._pendingUserAnswer = { resolve, input };

      if (signal.aborted) {
        this._pendingUserAnswer = null;
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const onAbort = () => {
        this._pendingUserAnswer = null;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      if (this._onAskUser) {
        this._onAskUser({ questions: input.questions });
      }
    });
  }

  /**
   * Resolve a pending permission request from the frontend.
   *
   * @param {object} response
   * @param {string} response.action - "allow", "allowSession", or "deny"
   * @param {string} [response.message] - Custom deny message
   */
  resolvePermission(response) {
    if (!this._pendingPermission) return;

    const { resolve, toolName, input } = this._pendingPermission;
    this._pendingPermission = null;

    switch (response.action) {
      case 'allow':
        resolve({ behavior: 'allow', updatedInput: input });
        break;
      case 'allowSession':
        this._sessionAllowedTools.add(toolName);
        resolve({ behavior: 'allow', updatedInput: input });
        break;
      case 'deny':
        resolve({
          behavior: 'deny',
          message: response.message || 'User denied',
        });
        break;
      default:
        resolve({ behavior: 'deny', message: 'Unknown action' });
    }
  }

  /**
   * Resolve a pending AskUserQuestion from the frontend.
   *
   * @param {Record<string, string>} answers - Map of question text to selected answer.
   */
  resolveUserAnswer(answers) {
    if (!this._pendingUserAnswer) return;

    const { resolve, input } = this._pendingUserAnswer;
    this._pendingUserAnswer = null;

    resolve({
      behavior: 'allow',
      updatedInput: { ...input, answers },
    });
  }

  /**
   * Cancel the currently running command.
   *
   * @returns {boolean} Whether a command was cancelled.
   */
  cancel() {
    if (this._abortController && this._isRunning) {
      this._abortController.abort();
      return true;
    }
    return false;
  }

  /**
   * Reset the session (start fresh conversation).
   */
  reset() {
    this._sessionId = null;
    this._isRunning = false;
    this._abortController = null;
    this._pendingPermission = null;
    this._pendingUserAnswer = null;
    this._sessionAllowedTools.clear();
    this._permissionMode = 'default';
  }

  /**
   * Format tool names into a summary string (matches Python behavior).
   *
   * @param {string[]} toolNames
   * @returns {string}
   */
  _formatToolsSummary(toolNames) {
    if (toolNames.length === 1) {
      return `\n[Using tool: ${toolNames[0]}]\n`;
    }
    return `\n[Tools: ${toolNames.join(', ')}]\n`;
  }
}

export { formatToolDescription };
