# Security Policy

## 🔒 Security Overview

Security is paramount to **NimBounty**. As a web3 Mini App running inside Nimiq Pay, our architecture relies on strict non-custodial design principles:

1. **Zero Private Key Storage:** NimBounty never requests, receives, or stores private keys or seed phrases. All cryptographic operations are mediated directly by the native Nimiq Pay wallet wrapper.
2. **Device-Bound Identifiers:** Device IDs generated via `requestDeviceIdentifier` are pseudonymous 64-character SHA-256 hashes scoped specifically to the Mini App origin.
3. **Escrow Vault Rules:** Smart contract escrow pools only permit disbursements to verified worker addresses upon explicit poster approval or after the 24-hour auto-approval window.

---

## 🐛 Reporting a Vulnerability

If you discover a security vulnerability within NimBounty, please report it responsibly:

* **DO NOT** create a public GitHub issue for security vulnerabilities.
* Send a detailed security disclosure email to **security@nimbounty.dev** or message the team on the official Nimiq Skool community.
* Include detailed steps, proof-of-concept payload, and potential impact.

We will acknowledge receipt within **24 hours** and provide periodic updates on patch progress.
