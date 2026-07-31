# NimBounty — Instant Micro-Task & Crowd-Testing Protocol on Nimiq Pay

- **Frontend Application (Vercel):** [https://nim-bounty.vercel.app](https://nim-bounty.vercel.app)
- **Backend API & Real-Time Sync (Railway):** [https://nimbounty-production.up.railway.app](https://nimbounty-production.up.railway.app)

---

## 1. NimBounty Overview

NimBounty is a peer-to-peer, non-custodial micro-task bounty and crowd-testing protocol built natively on the Nimiq Pay Mini Apps Framework. It connects task posters (builders, startups, content creators, researchers) directly with workers (community members, testers, freelancers) for instant execution and settlement of high-velocity micro-tasks.

Traditional freelancing and crowdsourcing platforms charge exorbitant commission fees (20% to 30%), impose fixed per-transaction payment processing charges ($0.30+), and enforce high minimum withdrawal limits ($50+). These barriers render sub-dollar payments economically unviable and exclude workers in emerging markets.

NimBounty solves these inefficiencies by combining off-chain cryptographic signatures for zero-gas task proof submission with direct, wallet-to-wallet Nimiq (NIM) transfers powered by Nimiq Pay. Task posters can launch custom bounty pools in seconds, set verification rules, and review submitted proof artifacts, while workers complete tasks and receive instant, non-custodial payouts directly into their Nimiq Pay wallet with zero intermediary fees.

---

## 2. Why NimBounty (Problem & Solution)

### The Problem

1. High Intermediary Commissions: Traditional platforms like Fiverr, Upwork, and Mechanical Turk charge 20% to 30% platform fees on every transaction.
2. Fixed Payment Processing Overhead: Traditional credit card and banking rails charge a fixed ~$0.30 fee per payment, making micro-payments ($0.10 to $2.00) mathematically impossible.
3. Exorbitant Payout Thresholds: Workers in developing regions are often forced to accumulate $50 or more before withdrawing earnings, locking up capital for weeks.
4. Data Corruption from Sybil Accounts & Bots: Crowdsourcing platforms struggle with bot accounts and single users farming multiple task rewards using virtual machines or automated scripts.
5. Custodial Escrow Friction: Centralized platforms hold user funds in private corporate bank accounts, introducing counterparty risk, withdrawal delays, and account freeze risks.

### The Solution

| Problem Area | Traditional Platforms | NimBounty Solution |
|---|---|---|
| Platform Fees | 20% – 30% commission | 0% platform fees. Direct wallet-to-wallet transfer |
| Processing Costs | $0.30 fixed fee per payout | Feeless / sub-cent Nimiq native network transfer |
| Payout Threshold | $50.00 minimum balance | $0.00 minimum. Instant payout on proof approval |
| Bot / Sybil Attacks | Unfiltered bot farming | Hardware-bound `requestDeviceIdentifier` API (1 physical device = 1 slot) |
| Custody Risk | Centralized platform custody | Non-custodial direct settlement from poster to worker |
| Proof Integrity | Unverified manual forms | Cryptographic off-chain key signing (Ergon pattern) |

---

## 3. Current MVP Features

### Poster Capabilities
- Instant Task Pool Publishing: Define title, category, proof requirements (text, URL link, screenshot link, or combined image + text), slots count, and NIM reward.
- Off-Chain Creation Receipt: Sign task pool publication receipts using Nimiq Pay wallet keys at zero gas cost.
- Live Submissions Management Queue: Real-time dashboard to inspect worker proof submissions, view public screenshot previews, approve payouts, or reject invalid entries with clear feedback.
- Wallet-to-Wallet One-Click Payout: Transfer NIM directly from poster wallet to worker wallet upon proof approval.
- Defaulter Lockout System: Automated 24-hour post-expiration audit system that flags and restricts posters who leave completed worker tasks unpaid on expired campaigns.

### Worker Capabilities
- Live Bounty Discovery: Search and filter active task pools by category (App Testing, UI/UX Feedback, Social Share, Bug Hunt, Copywriting) and sort by reward or open slots.
- Hardware Anti-Sybil Slot Reservation: Hardware-bound device locking via Nimiq Pay `requestDeviceIdentifier` prevents multi-account slot hoarding.
- Zero-Gas Off-Chain Proof Submission: Sign proof payload with Nimiq wallet keys without paying network gas fees.
- Real-Time Orders & History: Track submitted proof statuses (Pending, Approved, Rejected) and view historical NIM earnings.
- Re-Submission Flow: If a submission is rejected with feedback, workers can update and re-submit proof back into the pending review queue.

### Platform Infrastructure
- Global Server-Authoritative Sync: Real-time synchronization across all connected mobile & web clients via Railway Node.js server engine (`backend/server.js`) with persistent store and server-side HTTP `Cache-Control` control.
- Global Bounty Registry: Public live ledger detailing all published task pools, creator addresses, rewards, and active slot statuses.
- Global Leaderboard: Live rankings tracking top earning worker addresses, completed task volumes, and protocol payout volume.
- User Reputation & Dispute System: Account report tracking, 30-day report decay engine, and worker rating badges (1.0 to 5.0 scale).

---

## 4. Future Integration (Escrow Vaults)

While the current MVP utilizes direct non-custodial wallet-to-wallet transfers upon poster approval, the next major architectural iteration introduces Trustless On-Chain Escrow Vaults:

1. Automatic Escrow Vault Deposit: Upon publishing a task pool, the poster deposits the total reward pool (Reward × Slots) into a programmatic smart contract vault.
2. Serverless Escrow Disburser: Upon poster proof approval, a backend disburser function verifies the poster approval signature and triggers an automatic release of NIM from the escrow vault to the worker.
3. 24-Hour Auto-Release Protection: If a poster does not review or reject a pending submission within 24 hours, the escrow contract auto-releases the reserved NIM reward to the worker to protect worker labor.
4. Vault Reclaim on Expiration: Unclaimed task pool rewards automatically revert back to the poster's wallet once the campaign duration elapses.

---

## 5. Nimiq Transaction & Signing Flow

NimBounty leverages Nimiq Pay's SDK for both off-chain cryptographic proof verification (zero gas) and on-chain payment execution:

```
[ Worker / Poster Device ]
           │
           ▼
1. Hardware Anti-Sybil Lock
   └── NimiqPay.requestDeviceIdentifier() ──► Binds 1 physical hardware device to 1 task slot
           │
           ▼
2. Off-Chain Cryptographic Receipt (Zero Gas)
   └── NimiqProvider.sign(payload) ──────────► Generates Schnorr/Ed25519 signature of proof/bounty receipt
           │
           ▼
3. Global Server State Broadcast
   └── POST /api/bounties ───────────────────► Validates signature & updates global ledger
           │
           ▼
4. Direct Wallet-to-Wallet Settlement (On Approval)
   └── NimiqProvider.sendBasicTransaction() ► Transfers NIM directly from Poster Wallet to Worker Wallet
```

---

## 6. Tech Stack

- Core Architecture: HTML5, Vanilla CSS3 (Custom Design System & HSL Tokens), Modern ES6+ JavaScript.
- Typography: Work Sans, Instrument Serif, Geist Mono (Google Fonts).
- Web3 SDK Integration: `@nimiq/mini-app-sdk` (`init()`, `listAccounts()`, `requestDeviceIdentifier()`, `sendBasicTransaction()`, `sign()`).
- EVM Provider: `window.ethereum` (EVM multi-chain compatibility layer).
- Full-Stack Backend: Railway Node.js & Express server engine (`backend/server.js`).
- Persistent Data Store: Server-authoritative JSON persistence store with real-time atomic state merging.
- Hosting & CDN: Vercel Frontend & Railway Production Infrastructure with automated HTTP `Cache-Control: no-cache` middleware.

---

## 7. Local Development

### Prerequisites
- Node.js v18.0.0 or higher
- Git
- Nimiq Pay Mobile App (iOS / Android) for native mobile WebView testing

### Installation & Execution

1. Clone the repository:
```bash
git clone https://github.com/OpeyemiMoses/NimBounty.git
cd NimBounty
```

2. Install dependencies:
```bash
npm install
```

3. Launch local development server:

Using Node `http-server`:
```bash
npx http-server -p 8080
```

Or using Vercel CLI (includes serverless `/api/bounties` execution):
```bash
npx vercel dev
```

4. Open in browser:
```
http://localhost:8080
```

5. Mobile Testing inside Nimiq Pay App:
Connect your mobile device to the same Wi-Fi network and navigate to your local IP address inside Nimiq Pay Mini Apps:
```
http://<YOUR_LOCAL_IP>:8080
```

---

## 8. Quality Checks

To verify code syntax and integrity before committing:

1. JavaScript Syntax Check:
```bash
node --check app.js
node --check api/bounties.js
```

2. HTTP Cache Verification:
```bash
curl -I https://nim-bounty.vercel.app/app.js
```
Verify that `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` is returned.

3. End-to-End Functional Checklist:
- Wallet Connection & Address Recovery: Connects via Nimiq Pay SDK and preserves address across app sessions.
- Bounty Campaign Publishing: Validates input, executes receipt signing, and broadcasts to global registry.
- Worker Proof Submission: Enforces hardware device locking, validates proof input, signs receipt off-chain.
- Poster Review & Approval: Transfers NIM reward wallet-to-wallet, updates completed counters, fires confetti & toast notification.

---

## 9. Project Structure

```
NimBounty/
├── index.html          # Single Page Application HTML (Landing + Console Views)
├── app.js              # Core Application Logic, UI Renderer, & State Engine
├── style.css           # Custom Design System, Color Tokens, & Responsive Layouts
├── backend/
│   └── server.js       # Railway Node.js Express Backend & Real-Time State Server
├── vercel.json         # Vercel CDN Cache-Control & Deployment Headers
├── favicon.png         # NimBounty App Icon
├── favicon.svg         # SVG Vector Icon
├── package.json        # Dependencies & NPM Scripts
├── LICENSE             # MIT License Document
├── CODE_OF_CONDUCT.md  # Community Code of Conduct
├── CONTRIBUTING.md     # Contribution Guidelines
├── SECURITY.md         # Security & Disclosure Policy
└── README.md           # Protocol Documentation
```

---

## 10. Competition Fit (Hackathon Alignment)

NimBounty was engineered specifically for the Nimiq Pay Hackathon 2026 to showcase the full utility of Nimiq's mobile payment stack:

1. Native Nimiq Pay Mini App Utility: Direct integration with Nimiq Pay's SDK unlocks real micro-payment use cases that are impossible on traditional credit cards or high-gas blockchains.
2. Real-World Economic Viability: Sub-dollar task rewards ($0.10 to $2.00) become practical because Nimiq network fees are near-zero and platform commissions are 0%.
3. Hardware-Level Security: Utilizes Nimiq Pay's `requestDeviceIdentifier` to solve the single largest issue plaguing Web2 micro-task platforms: bot farming and multi-account abuse.
4. Feeless Web3 UX: Off-chain cryptographic signing ensures workers never need to purchase gas tokens or manage complex gas price settings just to submit work.
5. Frictionless Onboarding: Web2-friendly design aesthetic with instant wallet auto-connection inside Nimiq Pay's native mobile WebView.

---

## 11. Security (Data Access & Scope Limits)

NimBounty operates under strict privacy and security principles:

### What NimBounty Has Access To
- Public Nimiq Wallet Address: Used solely to identify user accounts, render dashboards, and route direct payments.
- Hardware Device Identifier Hash: An anonymized 64-character SHA-256 hash provided by Nimiq Pay's `requestDeviceIdentifier` API, used strictly to prevent multi-account slot hoarding per task pool.
- User-Submitted Proof Artifacts: Text, public URLs, or public screenshot image links submitted explicitly by workers for task verification.

### What NimBounty Does NOT Have Access To
- Private Keys or Seed Phrases: NimBounty never requests, touches, or stores private keys, seed words, or wallet passwords. All cryptographic signing occurs securely inside Nimiq Pay's isolated wallet runtime.
- Custodial Funds: NimBounty holds zero user funds. Payouts move directly from user wallet to user wallet.
- Personal Identifying Information (PII): NimBounty does not require emails, real names, phone numbers, or KYC documentation.

---

## 12. License

Distributed under the MIT License. See `LICENSE` for full details.

```
MIT License

Copyright (c) 2026 NimBounty Protocol Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
