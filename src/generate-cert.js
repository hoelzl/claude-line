/**
 * Self-signed certificate generation for HTTPS support.
 *
 * Run as: node src/generate-cert.js
 *
 * Generates a self-signed TLS certificate suitable for local network use,
 * enabling HTTPS so that mobile browsers allow microphone access (getUserMedia).
 */

import { mkdirSync, writeFileSync, chmodSync } from 'fs';
import { createInterface } from 'readline';
import { networkInterfaces } from 'os';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

import selfsigned from 'selfsigned';

/**
 * Detect local IPv4 addresses (excluding loopback).
 *
 * @returns {string[]} Sorted list of local IPv4 addresses.
 */
export function getLocalIps() {
  const ips = new Set();
  const ifaces = networkInterfaces();

  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.add(iface.address);
      }
    }
  }

  return [...ips].sort();
}

/**
 * Generate a self-signed RSA certificate with SANs for local IPs.
 *
 * @param {string[]} ips - IP addresses to include as SANs.
 * @param {object} [options]
 * @param {string} [options.outputDir='certs'] - Directory for cert.pem and key.pem.
 * @param {number} [options.daysValid=365] - Certificate validity period.
 * @param {string} [options.commonName='Claude Line Local'] - CN for the certificate.
 * @returns {{ certPath: string, keyPath: string }} Absolute paths to generated files.
 */
export async function generateCertificate(
  ips,
  { outputDir = 'certs', daysValid = 365, commonName = 'Claude Line Local' } = {},
) {
  // Build SAN entries: always include localhost + 127.0.0.1
  const altNames = [
    { type: 2, value: 'localhost' }, // DNS
    { type: 7, ip: '127.0.0.1' }, // IP
  ];

  const seenIps = new Set(['127.0.0.1']);
  for (const ip of ips) {
    if (!seenIps.has(ip) && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      altNames.push({ type: 7, ip });
      seenIps.add(ip);
    }
  }

  const attrs = [{ name: 'commonName', value: commonName }];

  const pems = await selfsigned.generate(attrs, {
    keySize: 2048, // RSA key size (selfsigned uses RSA)
    days: daysValid,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'basicConstraints',
        cA: true,
        pathLenConstraint: 0,
        critical: true,
      },
      {
        name: 'subjectAltName',
        altNames,
      },
    ],
  });

  // Write files
  mkdirSync(outputDir, { recursive: true });

  const certPath = resolve(outputDir, 'cert.pem');
  const keyPath = resolve(outputDir, 'key.pem');

  writeFileSync(certPath, pems.cert);
  writeFileSync(keyPath, pems.private);

  // Restrict key file permissions on Unix
  if (process.platform !== 'win32') {
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // Ignore permission errors
    }
  }

  return { certPath, keyPath };
}

/**
 * Print setup instructions after certificate generation.
 *
 * @param {string} certPath
 * @param {string} keyPath
 * @param {string[]} ips
 */
export function printInstructions(certPath, keyPath, ips) {
  const port = 8765;

  console.log('\n--- Certificate Generated ---');
  console.log(`  Certificate: ${certPath}`);
  console.log(`  Private key: ${keyPath}`);

  console.log('\n--- Start Server with HTTPS ---');
  console.log(`  SSL_CERTFILE=${certPath} SSL_KEYFILE=${keyPath} npm start`);

  if (ips.length > 0) {
    console.log('\n--- Access from your phone ---');
    for (const ip of ips) {
      console.log(`  https://${ip}:${port}`);
    }
  }

  console.log('\n--- iOS: Trust the certificate ---');
  console.log('  1. Transfer cert.pem to your iPhone (AirDrop, email, or HTTP)');
  console.log('  2. Open it to install the profile');
  console.log('  3. Go to Settings > General > About > Certificate Trust Settings');
  console.log("  4. Enable full trust for 'Claude Line Local'");

  console.log('\n--- Android: Trust the certificate ---');
  console.log('  1. Transfer cert.pem to your Android device');
  console.log('  2. Go to Settings > Security > Install certificate > CA certificate');
  console.log('  3. Select the cert.pem file');

  console.log('\n--- Browser: Accept the warning ---');
  console.log('  Navigate to the HTTPS URL and accept the self-signed cert warning.');
  console.log("  (Chrome: 'Advanced' > 'Proceed'; Firefox: 'Accept the Risk')");
  console.log();
}

/**
 * Interactive certificate generation entry point.
 */
export async function interactiveMain() {
  console.log('Claude Line — Self-Signed Certificate Generator\n');

  const detectedIps = getLocalIps();

  if (detectedIps.length > 0) {
    console.log('Detected local IP addresses:');
    for (const ip of detectedIps) {
      console.log(`  ${ip}`);
    }
  } else {
    console.log('No local IP addresses detected.');
  }

  let selectedIps = detectedIps;

  // Interactive mode: let user confirm/add IPs
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        '\nPress Enter to use all detected IPs, or type IPs separated by spaces:\n> ',
        resolve,
      );
    });
    rl.close();

    const trimmed = answer.trim();
    if (trimmed) {
      selectedIps = trimmed.split(/\s+/);
    }
  }

  console.log(`\nGenerating certificate for IPs: ${selectedIps.join(', ') || 'none'}`);
  const { certPath, keyPath } = await generateCertificate(selectedIps);
  printInstructions(certPath, keyPath, selectedIps);
}

// Run if executed directly
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  interactiveMain();
}
