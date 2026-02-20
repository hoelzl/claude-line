# Claude Voice Bridge

## Project Overview

A voice-first mobile interface for driving Claude Code from a phone/tablet. The user speaks commands on their phone, audio is transcribed via Whisper (Groq or OpenAI API), the user reviews/edits the transcription, then sends it to Claude Code via the Agent SDK. Output streams back to the phone in real time. Interactive tool approval and mode switching (Plan/Code/YOLO) are supported.

## Architecture

```
Phone browser → WebSocket → Node.js server → Whisper API (transcription)
                                            → optional LLM cleanup pass
                                            → Claude Agent SDK
                          ← permission_request ←─┘
                          → permission_response →─┘
                          ← claude_chunk / claude_done
```

Single-user tool. One Claude Code session per server instance. The frontend is a single HTML file with inline CSS/JS served as a static file.

Key insight: the SDK's `canUseTool(toolName, input)` is async. When called, we send a `permission_request` to the phone, show buttons, and `await` the user's response before resolving. This gives true interactive per-tool approval.

## File Structure

```
src/
  server.js              — Express + WebSocket server
  claude-session.js      — Claude Agent SDK wrapper (permissions, streaming, resume)
  transcription.js       — Whisper API integration (Groq and OpenAI)
  text-cleanup.js        — Optional LLM-based spoken→written text conversion
  config.js              — Environment variable configuration
  generate-cert.js       — Self-signed certificate generation for HTTPS
  static/
    index.html           — Mobile-first web UI (inline CSS and JS)
tests/
  config.test.js         — Config module tests
  transcription.test.js  — Transcription module tests
  text-cleanup.test.js   — Text cleanup module tests
  claude-session.test.js — Claude session tests (SDK mocking)
  server.test.js         — Server utility tests
  generate-cert.test.js  — Certificate generation tests
package.json             — Dependencies and scripts
vitest.config.js         — Test configuration
```

## Key Design Principles

- **Review before send**: Transcriptions are always shown for editing before being sent to Claude Code. Never auto-send — errors in coding instructions are expensive.
- **Interactive permissions**: Tool usage requires user approval via Yes/Always/No buttons on the phone. "Always" auto-approves the tool for the rest of the session.
- **Mode toggle**: Switch between Plan (read-only), Code (interactive approval), and YOLO (bypass all permissions) modes.
- **Mobile-first**: The UI is designed for phones. Touch targets are large, the mic button uses pointer events for cross-platform hold-to-record, safe area insets are respected.
- **Streaming output**: Claude Code output streams chunk-by-chunk to the phone via WebSocket so the user sees progress immediately.
- **Session continuity**: The SDK's `resume` option maintains Claude Code conversation context across commands within a session. `Reset` starts a fresh session.
- **Minimal dependencies**: No frontend build step. Backend uses Express, ws, and the Claude Agent SDK.

## Environment Variables

All configuration is via environment variables (or a `.env` file in the project root):

| Variable                 | Required            | Default                    | Notes                              |
| ------------------------ | ------------------- | -------------------------- | ---------------------------------- |
| `GROQ_API_KEY`           | Yes (if using Groq) | —                          | Get from console.groq.com          |
| `OPENAI_API_KEY`         | If using OpenAI     | —                          | Alternative transcription provider |
| `TRANSCRIPTION_PROVIDER` | No                  | `groq`                     | `groq` or `openai`                 |
| `WHISPER_MODEL`          | No                  | `whisper-large-v3-turbo`   | Whisper model for transcription    |
| `CLAUDE_WORK_DIR`        | No                  | `.`                        | Working directory for Claude Code  |
| `HOST`                   | No                  | `0.0.0.0`                  | Server bind address                |
| `PORT`                   | No                  | `8765`                     | Server port                        |
| `CLEANUP_ENABLED`        | No                  | `false`                    | Enable LLM text cleanup pass       |
| `CLEANUP_PROVIDER`       | No                  | `anthropic`                | `anthropic` or `openai`            |
| `ANTHROPIC_API_KEY`      | If cleanup enabled  | —                          | For Anthropic cleanup provider     |
| `CLEANUP_MODEL`          | No                  | `claude-sonnet-4-20250514` | Model for cleanup                  |
| `SSL_CERTFILE`           | No                  | —                          | Path to SSL certificate for HTTPS  |
| `SSL_KEYFILE`            | No                  | —                          | Path to SSL private key for HTTPS  |

