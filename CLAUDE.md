# Claude Voice Bridge

## Project Overview

A voice-first mobile interface for driving Claude Code from a phone/tablet. The user speaks commands on their phone, audio is transcribed via Whisper (Groq or OpenAI API), the user reviews/edits the transcription, then sends it to a Claude Code subprocess running on their desktop. Output streams back to the phone in real time.

## Architecture

```
Phone browser → WebSocket → FastAPI server → Whisper API (transcription)
                                           → optional LLM cleanup pass
                                           → Claude Code subprocess (claude -p)
                                           → streams output back over WebSocket
```

Single-user tool. One Claude Code session per server instance. The frontend is a single HTML file with inline CSS/JS served as a static file.

## File Structure

```
src/claudeline/
  __init__.py              — package version
  __main__.py              — Typer CLI entry point (starts the server)
  server.py                — FastAPI app, WebSocket handler, routes
  config.py                — pydantic-settings configuration
  transcription.py         — Whisper API integration (Groq and OpenAI)
  text_cleanup.py          — Optional LLM-based spoken→written text conversion
  claude_code_manager.py   — Manages Claude Code subprocess lifecycle
  generate_cert.py         — Self-signed certificate generation for HTTPS
  static/
    index.html             — Mobile-first web UI (inline CSS and JS)
```

## Key Design Principles

- **Review before send**: Transcriptions are always shown for editing before being sent to Claude Code. Never auto-send — errors in coding instructions are expensive.
- **Mobile-first**: The UI is designed for phones. Touch targets are large, the mic button uses pointer events for cross-platform hold-to-record, safe area insets are respected.
- **Streaming output**: Claude Code output streams chunk-by-chunk to the phone via WebSocket so the user sees progress immediately.
- **Session continuity**: The `--resume` flag maintains Claude Code conversation context across commands within a session. `Reset` starts a fresh session.
- **Minimal dependencies**: No frontend build step. Backend uses only well-maintained, lightweight Python packages.

## Environment Variables

