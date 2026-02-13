# Claude-Line

A voice-first mobile interface for driving Claude Code from a phone/tablet


## Quick Start with uv (Recommended)

[uv](https://docs.astral.sh/uv/) is the recommended tool for managing this project.

### Installation

```shell
uv sync --group dev
```

### Running the Server

You need at least a `GROQ_API_KEY` (or `OPENAI_API_KEY` if using OpenAI as transcription provider).
Set it in the environment or in a `.env` file:

```shell
export GROQ_API_KEY=your-key-here
```

Then start the server:

```shell
uv run python -m claudeline
```

The server starts on `0.0.0.0:8765` by default.

### HTTPS Setup (Required for Mobile Mic Access)

Mobile browsers require HTTPS to allow microphone access (`getUserMedia`). Before connecting from a phone, generate a self-signed certificate and start the server with HTTPS:

1. **Generate a certificate:**

   ```shell
   uv run python -m claudeline.generate_cert
   ```

   This creates `certs/cert.pem` and `certs/key.pem`, detects your local IP addresses, and prints instructions for trusting the certificate on iOS/Android.

2. **Start the server with HTTPS:**

   ```shell
   uv run python -m claudeline --ssl-certfile certs/cert.pem --ssl-keyfile certs/key.pem
   ```

   Or set environment variables (e.g. in `.env`):

   ```shell
   SSL_CERTFILE=certs/cert.pem
   SSL_KEYFILE=certs/key.pem
   ```

3. **Trust the certificate on your phone:**
   - **iOS:** Transfer `cert.pem` to your iPhone (AirDrop, email, or HTTP), install the profile, then go to Settings > General > About > Certificate Trust Settings and enable full trust.
   - **Android:** Transfer `cert.pem`, then go to Settings > Security > Install certificate > CA certificate.

4. **Open `https://<your-computer-ip>:8765`** on your phone (both devices must be on the same network).

You can override host and port via CLI flags or environment variables:

```shell
uv run python -m claudeline --host 127.0.0.1 --port 9000
```

### Running Tests

```shell
uv run pytest
```

### Building

```shell
uv build
```

### Running tox

```shell
uv run tox
```


## Alternative: pip/setuptools

For those who prefer traditional Python tooling.

### Installation

Create a virtual environment and install the package:

```shell
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
```

### Building

```shell
python -m build
```

After building, you can install the wheel:

```shell
pip install dist/claudeline-0.0.1-py3-none-any.whl
```

### Running Tests

```shell
pytest
```

*Note:* If you install the package from a wheel, the tests will run against the
installed package; install in editable mode (i.e., using the `-e` option) to
test against the development package.

### Running tox

To test against multiple Python versions:

```shell
tox
```
