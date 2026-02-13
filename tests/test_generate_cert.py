"""Tests for claudeline.generate_cert module."""

import ipaddress
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_pem_private_key

from claudeline.generate_cert import generate_certificate, get_local_ips


class TestGetLocalIps:
    """Test local IP address detection."""

    def test_returns_list_of_strings(self):
        result = get_local_ips()
        assert isinstance(result, list)
        for item in result:
            assert isinstance(item, str)

    def test_all_returned_ips_are_valid_ipv4(self):
        result = get_local_ips()
        for ip_str in result:
            # Should not raise ValueError
            ipaddress.IPv4Address(ip_str)

    def test_no_loopback_addresses_included(self):
        result = get_local_ips()
        for ip_str in result:
            assert not ip_str.startswith("127.")

    def test_returns_empty_list_when_network_detection_fails(self):
        with (
            patch("claudeline.generate_cert.socket.gethostname", side_effect=OSError),
            patch("claudeline.generate_cert.socket.socket", side_effect=OSError),
        ):
            result = get_local_ips()
        assert result == []


class TestGenerateCertificate:
    """Test self-signed certificate generation."""

    def test_creates_cert_and_key_files(self, tmp_path):
        cert_path, key_path = generate_certificate([], output_dir=str(tmp_path))
        assert cert_path.exists()
        assert key_path.exists()
        assert cert_path.name == "cert.pem"
        assert key_path.name == "key.pem"

    def test_files_are_valid_pem(self, tmp_path):
        cert_path, key_path = generate_certificate([], output_dir=str(tmp_path))
        # Should parse without error
        x509.load_pem_x509_certificate(cert_path.read_bytes())
        load_pem_private_key(key_path.read_bytes(), password=None)

    def test_cert_contains_localhost_dns_san(self, tmp_path):
        cert_path, _ = generate_certificate([], output_dir=str(tmp_path))
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        dns_names = san.get_values_for_type(x509.DNSName)
        assert "localhost" in dns_names

    def test_cert_contains_loopback_ip_san(self, tmp_path):
        cert_path, _ = generate_certificate([], output_dir=str(tmp_path))
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        ip_addrs = san.get_values_for_type(x509.IPAddress)
        assert ipaddress.IPv4Address("127.0.0.1") in ip_addrs

    def test_cert_contains_custom_ip_sans(self, tmp_path):
        cert_path, _ = generate_certificate(
            ["192.168.1.100", "10.0.0.5"], output_dir=str(tmp_path)
        )
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        ip_addrs = san.get_values_for_type(x509.IPAddress)
        assert ipaddress.IPv4Address("192.168.1.100") in ip_addrs
        assert ipaddress.IPv4Address("10.0.0.5") in ip_addrs

    def test_cert_uses_ec_key(self, tmp_path):
        _, key_path = generate_certificate([], output_dir=str(tmp_path))
        key = load_pem_private_key(key_path.read_bytes(), password=None)
        assert isinstance(key, ec.EllipticCurvePrivateKey)

    def test_correct_common_name(self, tmp_path):
        cert_path, _ = generate_certificate(
            [], output_dir=str(tmp_path), common_name="Test CN"
        )
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        cn = cert.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)
        assert len(cn) == 1
        assert cn[0].value == "Test CN"

    def test_correct_validity_period(self, tmp_path):
        cert_path, _ = generate_certificate([], output_dir=str(tmp_path), days_valid=30)
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        delta = cert.not_valid_after_utc - cert.not_valid_before_utc
        assert delta.days == 30

    def test_creates_output_directory_if_missing(self, tmp_path):
        nested = tmp_path / "sub" / "dir"
        assert not nested.exists()
        cert_path, key_path = generate_certificate([], output_dir=str(nested))
        assert nested.exists()
        assert cert_path.exists()
        assert key_path.exists()

    def test_returns_absolute_paths(self, tmp_path):
        cert_path, key_path = generate_certificate([], output_dir=str(tmp_path))
        assert cert_path.is_absolute()
        assert key_path.is_absolute()

    def test_basic_constraints_has_ca_true(self, tmp_path):
        cert_path, _ = generate_certificate([], output_dir=str(tmp_path))
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        bc = cert.extensions.get_extension_for_class(x509.BasicConstraints).value
        assert bc.ca is True
        assert bc.path_length == 0
