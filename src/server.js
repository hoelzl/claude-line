/**
 * Claude Line — Express + WebSocket server.
 *
 * Serves the mobile web UI and handles WebSocket communication
 * for audio recording, transcription, and Claude Code interaction.
 */

import { readFileSync } from 'fs';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import { WebSocketServer } from 'ws';

import { ClaudeSession } from './claude-session.js';
import { config } from './config.js';
import { cleanupText } from './text-cleanup.js';
import { transcribeAudio } from './transcription.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Format a working directory path for compact display.
 * Shows the last 2 path components, prefixed with .../ for longer paths.
 *
 * @param {string} fullPath
 * @returns {string}
 */
export function formatWorkDir(fullPath) {
  // Normalize separators to forward slashes for splitting
  const normalized = fullPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) {
    return fullPath;
  }
  return `.../${parts.slice(-2).join('/')}`;
}

/**
 * Create and configure the Express app and WebSocket server.
 *
 * @returns {{ app: express.Express, server: import('http').Server, wss: WebSocketServer }}
 */
export function createApp() {
  const app = express();

  // Serve static files
  const staticDir = join(__dirname, 'static');
  app.use('/static', express.static(staticDir));

  // Serve index.html at root
  app.get('/', (req, res) => {
    res.sendFile(join(staticDir, 'index.html'));
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      transcription_provider: config.transcriptionProvider,
      cleanup_enabled: config.cleanupEnabled,
      work_dir: config.claudeWorkDir,
      session_active: claudeSession.sessionId !== null,
    });
  });

  // Create HTTP or HTTPS server
  let server;
  if (config.sslEnabled) {
    server = createHttpsServer(
      {
        cert: readFileSync(config.sslCertfile),
        key: readFileSync(config.sslKeyfile),
      },
      app,
    );
  } else {
    server = createHttpServer(app);
  }

  // WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', handleConnection);

  return { app, server, wss };
}

// One Claude session per server (single-user tool)
const claudeSession = new ClaudeSession({
  workDir: config.claudeWorkDir,
});

export { claudeSession };

/**
 * Send a typed JSON message over WebSocket.
 *
 * @param {import('ws').WebSocket} ws
 * @param {string} type
 * @param {object} data
 */
function sendWs(ws, type, data = {}) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

export { sendWs };

/**
 * Handle a new WebSocket connection.
 *
 * @param {import('ws').WebSocket} ws
 */
function handleConnection(ws) {
  console.log('WebSocket client connected');

  // Send initial config
  sendWs(ws, 'config', {
    work_dir: claudeSession.workDir,
    work_dir_display: formatWorkDir(claudeSession.workDir),
    permission_mode: claudeSession.getPermissionMode(),
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendWs(ws, 'error', { message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'audio':
        handleAudio(ws, msg);
        break;
      case 'send':
        handleSend(ws, msg);
        break;
      case 'cancel':
        handleCancel(ws);
        break;
      case 'reset':
        handleReset(ws);
        break;
      case 'set_mode':
        handleSetMode(ws, msg);
        break;
      case 'permission_response':
        handlePermissionResponse(ws, msg);
        break;
      case 'user_answer':
        handleUserAnswer(ws, msg);
        break;
      default:
        sendWs(ws, 'error', { message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
}

/**
 * Handle incoming audio data — transcribe and optionally clean up.
 */
async function handleAudio(ws, msg) {
  const audioB64 = msg.data || '';
  const mimeType = msg.mime_type || 'audio/webm';

  if (!audioB64) {
    sendWs(ws, 'error', { message: 'No audio data received' });
    return;
  }

  sendWs(ws, 'status', { message: 'Transcribing...' });

  let audioBuffer;
  try {
    audioBuffer = Buffer.from(audioB64, 'base64');
  } catch {
    sendWs(ws, 'error', { message: 'Invalid base64 audio data' });
    return;
  }

  // Step 1: Transcribe
  const result = await transcribeAudio(audioBuffer, mimeType);
  sendWs(ws, 'transcription', result);

  if (!result.success || !result.text) {
    return;
  }

  // Step 2: Cleanup (if enabled)
  if (config.cleanupEnabled) {
    sendWs(ws, 'status', { message: 'Cleaning up text...' });
    const cleanupResult = await cleanupText(result.text);
    sendWs(ws, 'cleanup', cleanupResult);
  }
}

/**
 * Send a command to Claude Code and stream the response.
 */
async function handleSend(ws, msg) {
  const text = (msg.text || '').trim();
  if (!text) {
    sendWs(ws, 'error', { message: 'Empty command' });
    return;
  }

  sendWs(ws, 'status', { message: 'Running Claude Code...' });

  const result = await claudeSession.execute(text, {
    onChunk: (chunk) => {
      sendWs(ws, 'claude_chunk', { text: chunk });
    },
    onPermissionRequest: (req) => {
      sendWs(ws, 'permission_request', req);
    },
    onAskUser: (req) => {
      sendWs(ws, 'ask_user', req);
    },
    onModeChange: (mode) => {
      sendWs(ws, 'mode_changed', { mode });
    },
  });

  sendWs(ws, 'claude_done', result);
}

/**
 * Cancel the running Claude Code command.
 */
function handleCancel(ws) {
  const cancelled = claudeSession.cancel();
  if (cancelled) {
    sendWs(ws, 'status', { message: 'Command cancelled', auto_dismiss: 2000 });
  } else {
    sendWs(ws, 'status', { message: 'Nothing to cancel', auto_dismiss: 2000 });
  }
}

/**
 * Reset the Claude Code session.
 */
function handleReset(ws) {
  claudeSession.reset();
  sendWs(ws, 'status', {
    message: 'Session reset — starting fresh conversation',
    auto_dismiss: 2000,
  });
}

/**
 * Change the permission mode.
 */
function handleSetMode(ws, msg) {
  const mode = msg.mode;
  const validModes = ['default', 'plan', 'bypassPermissions'];
  if (!validModes.includes(mode)) {
    sendWs(ws, 'error', { message: `Invalid mode: ${mode}` });
    return;
  }
  claudeSession.setPermissionMode(mode);
  sendWs(ws, 'mode_changed', { mode });
}

/**
 * Handle a permission response from the frontend.
 */
function handlePermissionResponse(ws, msg) {
  claudeSession.resolvePermission({
    action: msg.action,
    message: msg.message,
  });
}

/**
 * Handle a user answer to an AskUserQuestion.
 */
function handleUserAnswer(ws, msg) {
  claudeSession.resolveUserAnswer(msg.answers || {});
}

export {
  handleAudio,
  handleCancel,
  handleReset,
  handleSend,
  handleSetMode,
  handlePermissionResponse,
  handleUserAnswer,
};

/**
 * Start the server.
 */
export function startServer() {
  const { server } = createApp();
  const protocol = config.sslEnabled ? 'https' : 'http';

  server.listen(config.port, config.host, () => {
    console.log(`Starting Claude Line on ${config.host}:${config.port}`);
    console.log(`Transcription provider: ${config.transcriptionProvider}`);
    console.log(`Claude Code work dir: ${config.claudeWorkDir}`);
    console.log(`Text cleanup: ${config.cleanupEnabled ? 'enabled' : 'disabled'}`);
    console.log(`Open ${protocol}://<your-ip>:${config.port} on your phone`);
  });
}

// Run if executed directly
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  startServer();
}