All configuration is via environment variables (or a `.env` file in the project root):

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GROQ_API_KEY` | Yes (if using Groq) | — | Get from console.groq.com |
| `OPENAI_API_KEY` | If using OpenAI | — | Alternative transcription provider |
| `TRANSCRIPTION_PROVIDER` | No | `groq` | `groq` or `openai` |
| `CLAUDE_WORK_DIR` | No | `.` | Working directory for Claude Code |
| `CLAUDE_COMMAND` | No | `claude` | Path to claude binary if not in PATH |
| `HOST` | No | `0.0.0.0` | Server bind address |
| `PORT` | No | `8765` | Server port |
| `CLEANUP_ENABLED` | No | `false` | Enable LLM text cleanup pass |
| `CLEANUP_PROVIDER` | No | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | If cleanup enabled | — | For Anthropic cleanup provider |
| `CLEANUP_MODEL` | No | `claude-sonnet-4-20250514` | Model for cleanup |
| `SSL_CERTFILE` | No | — | Path to SSL certificate for HTTPS |
| `SSL_KEYFILE` | No | — | Path to SSL private key for HTTPS |

## WebSocket Protocol

All communication between frontend and backend is over a single WebSocket at `/ws`. Messages are JSON objects with a `type` field.

### Client → Server

- `{"type": "audio", "data": "<base64>", "mime_type": "audio/webm"}` — recorded audio for transcription
- `{"type": "send", "text": "..."}` — send command to Claude Code
- `{"type": "cancel"}` — cancel running Claude Code command
- `{"type": "reset"}` — reset Claude Code session

### Server → Client

- `{"type": "transcription", "text": "...", "success": true}` — transcription result
- `{"type": "cleanup", "text": "...", "original": "...", "success": true}` — cleaned-up text
- `{"type": "claude_chunk", "text": "..."}` — streaming Claude Code output
- `{"type": "claude_done", "success": true, "output": "..."}` — command completed
- `{"type": "status", "message": "..."}` — status updates (shown in status bar)
- `{"type": "error", "message": "..."}` — error messages

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

| Command | Description |
|---------|-------------|
| `uv run python -m claudeline` | Start the server |
| `uv run python -m claudeline --help` | Show CLI help |
| `uv run python -m claudeline --version` | Show version |
| `uv run pytest` | Run tests |
| `uv run tox` | Test against multiple Python versions |
| `uv run ruff check .` | Run linter |
| `uv run ruff format .` | Format code |
| `uv run mypy src/` | Run type checker |
| `uv run python -m claudeline.generate_cert` | Generate self-signed SSL certificate |
| `uv run pre-commit run --all-files` | Run all pre-commit checks |

### Before Committing

Run all pre-commit checks:
```bash
uv run pre-commit run --all-files
```

Or install hooks to run automatically on every commit:
```bash
uv run pre-commit install
```

## Development Notes

- Run with `uv run python -m claudeline` or `claude-line` (console script). The CLI configures uvicorn internally.
- The frontend has no build step. Edit `src/claudeline/static/index.html` directly and reload on the phone.
- To test without a phone, open `http://localhost:8765` in a desktop browser — mic recording works there too.
- Claude Code's `--output-format stream-json` emits one JSON object per line. The parser in `claude_code_manager.py` handles `system`, `assistant`, and `result` message types. If Claude Code's output format changes in future versions, that parser is the place to update.
- The `_find_claude()` method in `claude_code_manager.py` checks common install locations (`~/.npm-global/bin/claude`, `~/.local/bin/claude`, `/usr/local/bin/claude`) as fallbacks if `claude` is not in PATH.
- Audio format: the frontend tries `audio/webm;codecs=opus` first (Chrome/Firefox), falls back to `audio/mp4` (Safari), then generic `audio/webm`. The transcription module maps MIME types to file extensions for the Whisper API.

## Common Tasks

### Adding a new transcription provider

1. Add the provider's API URL and config to `src/claudeline/config.py`
2. Add a new branch in `transcribe_audio()` in `src/claudeline/transcription.py`
3. The function should return `{"text": "...", "success": True}` on success

### Adding a new cleanup provider

1. Add config to `src/claudeline/config.py`
2. Add an `_cleanup_<provider>()` function in `src/claudeline/text_cleanup.py`
3. Add the branch in `cleanup_text()`

### Modifying the UI

Everything is in `src/claudeline/static/index.html`. CSS is in a `<style>` block, JS is in a `<script>` block at the bottom. The app uses no framework — DOM manipulation is direct. Key UI state is managed via CSS classes (`visible`, `recording`, `processing`, `connected`).

### Enabling HTTPS

Mic recording (`getUserMedia`) requires a secure context (HTTPS) on non-localhost origins. To enable HTTPS with a self-signed certificate:

1. Generate a certificate: `uv run python -m claudeline.generate_cert`
2. Start the server with SSL: `claude-line --ssl-certfile certs/cert.pem --ssl-keyfile certs/key.pem`
3. Trust the certificate on your phone (see the generated instructions for iOS/Android steps)

You can also set `SSL_CERTFILE` and `SSL_KEYFILE` environment variables instead of CLI flags.

### Changing how Claude Code is invoked

Edit `ClaudeCodeManager.execute()` in `src/claudeline/claude_code_manager.py`. The `cmd` list built there controls the exact command line. Key flags:
- `-p` — print mode (non-interactive, reads prompt from args)
- `--output-format stream-json` — machine-readable streaming output
- `--resume <session_id>` — continue a previous conversation

## Security Considerations

- This is a single-user tool intended for local network use. There is no authentication.
- Do not expose to the public internet without adding auth (e.g., a bearer token checked on WebSocket connect).
- The server can execute arbitrary commands via Claude Code on the host machine.
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
