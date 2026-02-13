"""Self-signed certificate generation for HTTPS support.

Run as: uv run python -m claudeline.generate_cert

Generates a self-signed TLS certificate suitable for local network use,
enabling HTTPS so that mobile browsers allow microphone access (getUserMedia).
"""

import datetime
import ipaddress
import os
import socket
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID


def get_local_ips() -> list[str]:
    """Detect local IPv4 addresses (excluding loopback).

    Uses socket.getaddrinfo() for cross-platform compatibility.
    Falls back to the UDP socket trick if no addresses are found.
    """
    ips: set[str] = set()

    # Primary method: getaddrinfo on hostname
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            addr = str(info[4][0])
            if not addr.startswith("127."):
                ips.add(addr)
    except OSError:
        pass

    # Fallback: UDP socket trick
    if not ips:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                addr = s.getsockname()[0]
                if not addr.startswith("127."):
                    ips.add(addr)
        except OSError:
            pass

    return sorted(ips)


def generate_certificate(
    ips: list[str],
    output_dir: str = "certs",
    days_valid: int = 365,
    common_name: str = "Claude Line Local",
) -> tuple[Path, Path]:
    """Generate a self-signed EC P-256 certificate with SANs for local IPs.

    Args:
        ips: Additional IP addresses to include as SANs.
        output_dir: Directory to write cert.pem and key.pem into.
        days_valid: Certificate validity period in days.
        common_name: CN for the certificate subject/issuer.

    Returns:
        Tuple of (cert_path, key_path) as absolute Paths.
    """
    # Generate EC P-256 private key
    key = ec.generate_private_key(ec.SECP256R1())

    # Build subject/issuer
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])

    # Build SANs: always include localhost + 127.0.0.1, plus user-provided IPs
    sans: list[x509.GeneralName] = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
    ]
    for ip_str in ips:
        try:
            ip_addr = ipaddress.IPv4Address(ip_str)
            san = x509.IPAddress(ip_addr)
            if san not in sans:
                sans.append(san)
        except ValueError:
            continue

    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=days_valid))
        .add_extension(
            x509.SubjectAlternativeName(sans),
            critical=False,
        )
        .add_extension(
            x509.BasicConstraints(ca=True, path_length=0),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )

    # Write files
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    key_path = out / "key.pem"
    cert_path = out / "cert.pem"

    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    if os.name != "nt":
        key_path.chmod(0o600)

    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))

    return cert_path.resolve(), key_path.resolve()


def print_instructions(cert_path: Path, key_path: Path, ips: list[str]) -> None:
    """Print setup instructions after certificate generation."""
    port = 8765

    print("\n--- Certificate Generated ---")
    print(f"  Certificate: {cert_path}")
    print(f"  Private key: {key_path}")

    print("\n--- Start Server with HTTPS ---")
    print(
        f"  claude-line --ssl-certfile {cert_path} --ssl-keyfile {key_path}"
    )

    if ips:
        print("\n--- Access from your phone ---")
        for ip in ips:
            print(f"  https://{ip}:{port}")

    print("\n--- iOS: Trust the certificate ---")
    print("  1. Transfer cert.pem to your iPhone (AirDrop, email, or HTTP)")
    print("  2. Open it to install the profile")
    print("  3. Go to Settings > General > About > Certificate Trust Settings")
    print("  4. Enable full trust for 'Claude Line Local'")

    print("\n--- Android: Trust the certificate ---")
    print("  1. Transfer cert.pem to your Android device")
    print("  2. Go to Settings > Security > Install certificate > CA certificate")
    print("  3. Select the cert.pem file")

    print("\n--- Browser: Accept the warning ---")
    print("  Navigate to the HTTPS URL and accept the self-signed cert warning.")
    print("  (Chrome: 'Advanced' > 'Proceed'; Firefox: 'Accept the Risk')")
    print()


def interactive_main() -> None:
    """Interactive certificate generation entry point."""
    print("Claude Line — Self-Signed Certificate Generator\n")

    detected_ips = get_local_ips()

    if detected_ips:
        print("Detected local IP addresses:")
        for ip in detected_ips:
            print(f"  {ip}")
    else:
        print("No local IP addresses detected.")

    selected_ips = detected_ips

    # Interactive mode: let user confirm/add IPs
    if sys.stdin.isatty():
        print(
            "\nPress Enter to use all detected IPs, or type IPs "
            "separated by spaces:"
        )
        try:
            user_input = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return

        if user_input:
            selected_ips = user_input.split()

    print(f"\nGenerating certificate for IPs: {', '.join(selected_ips) or 'none'}")
    cert_path, key_path = generate_certificate(selected_ips)
    print_instructions(cert_path, key_path, selected_ips)


if __name__ == "__main__":
    interactive_main()
