from typing import Annotated

import typer

from . import __version__


def version_callback(value: bool):
    if value:
        print(f"claude-line {__version__}")
        raise typer.Exit()


def typer_main(
    host: Annotated[
        str | None,
        typer.Option(
            help="Host to bind the server to (default: from HOST env var or 0.0.0.0)."
        ),
    ] = None,
    port: Annotated[
        int | None,
        typer.Option(help="Port to listen on (default: from PORT env var or 8765)."),
    ] = None,
    ssl_certfile: Annotated[
        str | None,
        typer.Option(help="Path to SSL certificate file for HTTPS."),
    ] = None,
    ssl_keyfile: Annotated[
        str | None,
        typer.Option(help="Path to SSL private key file for HTTPS."),
    ] = None,
    version: Annotated[
        bool | None,
        typer.Option(
            "--version",
            help="Show the version and exit.",
            callback=version_callback,
            is_eager=True,
        ),
    ] = None,
):
    """Claude Line: voice-first mobile interface for Claude Code."""
    from .server import run_server

    run_server(host=host, port=port, ssl_certfile=ssl_certfile, ssl_keyfile=ssl_keyfile)


def main():
    typer.run(typer_main)


if __name__ == "__main__":
    main()