## WebSocket Protocol

All communication between frontend and backend is over a single WebSocket at `/ws`. Messages are JSON objects with a `type` field.

### Client → Server

- `{"type": "audio", "data": "<base64>", "mime_type": "audio/webm"}` — recorded audio for transcription
- `{"type": "send", "text": "..."}` — send command to Claude Code
- `{"type": "cancel"}` — cancel running Claude Code command
- `{"type": "reset"}` — reset Claude Code session
- `{"type": "set_mode", "mode": "plan|default|bypassPermissions"}` — change permission mode
- `{"type": "permission_response", "action": "allow|allowSession|deny", "message?": "..."}` — respond to tool approval request
- `{"type": "user_answer", "answers": {"question": "answer"}}` — answer AskUserQuestion

### Server → Client

- `{"type": "transcription", "text": "...", "success": true}` — transcription result
- `{"type": "cleanup", "text": "...", "original": "...", "success": true}` — cleaned-up text
- `{"type": "claude_chunk", "text": "..."}` — streaming Claude Code output
- `{"type": "claude_done", "success": true, "output": "..."}` — command completed
- `{"type": "status", "message": "..."}` — status updates (shown in status bar)
- `{"type": "error", "message": "..."}` — error messages
- `{"type": "config", "work_dir": "...", "work_dir_display": "...", "permission_mode": "..."}` — initial configuration
- `{"type": "permission_request", "toolName": "...", "input": {...}, "description": "..."}` — tool requesting approval
- `{"type": "ask_user", "questions": [...]}` — Claude asking a question with options
- `{"type": "mode_changed", "mode": "..."}` — confirms mode change

## Development Guidelines

### Test-Driven Development

- **Write tests first**: Before implementing a feature, write tests that define the expected behavior
- **Red-Green-Refactor**: Start with failing tests, make them pass, then refactor
- **Small iterations**: Write one test at a time, make it pass, then write the next

### Test Quality

- **Strong assertions**: Write specific assertions that verify exact expected behavior, not just "it doesn't crash"
- **Test public interfaces**: Don't test implementation details; test through the module/class public API
- **Maintain coverage**: Ensure test coverage remains high when adding new features
- **Independent tests**: Each test should be independent and not rely on other tests or shared mutable state
- **Descriptive names**: Test names should describe the behavior being tested

### Code Quality

- **Clean Code**: Write readable, self-documenting code with meaningful names
- **SOLID Principles**:
  - Single Responsibility: Each class/module should have one reason to change
  - Open/Closed: Open for extension, closed for modification
  - Liskov Substitution: Subtypes must be substitutable for their base types
  - Interface Segregation: Many specific interfaces are better than one general interface
  - Dependency Inversion: Depend on abstractions, not concretions
- **GRASP Patterns**: Apply General Responsibility Assignment principles for object-oriented design
- **Design Patterns**: Use appropriate patterns where they simplify the design, but avoid over-engineering

## Commands

| Command                 | Description                          |
| ----------------------- | ------------------------------------ |
| `npm start`             | Start the server                     |
| `npm run dev`           | Start with --watch (auto-restart)    |
| `npm test`              | Run tests (vitest)                   |
| `npm run generate-cert` | Generate self-signed SSL certificate |
| `npm run format`        | Format all files with Prettier       |
| `npm run format:check`  | Check formatting without writing     |

## Before Committing

A pre-commit hook (husky + lint-staged) runs automatically on `git commit`:

1. **Prettier** formats all staged `.js`, `.json`, `.md`, and `.html` files
2. **vitest** runs the full test suite

If either step fails, the commit is aborted. You can run these manually:

