# Security Policy 🔒

## Supported Versions

The following table details supported versions of NimBounty receiving security updates:

| Version | Supported          |
| ------- | ------------------ |
| v2.x    | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

We take the security of NimBounty and user wallet interactions seriously. If you discover a security vulnerability, **please do NOT report it in public GitHub issues**.

Instead, please report vulnerabilities privately:

1. **Email/Direct Message**: Send details to the maintainers or open a private security advisory on GitHub.
2. **Details to include**:
   - Description of the vulnerability.
   - Proof-of-concept script or exact steps to reproduce.
   - Potential impact.

### Response & Fix Timeline
- **Acknowledgement**: Within 48 hours.
- **Assessment & Patch**: We aim to release a patch or mitigation within 5 business days for critical vulnerabilities.

---

## Security Best Practices in NimBounty

- **Zero Key Access**: NimBounty operates entirely as a client-side Mini App. It never requests, accesses, or stores private keys or seed phrases.
- **Sanitized Payloads**: User inputs and proof attachments are sanitized before rendering or broadcasting to prevent cross-site scripting (XSS).
- **Client & Wallet Authority**: Transaction signing (`provider.sign()` & `sendBasicTransactionWithData()`) is handled exclusively inside the native Nimiq Pay container.
