import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { X509Certificate, createPrivateKey } from 'crypto';

import { getLocalIps, generateCertificate } from '../src/generate-cert.js';

describe('getLocalIps', () => {
  it('returns an array of strings', () => {
    const result = getLocalIps();
    expect(Array.isArray(result)).toBe(true);
    for (const ip of result) {
      expect(typeof ip).toBe('string');
    }
  });

  it('all returned IPs are valid IPv4', () => {
    const result = getLocalIps();
    const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    for (const ip of result) {
      expect(ip).toMatch(ipv4Regex);
    }
  });

  it('does not include loopback addresses', () => {
    const result = getLocalIps();
    for (const ip of result) {
      expect(ip.startsWith('127.')).toBe(false);
    }
  });

  it('returns sorted list', () => {
    const result = getLocalIps();
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });
});

describe('generateCertificate', () => {
  function makeTmpDir() {
    return mkdtempSync(join(tmpdir(), 'claude-line-test-'));
  }

  it('creates cert.pem and key.pem files', async () => {
    const dir = makeTmpDir();
    const { certPath, keyPath } = await generateCertificate([], { outputDir: dir });

    expect(certPath).toContain('cert.pem');
    expect(keyPath).toContain('key.pem');

    // Files should exist and be non-empty
    const certData = readFileSync(certPath, 'utf8');
    const keyData = readFileSync(keyPath, 'utf8');
    expect(certData.length).toBeGreaterThan(0);
    expect(keyData.length).toBeGreaterThan(0);
  });

  it('generates valid PEM certificate', async () => {
    const dir = makeTmpDir();
    const { certPath } = await generateCertificate([], { outputDir: dir });

    const certPem = readFileSync(certPath, 'utf8');
    expect(certPem).toContain('-----BEGIN CERTIFICATE-----');
    expect(certPem).toContain('-----END CERTIFICATE-----');

    // Should parse without error
    const cert = new X509Certificate(certPem);
    expect(cert.subject).toContain('Claude Line Local');
  });

  it('generates valid PEM private key', async () => {
    const dir = makeTmpDir();
    const { keyPath } = await generateCertificate([], { outputDir: dir });

    const keyPem = readFileSync(keyPath, 'utf8');
    expect(keyPem).toContain('-----BEGIN PRIVATE KEY-----');

    // Should parse without error
    const key = createPrivateKey(keyPem);
    expect(key.type).toBe('private');
  });

  it('certificate contains localhost DNS SAN', async () => {
    const dir = makeTmpDir();
    const { certPath } = await generateCertificate([], { outputDir: dir });

    const cert = new X509Certificate(readFileSync(certPath));
    const san = cert.subjectAltName;
    expect(san).toContain('DNS:localhost');
  });

  it('certificate contains loopback IP SAN', async () => {
    const dir = makeTmpDir();
    const { certPath } = await generateCertificate([], { outputDir: dir });

    const cert = new X509Certificate(readFileSync(certPath));
    const san = cert.subjectAltName;
    expect(san).toContain('IP Address:127.0.0.1');
  });

  it('certificate contains custom IP SANs', async () => {
    const dir = makeTmpDir();
    const { certPath } = await generateCertificate(['192.168.1.100', '10.0.0.5'], {
      outputDir: dir,
    });

    const cert = new X509Certificate(readFileSync(certPath));
    const san = cert.subjectAltName;
    expect(san).toContain('IP Address:192.168.1.100');
    expect(san).toContain('IP Address:10.0.0.5');
  });

  it('uses custom common name', async () => {
    const dir = makeTmpDir();
    const { certPath } = await generateCertificate([], {
      outputDir: dir,
      commonName: 'Test CN',
    });

    const cert = new X509Certificate(readFileSync(certPath));
    expect(cert.subject).toContain('Test CN');
  });

  it('creates output directory if missing', async () => {
    const dir = join(makeTmpDir(), 'sub', 'dir');
    const { certPath, keyPath } = await generateCertificate([], { outputDir: dir });

    expect(readFileSync(certPath).length).toBeGreaterThan(0);
    expect(readFileSync(keyPath).length).toBeGreaterThan(0);
  });

  it('returns absolute paths', async () => {
    const dir = makeTmpDir();
    const { certPath, keyPath } = await generateCertificate([], { outputDir: dir });

    // Absolute paths start with / on Unix or drive letter on Windows
    const isAbsolute = (p) => /^([A-Z]:\\|\/)/i.test(p);
    expect(isAbsolute(certPath)).toBe(true);
    expect(isAbsolute(keyPath)).toBe(true);
  });

  it('ignores invalid IP strings', async () => {
    const dir = makeTmpDir();
    // Should not throw
    const { certPath } = await generateCertificate(['not-an-ip', '192.168.1.1'], {
      outputDir: dir,
    });

    const cert = new X509Certificate(readFileSync(certPath));
    const san = cert.subjectAltName;
    expect(san).toContain('IP Address:192.168.1.1');
    expect(san).not.toContain('not-an-ip');
  });

  it('deduplicates 127.0.0.1 if passed explicitly', async () => {
    const dir = makeTmpDir();
    const { certPath } = await generateCertificate(['127.0.0.1'], {
      outputDir: dir,
    });

    const cert = new X509Certificate(readFileSync(certPath));
    const san = cert.subjectAltName;
    // Should appear once (already included by default)
    const matches = san.match(/IP Address:127\.0\.0\.1/g);
    expect(matches.length).toBe(1);
  });
});
