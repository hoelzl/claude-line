# Claude-Line

A voice-first mobile interface for driving Claude Code from a phone/tablet.

Features:

- Hold-to-record voice commands transcribed via Whisper (Groq or OpenAI)
- Review/edit transcriptions before sending to Claude Code
- Streaming output from Claude Code in real time
- **Interactive tool approval** — Yes/Always/No buttons when Claude wants to use tools
- **Mode toggle** — Plan (read-only), Code (interactive approval), YOLO (no prompts)
- **AskUserQuestion support** — Answer Claude's questions with tap-to-select options

## Quick Start

Requires Node.js 18+.

### Installation

```shell
npm install
```

### Running the Server

You need at least a `GROQ_API_KEY` (or `OPENAI_API_KEY` if using OpenAI as transcription provider).
Set it in the environment or in a `.env` file:

```shell
export GROQ_API_KEY=your-key-here
```

Then start the server:

```shell
npm start
```

The server starts on `0.0.0.0:8765` by default.

For development with auto-restart:

```shell
npm run dev
```

### HTTPS Setup (Required for Mobile Mic Access)

Mobile browsers require HTTPS to allow microphone access (`getUserMedia`). Set the `SSL_CERTFILE` and `SSL_KEYFILE` environment variables (or add them to `.env`):

```shell
SSL_CERTFILE=certs/cert.pem
SSL_KEYFILE=certs/key.pem
```

To generate a self-signed certificate with the built-in generator:

```shell
npm run generate-cert
```

This detects your local IP addresses, generates `certs/cert.pem` and `certs/key.pem`, and prints instructions for trusting the certificate on iOS/Android/browsers.

Open `https://<your-computer-ip>:8765` on your phone (both devices must be on the same network).

### Configuration

Override host and port via environment variables:

```shell
HOST=127.0.0.1 PORT=9000 npm start
```

See [CLAUDE.md](CLAUDE.md) for the full list of environment variables.

### Running Tests

```shell
npm test
```
