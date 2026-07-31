# NimBounty — Instant Micro-Task & Crowd-Testing Protocol on Nimiq Pay

**Full-Stack Live Application (Railway)**: [https://nimbounty-production.up.railway.app](https://nimbounty-production.up.railway.app)  
**Vercel Mirror**: [https://nim-bounty.vercel.app](https://nim-bounty.vercel.app)

---

## 1. NimBounty Overview

NimBounty is a peer-to-peer, non-custodial micro-task bounty and crowd-testing protocol built natively on the Nimiq Pay Mini Apps Framework. It connects task posters (builders, startups, content creators, researchers) directly with workers (community members, testers, freelancers) for instant execution and settlement of high-velocity micro-tasks.

Traditional freelancing and crowdsourcing platforms charge exorbitant commission fees (20% to 30%), impose fixed per-transaction payment processing charges ($0.30+), and enforce high minimum withdrawal limits ($50+). These barriers render sub-dollar payments economically unviable and exclude workers in emerging markets.

NimBounty solves these inefficiencies by combining off-chain cryptographic signatures for zero-gas task proof submission with direct, wallet-to-wallet Nimiq (NIM) transfers powered by Nimiq Pay. Task posters can launch custom bounty pools in seconds, set verification rules, and review submitted proof artifacts, while workers complete tasks and receive instant, non-custodial payouts directly into their Nimiq Pay wallet with zero intermediary fees.

---

## 2. Why NimBounty (Problem & Solution)

### The Problem

1. **High Intermediary Commissions**: Traditional platforms like Fiverr, Upwork, and Mechanical Turk charge 20% to 30% platform fees on every transaction.
2. **Fixed Payment Processing Overhead**: Traditional credit card and banking rails charge a fixed ~$0.30 fee per payment, making micro-payments ($0.10 to $2.00) mathematically impossible.
3. **Exorbitant Payout Thresholds**: Workers in developing regions are often forced to accumulate $50 or more before withdrawing earnings, locking up capital for weeks.
4. **Data Corruption from Sybil Accounts & Bots**: Crowdsourcing platforms struggle with bot accounts and single users farming multiple task rewards using virtual machines or automated scripts.
5. **Custodial Escrow Friction**: Centralized platforms hold user funds in private corporate bank accounts, introducing counterparty risk, withdrawal delays, and account freeze risks.

### The Solution

| Problem Area | Traditional Platforms | NimBounty Solution |
|---|---|---|
| Platform Fees | 20% – 30% commission | 0% platform fees. Direct wallet-to-wallet transfer |
| Processing Costs | $0.30 fixed fee per payout | Feeless / sub-cent Nimiq native network transfer |
| Payout Threshold | $50.00 minimum balance | $0.00 minimum. Instant payout on proof approval |
| Bot / Sybil Attacks | Unfiltered bot farming | Hardware-bound `requestDeviceIdentifier` API (1 physical device = 1 slot) |
| Custody Risk | Centralized platform custody | Non-custodial direct settlement from poster to worker |
| Proof Integrity | Unverified manual forms | Direct HD screenshot uploads & cryptographic off-chain key signing |
| Server Storage | Restricted / small caps | Railway full-stack Express server with persistent disk volume |

---

## 3. Core Protocol Features

### 🛠️ Poster Capabilities
- **Instant Task Pool Publishing**: Define title, category, proof requirements (**Text Review**, **Web Link / URL**, **Screenshot Image**, or **Screenshot Image + Feedback**), slots count, and NIM reward per worker.
- **Off-Chain Creation Receipt**: Sign task pool publication receipts using Nimiq Pay wallet keys at zero gas cost.
- **Direct High-Definition Screenshot Proof Review**: View full-resolution (1200px HD) visual screenshots submitted by workers directly on your dashboard.
- **Full-Screen Lightbox Viewer**: Inspect screenshots up close with 1-click download options for complete verification.
- **One-Click Payout with Spinner Feedback**: Clicking "Approve & Pay" displays an inline spinning loader (`Paying X NIM...`) while transferring NIM directly from poster wallet to worker wallet via Nimiq Pay.
- **Confetti Celebration**: Triggers a gold & emerald confetti celebration burst on the poster's screen upon successful payout approval.
- **Dispute & Rejection Management**: Reject invalid submissions with written feedback to reopen task slots, or flag fake/spam entries.
- **Automated Rating Recovery**: Approving worker payouts automatically resolves active dispute reports 1-by-1, restoring poster rating back to 5.0.
- **Defaulter Lockout System**: Automated audit system that flags and restricts posters who leave completed worker tasks unpaid on expired campaigns.

### 👷 Worker Capabilities
- **Live Bounty Discovery**: Search and filter active task pools by category (App Testing, UI/UX Feedback, Social Share, Bug Hunt, Copywriting) and sort by reward or open slots.
- **Direct Device File Upload**: Select screenshot images directly from device photo gallery / camera roll with instant (<10ms) local thumbnail preview.
- **Web Link / URL Proof Option**: Submit public web links with an optional X (Twitter) handle (`@username`) for social task verification.
- **Hardware Anti-Sybil Slot Reservation**: Hardware-bound device locking via Nimiq Pay `requestDeviceIdentifier` prevents multi-account slot hoarding.
- **Zero-Gas Off-Chain Proof Submission**: Sign proof payload with Nimiq wallet keys without paying network gas fees.
- **Real-Time Orders & History**: Track submitted proof statuses (Pending, Approved, Rejected) and view historical NIM earnings.
- **Re-Submission Flow**: If a submission is rejected with feedback, workers can update and re-submit proof back into the pending review queue.

### 🌐 Platform & Navigation Infrastructure
- **Railway Full-Stack Backend**: Powered by Node.js Express server (`backend/server.js`) backed by Railway persistent volume storage (`/data/store.json`). Supports unlimited tasks and high-definition media (up to 10MB payloads).
- **Navigation State Preservation**: Disconnecting wallet preserves current active page (`profile`, `registry`, `how-it-works`, `protections`, `faq`, `orders`, `app`). Reconnecting restores the exact page without blank screens or nav jumps.
- **Public Page Protection**: Wallet connection gate modal is automatically suppressed on public pages (`landing`, `how-it-works`, `protections`, `faq`, `registry`).
- **Global Bounty Registry**: Public live ledger detailing all published task pools, creator addresses, rewards, and active slot statuses.
- **Global Leaderboard**: Live rankings tracking top earning worker addresses, completed task volumes, and protocol payout volume.
- **Single Effective Report System**: Poster reputation counts unique reporter wallets ONLY to prevent multi-report spam attacks.

---

## 4. Architectural System & Data Flow

```
[ Worker Device ]                                       [ Poster Device ]
       │                                                       │
       ├─► 1. Selects HD Screenshot / Enters Proof              │
       ├─► 2. Signs Receipt Off-Chain (0 Gas)                   │
       │                                                       │
       ▼                                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Railway Full-Stack Express Server                         │
│              https://nimbounty-production.up.railway.app              │
│              Persistent Storage: /data/store.json                      │
└────────────────────────────────────────────────────────────────────────┘
       ▲                                                       ▲
       │                                                       │
       └─► 3. Real-Time Server Broadcast ───────────────────────┘
                                                               │
                                                               ▼
                                                4. Reviews HD Screenshot Proof
                                                5. Clicks "Approve & Pay" (Spinner)
                                                6. Nimiq Pay Wallet Transfer ──► [ Worker Wallet ]
```

---

## 5. Tech Stack

- **Core Frontend**: HTML5, Vanilla CSS3 (Custom Design System & HSL Tokens), Modern ES6+ JavaScript.
- **Full-Stack Backend**: Express.js server (`backend/server.js`) hosted on Railway with persistent volume storage (`/data/store.json`).
- **Typography**: Work Sans, Instrument Serif, Geist Mono (Google Fonts).
- **Web3 SDK Integration**: `@nimiq/mini-app-sdk` (`init()`, `listAccounts()`, `requestDeviceIdentifier()`, `sendBasicTransaction()`, `sign()`).
- **Animation & FX**: Native CSS Keyframe Spinners, Canvas Confetti Celebration (`canvas-confetti`).
- **Hosting & Infrastructure**: Railway Production Infrastructure (Primary Full-Stack) & Vercel Mirror.

---

## 6. Local Development & Server Setup

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

3. Launch local Railway Express full-stack server:
```bash
npm start
```

4. Open in browser:
```
http://localhost:3001
```

5. Mobile Testing inside Nimiq Pay App:
Connect your mobile device to the same Wi-Fi network and navigate to your local IP address inside Nimiq Pay Mini Apps:
```
http://<YOUR_LOCAL_IP>:3001
```

---

## 7. Quality & Syntax Checks

To verify code syntax and integrity before committing:

1. JavaScript Syntax Check:
```bash
node --check app.js
node --check backend/server.js
```

2. Health Check Verification:
```bash
curl -I https://nimbounty-production.up.railway.app/api/bounties
```

3. End-to-End Functional Checklist:
- **Wallet Connection & Navigation**: Connects via Nimiq Pay SDK, preserves active page view across disconnect/reconnect.
- **Bounty Campaign Publishing**: Validates input, signs receipt off-chain, broadcasts to global registry.
- **Direct Screenshot File Upload**: Selects image from device gallery, renders instant local thumbnail preview, stores HD 1200px image data.
- **Poster Dashboard Review & Payout**: Renders screenshot card, displays inline spinner (`Paying X NIM...`) on approval, transfers NIM wallet-to-wallet, triggers confetti celebration.

---

## 8. Project Structure

```
NimBounty/
├── index.html          # Single Page Application HTML (Landing + Console Views)
├── app.js              # Core Application Logic, UI Renderer, & State Engine
├── style.css           # Custom Design System, Color Tokens, & Keyframe Animations
├── backend/
│   ├── server.js       # Express.js Full-Stack Server & Data Storage Engine
│   ├── package.json    # Backend Dependencies (Express, Cors)
│   └── data/           # Persistent JSON Data Directory (/data/store.json)
├── railway.json        # Railway Nixpacks Deployment Configuration
├── package.json        # Root Package Manager File
├── vercel.json         # Vercel Deployment Headers
├── favicon.png         # NimBounty App Icon
├── favicon.svg         # SVG Vector Icon
├── LICENSE             # MIT License Document
├── CODE_OF_CONDUCT.md  # Community Code of Conduct
├── CONTRIBUTING.md     # Contribution Guidelines
├── SECURITY.md         # Security & Disclosure Policy
└── README.md           # Protocol Documentation
```

---

## 9. Security & Privacy Principles

- **Public Nimiq Wallet Address**: Used solely to identify user accounts, render dashboards, and route direct payments.
- **Hardware Device Identifier Hash**: An anonymized 64-character SHA-256 hash provided by Nimiq Pay's `requestDeviceIdentifier` API, used strictly to prevent multi-account slot hoarding per task pool.
- **Non-Custodial Payouts**: NimBounty holds zero user funds. Payouts move directly from poster wallet to worker wallet via Nimiq Pay.
- **Zero Private Key Access**: Cryptographic signing occurs securely inside Nimiq Pay's isolated wallet runtime.

---

## 10. License

Distributed under the MIT License. See `LICENSE` for full details.

```
MIT License
Copyright (c) 2026 NimBounty Protocol Contributors
```