- `npm run format:check` — check formatting without writing
- `npm run format` — fix formatting
- `npm test` — run tests

## Development Notes

- Run with `npm start` or `node src/server.js`. The server uses Express + ws for WebSocket support.
- Node.js 18+ required (built-in `fetch`, `FormData`, `crypto`).
- The frontend has no build step. Edit `src/static/index.html` directly and reload on the phone.
- To test without a phone, open `http://localhost:8765` in a desktop browser — mic recording works there too.
- The Claude Agent SDK's `canUseTool` callback handles permission requests. When a tool needs approval, the callback sends a WebSocket message to the phone and awaits the user's response via a pending Promise.
- Audio format: the frontend tries `audio/webm;codecs=opus` first (Chrome/Firefox), falls back to `audio/mp4` (Safari), then generic `audio/webm`. The transcription module maps MIME types to file extensions for the Whisper API.
- The `_sessionAllowedTools` Set in `claude-session.js` tracks tools that the user has approved with "Always" for the current session. These auto-approve without prompting.

## Common Tasks

### Adding a new transcription provider

1. Add the provider's API URL and config to `src/config.js`
2. Add a new branch in `transcribeAudio()` in `src/transcription.js`
3. The function should return `{text: "...", success: true}` on success

### Adding a new cleanup provider

1. Add config to `src/config.js`
2. Add a `_cleanup<Provider>()` function in `src/text-cleanup.js`
3. Add the branch in `cleanupText()`

### Modifying the UI

Everything is in `src/static/index.html`. CSS is in a `<style>` block, JS is in a `<script>` block at the bottom. The app uses no framework — DOM manipulation is direct. Key UI state is managed via CSS classes (`visible`, `recording`, `processing`, `connected`).

Key UI components:

- **Mode toggle**: Segmented control in the header (Plan/Code/YOLO)
- **Permission bar**: Slides up when a tool needs approval (Yes/Always/No + custom text)
- **Ask user bar**: Shows questions from Claude with option buttons
- **Transcription bar**: Shows transcribed audio for review/edit before sending

### Enabling HTTPS

Mic recording (`getUserMedia`) requires a secure context (HTTPS) on non-localhost origins. To enable HTTPS:

1. Generate a certificate: `npm run generate-cert` (interactive — detects local IPs, generates `certs/cert.pem` and `certs/key.pem`)
2. Set `SSL_CERTFILE=certs/cert.pem` and `SSL_KEYFILE=certs/key.pem` in `.env` or environment
3. Trust the certificate on your phone (the generator prints iOS/Android/browser instructions)

### Changing how Claude Code is invoked

Edit `ClaudeSession.execute()` in `src/claude-session.js`. The `options` object passed to the SDK's `query()` function controls behavior. Key options:

- `permissionMode` — `'default'`, `'plan'`, or `'bypassPermissions'`
- `resume` — session ID to continue a previous conversation
- `canUseTool` — async callback for interactive permission approval
- `cwd` — working directory for Claude Code

## Security Considerations

- This is a single-user tool intended for local network use. There is no authentication.
- Do not expose to the public internet without adding auth (e.g., a bearer token checked on WebSocket connect).
- The server can execute arbitrary commands via Claude Code on the host machine.
- YOLO mode bypasses all permission checks — use with caution.
- For remote access, use Tailscale (preferred) or SSH port forwarding rather than opening the port directly.

## Planned Features / TODOs

- [ ] Add authentication (bearer token or basic auth) for non-local-network use
- [ ] Support local Whisper via whisper.cpp for fully offline transcription
- [ ] Add visual diff display for text cleanup (show what the LLM changed)
- [ ] Support multiple concurrent sessions (multi-user)
- [ ] Add per-message retry (re-send a failed command)
- [ ] Haptic feedback on iOS when recording starts/stops
- [ ] Audio playback of Claude's text responses (TTS)
- [ ] File upload from phone (photos of whiteboards/diagrams → Claude Code)
- [ ] Keyboard shortcuts for desktop browser testing
